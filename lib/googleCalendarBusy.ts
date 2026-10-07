import { google, type calendar_v3 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { hasGoogleCalendarScope } from "@/lib/googleOAuthScopes";
import { zonedDateTimeToIso } from "@/lib/booking/slotCutoff";

export type GoogleCalendarBusyErrorCode =
  | "invalid_window" | "configuration" | "integration_lookup"
  | "integration_missing" | "refresh_token_missing" | "calendar_scope_missing"
  | "google_unavailable" | "google_rate_limited" | "google_authorization"
  | "google_request" | "token_storage" | "invalid_response";

export class GoogleCalendarBusyError extends Error {
  constructor(public readonly code: GoogleCalendarBusyErrorCode) {
    // Never expose Google response bodies, credentials or event details.
    super(`Google Calendar busy lookup failed (${code}).`);
    this.name = "GoogleCalendarBusyError";
  }
}

function googleError(error: unknown): GoogleCalendarBusyError {
  const value = error as { code?: unknown; response?: { status?: number }; cause?: { code?: unknown } } | null;
  const status = value?.response?.status ?? (typeof value?.code === "number" ? value.code : undefined);
  if (status && status >= 500 && status <= 599) return new GoogleCalendarBusyError("google_unavailable");
  if (status === 429) return new GoogleCalendarBusyError("google_rate_limited");
  if (status === 401 || status === 403 || status === 400) return new GoogleCalendarBusyError("google_authorization");
  const networkCodes = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "ENETUNREACH"];
  if (networkCodes.includes(String(value?.code ?? value?.cause?.code))) return new GoogleCalendarBusyError("google_unavailable");
  return new GoogleCalendarBusyError("google_request");
}

function boundary(value: calendar_v3.Schema$EventDateTime | undefined, calendarZone: string | null | undefined) {
  if (value?.dateTime) {
    const time = Date.parse(value.dateTime);
    if (Number.isFinite(time) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value.dateTime)) return time;
  }
  if (value?.date && calendarZone) {
    try {
      // Google all-day end.date is exclusive. Convert each local midnight separately for DST.
      return Date.parse(zonedDateTimeToIso(value.date, "00:00", calendarZone));
    } catch {
      throw new GoogleCalendarBusyError("invalid_response");
    }
  }
  throw new GoogleCalendarBusyError("invalid_response");
}

/** Server-only usage. Reads Google events; the only write is refreshed credentials. */
export async function getGoogleCalendarBusy({ providerId, start, end }: {
  providerId: string;
  start: string;
  end: string;
}): Promise<{ start: string; end: string }[]> {
  if (typeof window !== "undefined") throw new GoogleCalendarBusyError("configuration");
  const from = Date.parse(start);
  const until = Date.parse(end);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;
  if (!providerId?.trim() || !iso.test(start) || !iso.test(end) || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
    throw new GoogleCalendarBusyError("invalid_window");
  }
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key,
    GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REDIRECT_URI: redirect } = process.env;
  if (!url || !key || !clientId || !secret || !redirect) throw new GoogleCalendarBusyError("configuration");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: integration, error } = await admin.from("integrations")
    .select("access_token, refresh_token, expires_at, scope")
    .eq("provider_id", providerId).eq("provider", "google").maybeSingle();
  if (error) throw new GoogleCalendarBusyError("integration_lookup");
  if (!integration) throw new GoogleCalendarBusyError("integration_missing");
  if (!integration.refresh_token) throw new GoogleCalendarBusyError("refresh_token_missing");
  if (!hasGoogleCalendarScope(integration.scope)) throw new GoogleCalendarBusyError("calendar_scope_missing");

  const oauth = new google.auth.OAuth2(clientId, secret, redirect);
  const expiry = Date.parse(integration.expires_at ?? "");
  oauth.setCredentials({ access_token: integration.access_token, refresh_token: integration.refresh_token,
    expiry_date: Number.isFinite(expiry) ? expiry : 0 });
  let storedToken = integration.access_token;
  let storedExpiry = Number.isFinite(expiry) ? expiry : undefined;
  async function persistToken() {
    const credentials = oauth.credentials;
    if (credentials.access_token && (credentials.access_token !== storedToken || credentials.expiry_date !== storedExpiry)) {
      const { error: writeError } = await admin.from("integrations").update({
        access_token: credentials.access_token,
        expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      }).eq("provider_id", providerId).eq("provider", "google");
      if (writeError) throw new GoogleCalendarBusyError("token_storage");
      storedToken = credentials.access_token;
      storedExpiry = credentials.expiry_date ?? undefined;
    }
  }
  try {
    await oauth.getAccessToken();
  } catch (error: unknown) {
    throw googleError(error);
  }
  await persistToken();
  const calendar = google.calendar({ version: "v3", auth: oauth });
  const intervals: { start: string; end: string }[] = [];
  let pageToken: string | undefined;
  const seenPages = new Set<string>();
  do {
    let data: calendar_v3.Schema$Events;
    try {
      const response = await calendar.events.list({
        calendarId: "primary", timeMin: new Date(from).toISOString(), timeMax: new Date(until).toISOString(),
        singleEvents: true, showDeleted: false, maxResults: 2500, pageToken,
        fields: "nextPageToken,timeZone,items(status,transparency,start,end)",
      }, { timeout: 3000 });
      data = response.data;
    } catch (error: unknown) {
      throw googleError(error);
    } finally {
      // The Google client may also refresh automatically while listing subsequent pages.
      await persistToken();
    }
    for (const event of data.items ?? []) {
      if (event.status === "cancelled" || event.transparency === "transparent") continue;
      const eventStart = boundary(event.start, data.timeZone);
      const eventEnd = boundary(event.end, data.timeZone);
      if (eventEnd <= eventStart) throw new GoogleCalendarBusyError("invalid_response");
      if (eventStart < until && eventEnd > from) {
        intervals.push({ start: new Date(Math.max(from, eventStart)).toISOString(), end: new Date(Math.min(until, eventEnd)).toISOString() });
      }
    }
    pageToken = data.nextPageToken || undefined;
    if (pageToken && seenPages.has(pageToken)) throw new GoogleCalendarBusyError("invalid_response");
    if (pageToken) seenPages.add(pageToken);
  } while (pageToken);
  return intervals.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}
