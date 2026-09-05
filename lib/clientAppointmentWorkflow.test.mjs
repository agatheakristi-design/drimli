import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientCancel = readFileSync(new URL("../app/api/rendez-vous/[token]/cancel/route.ts", import.meta.url), "utf8");
const clientMove = readFileSync(new URL("../app/api/rendez-vous/[token]/reschedule/route.ts", import.meta.url), "utf8");
const providerMove = readFileSync(new URL("../app/api/appointments/[id]/reschedule/route.ts", import.meta.url), "utf8");
const providerCancel = readFileSync(new URL("../app/api/stripe/refund/route.ts", import.meta.url), "utf8");
const refundService = readFileSync(new URL("./appointmentRefund.ts", import.meta.url), "utf8");
const moveService = readFileSync(new URL("./appointmentReschedule.ts", import.meta.url), "utf8");
const clientUi = readFileSync(new URL("../app/rendez-vous/[token]/AppointmentManagement.tsx", import.meta.url), "utf8");
const guardedMoveMigration = readFileSync(new URL("../supabase/migrations/20260905140000_guard_concurrent_appointment_reschedules.sql", import.meta.url), "utf8");

test("client actions resolve exactly one appointment from the opaque join token", () => {
  assert.match(clientCancel, /\.eq\("join_token", token\)\.maybeSingle\(\)/);
  assert.match(clientMove, /\.eq\("join_token", token\)\.maybeSingle\(\)/);
  assert.doesNotMatch(clientCancel, /body\?\.appointmentId/);
});

test("client and provider actions share the same business engines", () => {
  assert.match(clientCancel, /refundAppointmentInFull/);
  assert.match(providerCancel, /refundAppointmentInFull/);
  assert.match(clientMove, /reschedulePaidAppointment/);
  assert.match(providerMove, /reschedulePaidAppointment/);
});

test("client permissions are enforced server-side before either action", () => {
  assert.match(clientCancel, /clientAppointmentPermissions/);
  assert.match(clientCancel, /!permissions\.canCancel/);
  assert.match(clientMove, /clientAppointmentPermissions/);
  assert.match(clientMove, /!permissions\.canReschedule/);
});

test("rescheduling preserves the existing appointment and reuses atomic SQL protection", () => {
  assert.match(moveService, /reschedule_paid_appointment_guarded/);
  assert.doesNotMatch(moveService, /\.insert\(/);
  assert.match(clientMove, /\/api\/slots/);
  assert.match(guardedMoveMigration, /for update/i);
  assert.match(guardedMoveMigration, /start_datetime is distinct from p_expected_start/i);
  assert.match(guardedMoveMigration, /appointment_reschedule_audit/i);
});

test("refund keeps the application fee and uses existing idempotency protections", () => {
  assert.match(refundService, /refundDestinationChargePolicy/);
  assert.match(refundService, /begin_drimli_payment_refund/);
  assert.match(refundService, /appointment-refund\//);
  assert.doesNotMatch(refundService, /refund_application_fee/);
});

test("the client UI prevents double clicks and trusts the server refund result", () => {
  assert.match(clientUi, /const busy = moving \|\| cancelling/);
  assert.match(clientUi, /payload\.refunded !== true/);
  assert.match(clientUi, /Vous avez été remboursé intégralement/);
});
