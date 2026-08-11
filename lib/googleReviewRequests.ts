export const GOOGLE_REVIEW_DELAY_MS = 5 * 60 * 1000;

export function hasReviewRequestAdminAccess(
  authorization: string | null,
  secret: string
) {
  return secret.length > 0 && authorization === `Bearer ${secret}`;
}

export function isGoogleReviewAutomationEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export type GoogleReviewRequestCandidate = {
  appointmentId: string;
  status: string;
  endDateTime: string;
  clientEmail: string | null;
  sentAt: string | null;
  providerName: string | null;
  googlePlaceId: string | null;
};

export type GoogleReviewRequestDependencies = {
  getReviewUrl: (placeId: string) => Promise<string>;
  sendEmail: (payload: {
    appointmentId: string;
    to: string;
    providerName: string;
    reviewUrl: string;
    idempotencyKey?: string;
  }) => Promise<unknown>;
  markSent: (appointmentId: string, sentAt: string) => Promise<void>;
};

export function isGoogleReviewRequestDue(
  candidate: GoogleReviewRequestCandidate,
  now: Date
) {
  const endTime = Date.parse(candidate.endDateTime);
  return (
    candidate.status === "confirmed" &&
    Boolean(candidate.clientEmail?.trim()) &&
    candidate.sentAt === null &&
    Boolean(candidate.providerName?.trim()) &&
    Boolean(candidate.googlePlaceId?.trim()) &&
    Number.isFinite(endTime) &&
    endTime + GOOGLE_REVIEW_DELAY_MS <= now.getTime()
  );
}

export async function processGoogleReviewRequest(
  candidate: GoogleReviewRequestCandidate,
  dependencies: GoogleReviewRequestDependencies,
  now: Date
) {
  if (!isGoogleReviewRequestDue(candidate, now)) return "skipped" as const;

  const appointmentId = candidate.appointmentId;
  const to = candidate.clientEmail!.trim();
  const providerName = candidate.providerName!.trim();
  const placeId = candidate.googlePlaceId!.trim();
  const reviewUrl = await dependencies.getReviewUrl(placeId);

  await dependencies.sendEmail({
    appointmentId,
    to,
    providerName,
    reviewUrl,
  });
  await dependencies.markSent(appointmentId, now.toISOString());
  return "sent" as const;
}
