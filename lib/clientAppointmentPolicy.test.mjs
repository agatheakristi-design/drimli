import assert from "node:assert/strict";
import test from "node:test";
import { clientAppointmentPermissions } from "./clientAppointmentPolicy.ts";

const start = "2026-09-10T12:00:00.000Z";

test("no-refund clients may only reschedule strictly before 48 hours", () => {
  assert.deepEqual(clientAppointmentPermissions("non_refundable", start, "2026-09-08T11:59:59.999Z"), {
    canReschedule: true,
    canCancel: false,
  });
  assert.equal(clientAppointmentPermissions("non_refundable", start, "2026-09-08T12:00:00.000Z").canReschedule, false);
});

test("refundable clients may reschedule and cancel strictly before 48 hours", () => {
  const allowed = clientAppointmentPermissions("moderate", start, "2026-09-08T11:59:59.999Z");
  assert.equal(allowed.canReschedule, true);
  assert.equal(allowed.canCancel, true);
  const expired = clientAppointmentPermissions("moderate", start, "2026-09-08T12:00:00.000Z");
  assert.equal(expired.canReschedule, false);
  assert.equal(expired.canCancel, false);
});

test("legacy policies never expose client cancellation", () => {
  assert.equal(clientAppointmentPermissions("flexible", start, "2026-09-01T12:00:00.000Z").canCancel, false);
});
