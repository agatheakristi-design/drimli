import assert from "node:assert/strict";
import test from "node:test";
import { filterClientRescheduleSlots } from "./clientRescheduleSlots.ts";

const slots = [
  { start: "2026-11-19T09:00:00.000Z", end: "2026-11-19T10:00:00.000Z" },
  { start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.001Z" },
];

test("refundable reschedule slots stop at the 80 day payout holding limit", () => {
  assert.deepEqual(filterClientRescheduleSlots({
    slots,
    policySnapshot: "moderate",
    commitmentCreatedAt: "2026-09-01T10:00:00.000Z",
  }), [slots[0]]);
});

test("no-refund reschedule slots retain the availability engine result", () => {
  assert.deepEqual(filterClientRescheduleSlots({
    slots,
    policySnapshot: "non_refundable",
    commitmentCreatedAt: "2026-09-01T10:00:00.000Z",
  }), slots);
});
