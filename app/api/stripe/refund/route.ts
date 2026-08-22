import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { refundDestinationChargePolicy } from "@/lib/billing";
import { ensureClientCreditNote } from "@/lib/clientCreditNotes";
import { syncRefundedCommissionMovements } from "@/lib/drimliCommissionLedger";
import { canRefundAt } from "@/lib/payoutPolicy";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    appointmentId?: unknown;
    amountCents?: unknown;
  } | null;
  if (typeof body?.appointmentId !== "string") {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }

  const { data: payment, error } = await supabaseAdmin
    .from("drimli_payments")
    .select("id, provider_id, stripe_payment_intent_id, amount_paid, application_fee_amount, refunded_amount, currency, paid_at")
    .eq("appointment_id", body.appointmentId)
    .maybeSingle();
  if (error || !payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (payment.provider_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: appointment } = await supabaseAdmin
    .from("appointments")
    .select("start_datetime, cancellation_policy, cancellation_refund_deadline_hours")
    .eq("id", body.appointmentId)
    .maybeSingle();
  if (!appointment) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  if (appointment.cancellation_policy === "non_refundable") {
    return NextResponse.json({ error: "Cette réservation est sans remboursement." }, { status: 409 });
  }
  const deadlineHours = appointment.cancellation_refund_deadline_hours;
  if (!deadlineHours || !canRefundAt(appointment.start_datetime, deadlineHours, new Date())) {
    return NextResponse.json({ error: `Le délai de remboursement de ${deadlineHours ?? 48} h est dépassé.` }, { status: 409 });
  }
  if (appointment.cancellation_policy === "moderate" && body.amountCents !== undefined) {
    return NextResponse.json({ error: "Seul le remboursement intégral est disponible." }, { status: 400 });
  }

  const existingRefunds = await stripe.refunds.list({
    payment_intent: payment.stripe_payment_intent_id,
    limit: 100,
  });
  const stripeRefundedAmount = existingRefunds.data
    .filter((refund) => refund.status === "succeeded")
    .reduce((sum, refund) => sum + refund.amount, 0);
  const existingAppointmentRefund = existingRefunds.data.find(
    (refund) =>
      refund.status === "succeeded" &&
      refund.metadata?.appointment_id === body.appointmentId
  );
  const remaining = payment.amount_paid - stripeRefundedAmount;
  const requestedAmount = body.amountCents === undefined ? remaining : Number(body.amountCents);
  if (remaining > 0 && (!Number.isInteger(requestedAmount) || requestedAmount <= 0 || requestedAmount > remaining)) {
    return NextResponse.json({ error: "Invalid refund amount" }, { status: 400 });
  }

  const { data: refundClaimed, error: refundClaimError } = await supabaseAdmin
    .rpc("begin_drimli_payment_refund", { p_payment_id: payment.id });
  if (refundClaimError || !refundClaimed) {
    return NextResponse.json({ error: "Un payout ou un remboursement est déjà en cours." }, { status: 409 });
  }

  let completedRefund: Stripe.Refund | null = null;
  try {
    const createsRefund = !existingAppointmentRefund && remaining > 0;
    const refund = !createsRefund
      ? existingAppointmentRefund ?? existingRefunds.data.find((item) => item.status === "succeeded") ?? null
      : await stripe.refunds.create(
          {
            payment_intent: payment.stripe_payment_intent_id,
            ...refundDestinationChargePolicy(requestedAmount),
            metadata: { appointment_id: body.appointmentId, payment_id: payment.id },
          },
          { idempotencyKey: `appointment-refund/${payment.id}/${stripeRefundedAmount}/${requestedAmount}` }
        );

    if (!refund) {
      throw new Error("Refund state unavailable");
    }

    const refundSucceeded = refund.status === "succeeded";
    if (refundSucceeded) completedRefund = refund;
    const refundedAmount = refundSucceeded
      ? Math.min(payment.amount_paid, stripeRefundedAmount + (createsRefund ? requestedAmount : 0))
      : stripeRefundedAmount;
    const status = refundSucceeded
      ? refundedAmount === payment.amount_paid
        ? "refunded"
        : "partially_refunded"
      : "paid";
    if (refundSucceeded) {
      const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, { expand: ["latest_charge.application_fee"] });
      const charge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
      const applicationFee = charge && typeof charge.application_fee === "object" ? charge.application_fee : null;
      const refundedApplicationFeeAmount = applicationFee?.amount_refunded ?? 0;
      const { data: updatedPayment, error: paymentUpdateError } = await supabaseAdmin
        .from("drimli_payments")
        .update({ refunded_amount: refundedAmount, refunded_application_fee_amount: refundedApplicationFeeAmount, status, updated_at: new Date().toISOString() })
        .eq("id", payment.id)
        .select("id")
        .maybeSingle();
      if (paymentUpdateError || !updatedPayment) throw new Error("Refund state update conflict");
      const { error: commitmentError } = await supabaseAdmin.rpc("complete_drimli_payment_refund", {
        p_payment_id: payment.id,
        p_refunded_amount: refundedAmount,
      });
      if (commitmentError) throw new Error("Refund payout state update failed");
      const { error: appointmentUpdateError } = await supabaseAdmin
        .from("appointments")
        .update({ status: "cancelled_by_provider" })
        .eq("id", body.appointmentId)
        .eq("provider_id", payment.provider_id);
      if (appointmentUpdateError) throw new Error("Appointment cancellation state update failed");

      try {
        const { data: storedRefund, error: refundStoreError } = await supabaseAdmin.from("drimli_refunds").upsert({
          payment_id: payment.id,
          stripe_refund_id: refund.id,
          amount: refund.amount,
          currency: payment.currency,
          status: refund.status ?? "pending",
        }, { onConflict: "stripe_refund_id" }).select("id").single();
        if (refundStoreError || !storedRefund) throw refundStoreError || new Error("Refund record missing");
        if (applicationFee) {
          await syncRefundedCommissionMovements({
            admin: supabaseAdmin,
            stripe,
            payment,
            applicationFeeId: applicationFee.id,
            refundId: storedRefund.id,
            stripeRefundCreated: refund.created,
          });
        }
        await ensureClientCreditNote(supabaseAdmin, storedRefund.id, new Date(refund.created * 1000).toISOString());
      } catch (secondaryError: unknown) {
        console.error("[REFUND_SECONDARY_PROCESSING_ERROR]", {
          appointmentId: body.appointmentId,
          refundId: refund.id,
          message: secondaryError instanceof Error ? secondaryError.message : "unknown",
        });
      }
    }

    return NextResponse.json({ refundId: refund.id, amount: refund.amount, status });
  } catch (refundError: unknown) {
    if (!completedRefund) {
      await supabaseAdmin.rpc("release_drimli_payment_refund", { p_payment_id: payment.id });
    }
    console.error("[STRIPE_REFUND_ERROR]", {
      appointmentId: body.appointmentId,
      message: refundError instanceof Error ? refundError.message : "unknown",
    });
    if (completedRefund) {
      return NextResponse.json({
        refundId: completedRefund.id,
        amount: completedRefund.amount,
        status: "succeeded",
        reconciliationRequired: true,
        error: "Refund succeeded; reconciliation is pending",
      }, { status: 202 });
    }
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
