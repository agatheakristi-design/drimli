export const REFUNDABLE_POLICY = "moderate" as const;
export const NO_REFUND_POLICY = "non_refundable" as const;
export const REFUND_DEADLINE_HOURS = 48;
export const PAYOUT_DELAY_MINUTES = 15;
export const MAX_REFUNDABLE_HOLD_DAYS = 80;

export type CancellationPolicy =
  | "flexible"
  | typeof REFUNDABLE_POLICY
  | typeof NO_REFUND_POLICY;

export function isSelectablePolicy(value: string): value is typeof REFUNDABLE_POLICY | typeof NO_REFUND_POLICY {
  return value === REFUNDABLE_POLICY || value === NO_REFUND_POLICY;
}

export function refundDeadlineHours(policy: CancellationPolicy) {
  if (policy === "flexible") return 24;
  if (policy === REFUNDABLE_POLICY) return REFUND_DEADLINE_HOURS;
  return null;
}

export function refundDeadline(startIso: string, hours: number) {
  return new Date(Date.parse(startIso) - hours * 60 * 60 * 1000);
}

export function canRefundAt(startIso: string, hours: number, now: string | Date) {
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  return nowMs <= refundDeadline(startIso, hours).getTime();
}

export function payoutEligibleAt(endIso: string) {
  return new Date(Date.parse(endIso) + PAYOUT_DELAY_MINUTES * 60 * 1000);
}

export function isWithinRefundableHoldLimit(paidAt: string | Date, endIso: string) {
  const paidMs = typeof paidAt === "string" ? Date.parse(paidAt) : paidAt.getTime();
  return Date.parse(endIso) - paidMs <= MAX_REFUNDABLE_HOLD_DAYS * 24 * 60 * 60 * 1000;
}

export function providerPayableAmount(amountPaid: number, applicationFee: number, refundedAmount = 0) {
  return Math.max(0, amountPaid - applicationFee - refundedAmount);
}
