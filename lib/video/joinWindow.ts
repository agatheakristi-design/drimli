/**
 * Join window rule:
 * - Allowed starting 5 minutes before the appointment
 * - Allowed until 10 minutes after the appointment ends
 */
export function isJoinWindowOpen(params: {
  startsAt: Date;
  endsAt: Date;
  now?: Date;
  notBeforeMinutes?: number; // default 5
  notAfterMinutes?: number;  // default 10
}) {
  const {
    startsAt,
    endsAt,
    now = new Date(),
    notBeforeMinutes = 5,
    notAfterMinutes = 10,
  } = params;

  const notBefore = new Date(startsAt.getTime() - notBeforeMinutes * 60_000);
  const notAfter = new Date(endsAt.getTime() + notAfterMinutes * 60_000);

  return now >= notBefore && now <= notAfter;
}
