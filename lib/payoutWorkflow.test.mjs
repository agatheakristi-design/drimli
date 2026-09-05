import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260822120000_add_controlled_provider_payouts.sql", import.meta.url), "utf8");
const processor = readFileSync(new URL("./providerPayouts.ts", import.meta.url), "utf8");
const refundRoute = readFileSync(new URL("../app/api/stripe/refund/route.ts", import.meta.url), "utf8");
const cancellationMigration = readFileSync(new URL("../supabase/migrations/20260905120000_preserve_payout_on_non_refunded_cancellation.sql", import.meta.url), "utf8");
const payableCancellationMigration = readFileSync(new URL("../supabase/migrations/20260905130000_release_non_refunded_cancellation_payouts.sql", import.meta.url), "utf8");
const appointmentDetails = readFileSync(new URL("../app/components/calendar/AppointmentDetails.tsx", import.meta.url), "utf8");

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

test("appointment cancellation is decided from the immutable checkout snapshot", () => {
  assert.match(refundRoute, /from\("billing_checkout_snapshots"\)/);
  assert.match(refundRoute, /shouldRefundCancellation/);
  assert.match(refundRoute, /cancel_paid_appointment_without_refund/);
  assert.doesNotMatch(appointmentDetails, /Annuler et rembourser intégralement/);
  assert.doesNotMatch(appointmentDetails, /Annuler sans remboursement/);
});

test("a cancellation without refund preserves the provider payout", () => {
  assert.match(cancellationMigration, /status = 'cancelled_by_provider'/);
  assert.doesNotMatch(cancellationMigration, /set status = 'cancelled'/);
  assert.doesNotMatch(cancellationMigration, /payable_amount = 0/);
});

test("a cancellation without refund becomes immediately payout eligible", () => {
  assert.match(payableCancellationMigration, /set eligible_at = now\(\), updated_at = now\(\)/i);
  assert.match(payableCancellationMigration, /a\.status = 'cancelled_by_provider'/i);
  assert.match(payableCancellationMigration, /c\.refunded_amount = 0/i);
  assert.match(payableCancellationMigration, /succeeded_refund\.status = 'succeeded'/i);
});

test("refunded cancellations remain excluded from payouts", () => {
  assert.match(migration, /when greatest\(refunded_amount, p_refunded_amount\) >= amount_paid then 'cancelled'/i);
  assert.match(migration, /payable_amount = greatest\(0, amount_paid - application_fee_amount - greatest\(refunded_amount, p_refunded_amount\)\)/i);
  assert.match(payableCancellationMigration, /c\.status = 'pending'/i);
});

test("payout retries keep the existing unique and idempotent batch protections", () => {
  assert.match(payableCancellationMigration, /for update of c skip locked/i);
  assert.match(payableCancellationMigration, /idempotency_key/i);
  assert.match(migration, /payment_id uuid not null unique references public\.drimli_payments/i);
});
