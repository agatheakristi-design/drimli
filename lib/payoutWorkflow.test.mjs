import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260822120000_add_controlled_provider_payouts.sql", import.meta.url), "utf8");
const processor = readFileSync(new URL("./providerPayouts.ts", import.meta.url), "utf8");
const refundRoute = readFileSync(new URL("../app/api/stripe/refund/route.ts", import.meta.url), "utf8");

test("payout claims use row locks and unique payment allocations", () => {
  assert.match(migration, /for update of c skip locked/i);
  assert.match(migration, /payment_id uuid not null unique references public\.drimli_payments/i);
  assert.match(migration, /idempotency_key text not null unique/i);
});

test("refund and payout share an atomic commitment state", () => {
  assert.match(migration, /begin_drimli_payment_refund/);
  assert.match(migration, /status = 'refund_processing'/);
  assert.match(migration, /and c\.status = 'pending'/);
  assert.match(refundRoute, /begin_drimli_payment_refund/);
});

test("lost payout responses are retried with a stable Stripe idempotency key", () => {
  assert.match(processor, /eq\("status", "processing"\)/);
  assert.match(processor, /idempotencyKey: batch\.idempotency_key/);
});

test("historical commission refunds remain supported", () => {
  assert.match(migration, /policy_snapshot in \('flexible', 'moderate', 'non_refundable'\)/);
  assert.doesNotMatch(migration, /delete from public\.drimli_commission/);
  assert.match(refundRoute, /syncRefundedCommissionMovements/);
});
