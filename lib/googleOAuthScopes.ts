export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";

export function hasGoogleCalendarScope(scope: string | null | undefined): boolean {
  // OAuth scopes are whitespace-separated tokens, not URL prefixes.
  return (scope ?? "").split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
}

export const GOOGLE_MEET_REQUIRED_MESSAGE =
  "Connectez Google Meet avant de configurer les paiements.";
