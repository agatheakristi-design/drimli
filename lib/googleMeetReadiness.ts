import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { hasGoogleCalendarScope } from "@/lib/googleOAuthScopes";

export const GOOGLE_MEET_BOOKING_UNAVAILABLE_MESSAGE =
  "La réservation est temporairement indisponible. Veuillez réessayer plus tard.";

export type GoogleMeetReadiness = {
  connected: boolean;
  reason: "not_connected" | "refresh_token_missing" | "calendar_scope_missing" |
    "google_authorization" | "google_unavailable" | null;
  email: string | null;
};

/** Checks the authenticated provider's existing Google connection without creating an event. */
export async function getGoogleMeetReadiness(admin: SupabaseClient, providerId: string): Promise<GoogleMeetReadiness> {
  let email: string | null = null;
  try {
    const { data, error } = await admin.from("integrations")
      .select("account_email, access_token, refresh_token, expires_at, scope")
      .eq("provider_id", providerId).eq("provider", "google").maybeSingle();
    if (error) return { connected: false, reason: "google_unavailable", email };
    if (!data) return { connected: false, reason: "not_connected", email };
    email = data.account_email ?? null;
    if (!data.refresh_token) return { connected: false, reason: "refresh_token_missing", email };
    if (!hasGoogleCalendarScope(data.scope)) return { connected: false, reason: "calendar_scope_missing", email };
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri } = process.env;
    if (!clientId || !clientSecret || !redirectUri) return { connected: false, reason: "google_unavailable", email };
    const oauth = new google.auth.OAuth2({ clientId, clientSecret, redirectUri, transporterOptions: { timeout: 3000, retry: false } });
    const expiry = Date.parse(data.expires_at ?? "");
    oauth.setCredentials({ access_token: data.access_token, refresh_token: data.refresh_token,
      expiry_date: Number.isFinite(expiry) ? expiry : 0 });
    const { token } = await oauth.getAccessToken();
    if (!token) return { connected: false, reason: "google_authorization", email };
    const tokenInfo = await oauth.getTokenInfo(token);
    if (!hasGoogleCalendarScope(tokenInfo.scopes.join(" "))) {
      return { connected: false, reason: "calendar_scope_missing", email };
    }
    const calendar = google.calendar({ version: "v3", auth: oauth });
    await calendar.events.list({ calendarId: "primary", maxResults: 1, fields: "kind" }, { timeout: 3000, retry: false });
    return { connected: true, reason: null, email };
  } catch (error: unknown) {
    const failure = error as { code?: unknown; response?: { status?: number; data?: { error?: unknown } } };
    const code = failure?.response?.status ?? failure?.code;
    const revoked = failure?.response?.data?.error === "invalid_grant";
    return { connected: false, reason: revoked || code === 400 || code === 401 || code === 403
      ? "google_authorization" : "google_unavailable", email };
  }
}
