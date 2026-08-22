import assert from "node:assert/strict";
import test from "node:test";
import {
  canRefundAt,
  isSelectablePolicy,
  isWithinRefundableHoldLimit,
  payoutEligibleAt,
  providerPayableAmount,
  refundDeadline,
} from "./payoutPolicy.ts";

test("only the two new policies are selectable", () => {
  assert.equal(isSelectablePolicy("moderate"), true);
  assert.equal(isSelectablePolicy("non_refundable"), true);
  assert.equal(isSelectablePolicy("flexible"), false);
});

test("refund deadline is exactly 48 hours before the appointment", () => {
  assert.equal(refundDeadline("2026-09-20T12:00:00.000Z", 48).toISOString(), "2026-09-18T12:00:00.000Z");
});

test("refund is accepted at the exact deadline and refused immediately after", () => {
  assert.equal(canRefundAt("2026-09-20T12:00:00.000Z", 48, "2026-09-18T12:00:00.000Z"), true);
  assert.equal(canRefundAt("2026-09-20T12:00:00.000Z", 48, "2026-09-18T12:00:00.001Z"), false);
});

test("refundable bookings respect the 80 day safety limit", () => {
  const paidAt = new Date("2026-08-01T12:00:00.000Z");
  assert.equal(isWithinRefundableHoldLimit(paidAt, "2026-10-20T12:00:00.000Z"), true);
  assert.equal(isWithinRefundableHoldLimit(paidAt, "2026-10-20T12:00:00.001Z"), false);
});

test("payout becomes eligible 15 minutes after the appointment end", () => {
  assert.equal(payoutEligibleAt("2026-08-10T10:00:00.000Z").toISOString(), "2026-08-10T10:15:00.000Z");
});

test("a full refund never creates a negative payout allocation", () => {
  assert.equal(providerPayableAmount(10_000, 500, 10_000), 0);
  assert.equal(providerPayableAmount(10_000, 500, 0), 9_500);
});
