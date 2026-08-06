/**
 * Join window rule:
 * - Allowed starting 10 minutes before the appointment
 * - Allowed until 30 minutes after the appointment ends, inclusive
 */
export type JoinWindowState = "early" | "open" | "ended";

export function getJoinWindowState(params: {
  startsAt: Date;
  endsAt: Date;
  now?: Date;
  notBeforeMinutes?: number;
  notAfterMinutes?: number;
}): JoinWindowState {
  const {
    startsAt,
    endsAt,
    now = new Date(),
    notBeforeMinutes = 10,
    notAfterMinutes = 30,
  } = params;

  const notBefore = new Date(startsAt.getTime() - notBeforeMinutes * 60_000);
  const notAfter = new Date(endsAt.getTime() + notAfterMinutes * 60_000);

  if (now < notBefore) return "early";
  if (now <= notAfter) return "open";
  return "ended";
}

export function isJoinWindowOpen(params: {
  startsAt: Date;
  endsAt: Date;
  now?: Date;
  notBeforeMinutes?: number;
  notAfterMinutes?: number;
}) {
  return getJoinWindowState(params) === "open";
}
