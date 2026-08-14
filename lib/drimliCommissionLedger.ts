import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDrimliCreditNotePdf } from "@/lib/drimliCommissionBilling";

type Payment = {
  id: string;
  provider_id: string;
  currency: string;
  application_fee_amount: number;
  paid_at: string;
};

export async function recordCollectedCommission(
  admin: SupabaseClient,
  payment: Payment,
  applicationFeeId: string
) {
  if (payment.application_fee_amount === 0) return;
  const { error } = await admin.rpc("record_drimli_commission_movement", {
    p_provider_id: payment.provider_id,
    p_payment_id: payment.id,
    p_refund_id: null,
    p_movement_type: "collected",
    p_amount: payment.application_fee_amount,
    p_currency: payment.currency,
    p_effective_at: payment.paid_at,
    p_stripe_reference: `application_fee:${applicationFeeId}`,
  });
  if (error) throw error;
}

export async function syncRefundedCommissionMovements(params: {
  admin: SupabaseClient;
  stripe: Stripe;
  payment: Payment;
  applicationFeeId: string;
  refundId?: string | null;
  stripeRefundCreated?: number | null;
}) {
  const feeRefunds = await params.stripe.applicationFees.listRefunds(
    params.applicationFeeId,
    { limit: 100 }
  );
  const matchedRefundId = params.stripeRefundCreated
    ? feeRefunds.data.reduce<Stripe.FeeRefund | null>((closest, candidate) =>
        !closest ||
        Math.abs(candidate.created - params.stripeRefundCreated!) <
          Math.abs(closest.created - params.stripeRefundCreated!)
          ? candidate
          : closest,
      null)?.id
    : null;
  for (const feeRefund of feeRefunds.data) {
    const { data: movement, error } = await params.admin.rpc(
      "record_drimli_commission_movement",
      {
        p_provider_id: params.payment.provider_id,
        p_payment_id: params.payment.id,
        p_refund_id:
          feeRefund.id === matchedRefundId ? params.refundId ?? null : null,
        p_movement_type: "refunded",
        p_amount: feeRefund.amount,
        p_currency: feeRefund.currency.toUpperCase(),
        p_effective_at: new Date(feeRefund.created * 1000).toISOString(),
        p_stripe_reference: `application_fee_refund:${feeRefund.id}`,
      }
    );
    if (error) throw error;
    const { data: note, error: noteError } = await params.admin.rpc(
      "create_drimli_commission_credit_note",
      { p_movement_id: movement.id, p_issued_at: new Date().toISOString() }
    );
    if (noteError) throw noteError;
    if (note) await ensureDrimliCreditNotePdf(params.admin, note);
  }
}
