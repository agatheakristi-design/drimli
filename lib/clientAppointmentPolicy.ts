import type { CancellationPolicy } from "@/lib/payoutPolicy";

export type ClientAppointmentPermissions = {
  canReschedule: boolean;
  canCancel: boolean;
};

export const CLIENT_APPOINTMENT_CHANGE_DEADLINE_HOURS = 48;

export function clientAppointmentPermissions(
  policy: CancellationPolicy,
  startsAt: string | Date,
  now: string | Date = new Date()
): ClientAppointmentPermissions {
  const startMs = typeof startsAt === "string" ? Date.parse(startsAt) : startsAt.getTime();
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  const beforeStrictDeadline = nowMs < startMs
    - CLIENT_APPOINTMENT_CHANGE_DEADLINE_HOURS * 60 * 60 * 1000;

  if (policy === "moderate") {
    return beforeStrictDeadline
      ? {
          canReschedule: true,
          canCancel: true,
        }
      : {
          canReschedule: false,
          canCancel: false,
        };
  }

  return beforeStrictDeadline
    ? {
        canReschedule: true,
        canCancel: false,
      }
    : {
        canReschedule: false,
        canCancel: false,
      };
}
