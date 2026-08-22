import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStripeAccountId } from "@/lib/stripeConnect";
import { setConnectedAccountPayoutMode } from "@/lib/stripePayouts";

type Batch = {
  id: string;
  provider_id: string;
  stripe_account_id: string;
  currency: string;
  amount: number;
  idempotency_key: string;
  status: "processing" | "submitted" | "paid" | "failed";
  stripe_payout_id?: string | null;
};

async function executeBatch(admin: SupabaseClient, stripe: Stripe, batch: Batch) {
  try {
    const balance = await stripe.balance.retrieve({ stripeAccount: batch.stripe_account_id });
    const available = balance.available.find((item) => item.currency === batch.currency.toLowerCase())?.amount ?? 0;
    if (available < batch.amount) {
      await admin.from("drimli_payout_batches").update({
        last_error: "insufficient_available_balance",
        updated_at: new Date().toISOString(),
      }).eq("id", batch.id);
      return { batchId: batch.id, status: "retryable" as const };
    }

    const payout = await stripe.payouts.create(
      {
        amount: batch.amount,
        currency: batch.currency.toLowerCase(),
        metadata: { drimli_payout_batch_id: batch.id },
      },
      { stripeAccount: batch.stripe_account_id, idempotencyKey: batch.idempotency_key }
    );
    const { error } = await admin.rpc("complete_drimli_payout_batch", {
      p_batch_id: batch.id,
      p_stripe_payout_id: payout.id,
      p_stripe_status: payout.status,
      p_paid_at: new Date().toISOString(),
    });
    if (error) throw error;
    return { batchId: batch.id, payoutId: payout.id, status: payout.status };
  } catch (error) {
    await admin.from("drimli_payout_batches").update({
      last_error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      updated_at: new Date().toISOString(),
    }).eq("id", batch.id);
    return { batchId: batch.id, status: "retryable" as const };
  }
}

async function restoreAutomaticPayouts(admin: SupabaseClient, stripe: Stripe, providerId: string) {
  const [{ data: profile }, { count }] = await Promise.all([
    admin.from("profiles")
      .select("cancellation_policy, drimli_payout_mode, stripe_account_id, stripe_connect_account_id")
      .eq("provider_id", providerId)
      .maybeSingle(),
    admin.from("drimli_payout_commitments")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .in("status", ["pending", "refund_processing", "reserved", "submitted"]),
  ]);
  if (!profile || profile.cancellation_policy !== "non_refundable" || profile.drimli_payout_mode !== "manual" || (count ?? 0) > 0) return;
  const resolved = resolveStripeAccountId(profile);
  if (!resolved.accountId || resolved.conflict) return;
  await setConnectedAccountPayoutMode(stripe, resolved.accountId, "automatic");
  await admin.from("profiles").update({ drimli_payout_mode: "automatic" }).eq("provider_id", providerId);
}

export async function processProviderPayouts(params: {
  admin: SupabaseClient;
  stripe: Stripe;
  providerId?: string;
}) {
  const { admin, stripe, providerId } = params;
  const results: Array<Record<string, unknown>> = [];

  let processingQuery = admin.from("drimli_payout_batches").select("*").eq("status", "processing").order("created_at");
  if (providerId) processingQuery = processingQuery.eq("provider_id", providerId);
  const { data: processing, error: processingError } = await processingQuery;
  if (processingError) throw processingError;
  for (const batch of (processing ?? []) as Batch[]) results.push(await executeBatch(admin, stripe, batch));

  let submittedQuery = admin.from("drimli_payout_batches").select("*").eq("status", "submitted");
  if (providerId) submittedQuery = submittedQuery.eq("provider_id", providerId);
  const { data: submitted, error: submittedError } = await submittedQuery;
  if (submittedError) throw submittedError;
  for (const batch of (submitted ?? []) as Batch[]) {
    if (!batch.stripe_payout_id) continue;
    const payout = await stripe.payouts.retrieve(batch.stripe_payout_id, {
      stripeAccount: batch.stripe_account_id,
    });
    await admin.rpc("sync_drimli_payout_batch", {
      p_batch_id: batch.id,
      p_stripe_status: payout.status,
      p_updated_at: new Date().toISOString(),
    });
  }

  let dueQuery = admin.from("drimli_payout_commitments")
    .select("provider_id, currency")
    .eq("status", "pending")
    .lte("eligible_at", new Date().toISOString())
    .gt("payable_amount", 0);
  if (providerId) dueQuery = dueQuery.eq("provider_id", providerId);
  const { data: due, error: dueError } = await dueQuery;
  if (dueError) throw dueError;

  const keys = [...new Map((due ?? []).map((row) => [`${row.provider_id}:${row.currency}`, row])).values()];
  for (const key of keys) {
    const { data: profile } = await admin.from("profiles")
      .select("stripe_account_id, stripe_connect_account_id")
      .eq("provider_id", key.provider_id)
      .maybeSingle();
    const resolved = profile ? resolveStripeAccountId(profile) : null;
    if (!resolved?.accountId || resolved.conflict) continue;
    const batchId = randomUUID();
    const idempotencyKey = `drimli-payout/${batchId}`;
    const { data: claimed, error: claimError } = await admin.rpc("claim_drimli_payout_batch", {
      p_batch_id: batchId,
      p_provider_id: key.provider_id,
      p_stripe_account_id: resolved.accountId,
      p_currency: key.currency,
      p_idempotency_key: idempotencyKey,
      p_now: new Date().toISOString(),
    });
    if (claimError) throw claimError;
    if (claimed) results.push(await executeBatch(admin, stripe, claimed as Batch));
  }

  let manualProfilesQuery = admin.from("profiles")
    .select("provider_id")
    .eq("drimli_payout_mode", "manual");
  if (providerId) manualProfilesQuery = manualProfilesQuery.eq("provider_id", providerId);
  const { data: manualProfiles } = await manualProfilesQuery;
  const providers = [...new Set([
    ...(due ?? []).map((row) => row.provider_id),
    ...(manualProfiles ?? []).map((row) => row.provider_id),
  ])];
  for (const id of providers) await restoreAutomaticPayouts(admin, stripe, id);
  return results;
}
