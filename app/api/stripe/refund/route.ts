import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { refundDestinationChargePolicy } from "@/lib/billing";

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
    .select("id, provider_id, stripe_payment_intent_id, amount_paid, refunded_amount, currency")
    .eq("appointment_id", body.appointmentId)
    .maybeSingle();
  if (error || !payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (payment.provider_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const remaining = payment.amount_paid - payment.refunded_amount;
  const amount = body.amountCents === undefined ? remaining : Number(body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
    return NextResponse.json({ error: "Invalid refund amount" }, { status: 400 });
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        ...refundDestinationChargePolicy(amount),
        metadata: { appointment_id: body.appointmentId, payment_id: payment.id },
      },
      { idempotencyKey: `appointment-refund/${payment.id}/${payment.refunded_amount}/${amount}` }
    );

    const refundSucceeded = refund.status === "succeeded";
    const refundedAmount = payment.refunded_amount + (refundSucceeded ? amount : 0);
    const status = refundSucceeded
      ? refundedAmount === payment.amount_paid
        ? "refunded"
        : "partially_refunded"
      : "paid";
    const { error: refundStoreError } = await supabaseAdmin.from("drimli_refunds").upsert({
      payment_id: payment.id,
      stripe_refund_id: refund.id,
      amount,
      currency: payment.currency,
      status: refund.status ?? "pending",
    }, { onConflict: "stripe_refund_id" });
    if (refundStoreError) throw refundStoreError;

    if (refundSucceeded) {
      const { data: updatedPayment, error: paymentUpdateError } = await supabaseAdmin
        .from("drimli_payments")
        .update({ refunded_amount: refundedAmount, status, updated_at: new Date().toISOString() })
        .eq("id", payment.id)
        .eq("refunded_amount", payment.refunded_amount)
        .select("id")
        .maybeSingle();
      if (paymentUpdateError || !updatedPayment) throw new Error("Refund state update conflict");
    }

    return NextResponse.json({ refundId: refund.id, amount, status });
  } catch (refundError: unknown) {
    console.error("[STRIPE_REFUND_ERROR]", {
      appointmentId: body.appointmentId,
      message: refundError instanceof Error ? refundError.message : "unknown",
    });
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
