export function isGoogleMeetUrl(
  value: string | null | undefined
): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === "https://meet.google.com";
  } catch {
    return false;
  }
}

export function getAuthorizedClientMeetUrl(params: {
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  videoProvider: string | null;
  videoJoinUrl: string | null;
  now?: Date;
}) {
  if (
    params.status !== "confirmed" ||
    params.videoProvider !== "google_meet" ||
    !isGoogleMeetUrl(params.videoJoinUrl) ||
    !params.startsAt ||
    !params.endsAt
  ) {
    return null;
  }

  const startsAt = new Date(params.startsAt);
  const endsAt = new Date(params.endsAt);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    startsAt >= endsAt ||
    !isJoinWindowOpen({ startsAt, endsAt, now: params.now })
  ) {
    return null;
  }

  return params.videoJoinUrl;
}
import { isJoinWindowOpen } from "./joinWindow";
