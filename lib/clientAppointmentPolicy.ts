import type { CancellationPolicy } from "@/lib/payoutPolicy";

export type ClientAppointmentPermissions = {
  canReschedule: boolean;
  canCancel: boolean;
  message: string;
};

export function clientAppointmentPermissions(
  policy: CancellationPolicy,
  startsAt: string | Date,
  now: string | Date = new Date()
): ClientAppointmentPermissions {
  const startMs = typeof startsAt === "string" ? Date.parse(startsAt) : startsAt.getTime();
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  const hours = policy === "moderate" ? 48 : 24;
  const beforeStrictDeadline = nowMs < startMs - hours * 60 * 60 * 1000;

  if (policy === "moderate") {
    return beforeStrictDeadline
      ? {
          canReschedule: true,
          canCancel: true,
          message: "Vous pouvez déplacer ou annuler votre rendez-vous jusqu’à 48 h avant.",
        }
      : {
          canReschedule: false,
          canCancel: false,
          message: "Le délai de modification et d’annulation est dépassé.",
        };
  }

  return beforeStrictDeadline
    ? {
        canReschedule: true,
        canCancel: false,
        message: "Vous pouvez déplacer votre rendez-vous jusqu’à 24 h avant.",
      }
    : {
        canReschedule: false,
        canCancel: false,
        message: "Ce rendez-vous ne peut plus être modifié.",
      };
}
