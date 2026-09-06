import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refundDestinationChargePolicy } from "@/lib/billing";
import { ensureClientCreditNote } from "@/lib/clientCreditNotes";
import { syncRefundedCommissionMovements } from "@/lib/drimliCommissionLedger";

export class AppointmentRefundError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function refundAppointmentInFull(params: {
  admin: SupabaseClient;
  stripe: Stripe;
  appointmentId: string;
  providerId: string;
}) {
  const { admin, stripe, appointmentId, providerId } = params;
  const { data: payment, error } = await admin
    .from("drimli_payments")
    .select("id, provider_id, stripe_payment_intent_id, amount_paid, application_fee_amount, refunded_amount, currency, paid_at")
    .eq("appointment_id", appointmentId)
    .maybeSingle();
  if (error || !payment) throw new AppointmentRefundError("Payment not found", 404);
  if (payment.provider_id !== providerId) throw new AppointmentRefundError("Forbidden", 403);

  const existingRefunds = await stripe.refunds.list({
    payment_intent: payment.stripe_payment_intent_id,
    limit: 100,
  });
  const stripeRefundedAmount = existingRefunds.data
    .filter((refund) => refund.status === "succeeded")
    .reduce((sum, refund) => sum + refund.amount, 0);
  const existingAppointmentRefund = existingRefunds.data.find(
    (refund) => refund.status === "succeeded" && refund.metadata?.appointment_id === appointmentId
  );
  const remaining = payment.amount_paid - stripeRefundedAmount;
  const requestedAmount = remaining;
  if (remaining > 0 && (!Number.isInteger(requestedAmount) || requestedAmount <= 0 || requestedAmount > remaining)) {
    throw new AppointmentRefundError("Invalid refund amount", 400);
  }

  if (existingAppointmentRefund && remaining === 0 && payment.refunded_amount >= payment.amount_paid) {
    return {
      refundId: existingAppointmentRefund.id,
      amount: existingAppointmentRefund.amount,
      status: "refunded",
      cancelled: true,
      refunded: true,
    };
  }

  const { data: refundClaimed, error: refundClaimError } = await admin
    .rpc("begin_drimli_payment_refund", { p_payment_id: payment.id });
  if (refundClaimError || !refundClaimed) {
    throw new AppointmentRefundError("Un payout ou un remboursement est déjà en cours.");
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
            metadata: { appointment_id: appointmentId, payment_id: payment.id },
          },
          { idempotencyKey: `appointment-refund/${payment.id}/${stripeRefundedAmount}/${requestedAmount}` }
        );
    if (!refund) throw new Error("Refund state unavailable");

    const refundSucceeded = refund.status === "succeeded";
    if (refundSucceeded) completedRefund = refund;
    const refundedAmount = refundSucceeded
      ? Math.min(payment.amount_paid, stripeRefundedAmount + (createsRefund ? requestedAmount : 0))
      : stripeRefundedAmount;
    const status = refundSucceeded
      ? refundedAmount === payment.amount_paid ? "refunded" : "partially_refunded"
      : "paid";

    if (refundSucceeded) {
      const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, {
        expand: ["latest_charge.application_fee"],
      });
      const charge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
      const applicationFee = charge && typeof charge.application_fee === "object" ? charge.application_fee : null;
      const refundedApplicationFeeAmount = applicationFee?.amount_refunded ?? 0;
      const { data: updatedPayment, error: paymentUpdateError } = await admin
        .from("drimli_payments")
        .update({
          refunded_amount: refundedAmount,
          refunded_application_fee_amount: refundedApplicationFeeAmount,
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .select("id")
        .maybeSingle();
      if (paymentUpdateError || !updatedPayment) throw new Error("Refund state update conflict");
      const { error: commitmentError } = await admin.rpc("complete_drimli_payment_refund", {
        p_payment_id: payment.id,
        p_refunded_amount: refundedAmount,
      });
      if (commitmentError) throw new Error("Refund payout state update failed");
      const { error: appointmentUpdateError } = await admin
        .from("appointments")
        .update({ status: "cancelled_by_provider" })
        .eq("id", appointmentId)
        .eq("provider_id", payment.provider_id);
      if (appointmentUpdateError) throw new Error("Appointment cancellation state update failed");

      try {
        const { data: storedRefund, error: refundStoreError } = await admin.from("drimli_refunds").upsert({
          payment_id: payment.id,
          stripe_refund_id: refund.id,
          amount: refund.amount,
          currency: payment.currency,
          status: refund.status ?? "pending",
        }, { onConflict: "stripe_refund_id" }).select("id").single();
        if (refundStoreError || !storedRefund) throw refundStoreError || new Error("Refund record missing");
        if (applicationFee) {
          await syncRefundedCommissionMovements({
            admin,
            stripe,
            payment,
            applicationFeeId: applicationFee.id,
            refundId: storedRefund.id,
            stripeRefundCreated: refund.created,
          });
        }
        await ensureClientCreditNote(admin, storedRefund.id, new Date(refund.created * 1000).toISOString());
      } catch (secondaryError: unknown) {
        console.error("[REFUND_SECONDARY_PROCESSING_ERROR]", {
          appointmentId,
          refundId: refund.id,
          message: secondaryError instanceof Error ? secondaryError.message : "unknown",
        });
      }
    }

    return {
      refundId: refund.id,
      amount: refund.amount,
      status,
      cancelled: refundSucceeded,
      refunded: refundSucceeded,
    };
  } catch (refundError: unknown) {
    if (!completedRefund) await admin.rpc("release_drimli_payment_refund", { p_payment_id: payment.id });
    console.error("[STRIPE_REFUND_ERROR]", {
      appointmentId,
      message: refundError instanceof Error ? refundError.message : "unknown",
    });
    if (completedRefund) {
      return {
        refundId: completedRefund.id,
        amount: completedRefund.amount,
        status: "succeeded",
        cancelled: true,
        refunded: true,
        reconciliationRequired: true,
      };
    }
    throw new AppointmentRefundError("Refund failed", 500);
  }
}
