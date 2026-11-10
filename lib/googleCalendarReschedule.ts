import { google, type calendar_v3 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasGoogleCalendarScope } from "@/lib/googleOAuthScopes";

type CalendarAppointment = {
  id: string; provider_id: string; status: string;
  start_datetime: string; end_datetime: string;
  video_provider: string | null; video_room_id: string | null; video_join_url: string | null;
};
export class CalendarSynchronizationError extends Error {
  constructor(public readonly code: string) {
    super("La synchronisation du calendrier reste à vérifier. Le déplacement n’est pas confirmé.");
    this.name = "CalendarSynchronizationError";
  }
}
const fields = "id,provider_id,status,start_datetime,end_datetime,video_provider,video_room_id,video_join_url";
const sameDates = (a: { start_datetime: string; end_datetime: string }, b: { start_datetime: string; end_datetime: string }) =>
  Date.parse(a.start_datetime) === Date.parse(b.start_datetime) && Date.parse(a.end_datetime) === Date.parse(b.end_datetime);
function eventDates(event: calendar_v3.Schema$Event) {
  return { start_datetime: event.start?.dateTime ?? "", end_datetime: event.end?.dateTime ?? "" };
}
function validateEvent(event: calendar_v3.Schema$Event, appointment: CalendarAppointment, accountEmail: string) {
  const meet = event.hangoutLink || event.conferenceData?.entryPoints?.find(entry => entry.entryPointType === "video")?.uri;
  if (event.id !== appointment.video_room_id || event.status === "cancelled" || event.recurringEventId || event.recurrence?.length
    || !event.etag || !event.start?.dateTime || !event.end?.dateTime
    || !Number.isFinite(Date.parse(event.start.dateTime)) || !Number.isFinite(Date.parse(event.end.dateTime))
    || !meet || meet !== appointment.video_join_url
    || event.organizer?.email?.toLowerCase() !== accountEmail.toLowerCase()) {
    throw new CalendarSynchronizationError("event_identity_unconfirmed");
  }
}

/** Never inserts an event or changes conference data. GET-before-DB-read + If-Match
 * prevents an older worker overwriting a newer, already synchronized move. */
export async function synchronizeAppointmentCalendar(params: {
  admin: SupabaseClient; appointmentId: string; providerId: string;
  repair?: boolean; expected?: { start_datetime: string; end_datetime: string };
}) {
  const { admin, appointmentId, providerId, repair = false } = params;
  const deadline = Date.now() + 18_000;
  const options = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CalendarSynchronizationError("time_budget");
    const timeout = Math.min(2_000, remaining);
    return { timeout, retry: false as const, signal: AbortSignal.timeout(timeout) };
  };
  const readAppointment = async () => {
    const { data, error } = await admin.from("appointments").select(fields)
      .eq("id", appointmentId).eq("provider_id", providerId).abortSignal(options().signal).maybeSingle();
    if (error || !data || data.status !== "confirmed" || data.video_provider !== "google_meet"
      || !data.video_room_id || !data.video_join_url) throw new CalendarSynchronizationError("appointment_unavailable");
    return data as CalendarAppointment;
  };
  const readAuditVersion = async () => {
    const { count, error } = await admin.from("appointment_reschedule_audit")
      .select("id", { count: "exact", head: true }).eq("appointment_id", appointmentId)
      .eq("provider_id", providerId).abortSignal(options().signal);
    if (error || count === null || count === undefined) throw new CalendarSynchronizationError("audit_unavailable");
    return count;
  };
  const target = await readAppointment();
  // Audit rows are appended by the same SQL transaction as date changes. Their
  // count detects an intervening A -> B -> A move, even if dates look identical.
  const auditVersion = await readAuditVersion();
  if (params.expected && !sameDates(target, params.expected)) throw new CalendarSynchronizationError("appointment_changed");
  const { data: integration, error } = await admin.from("integrations")
    .select("account_email,access_token,refresh_token,expires_at,scope")
    .eq("provider_id", providerId).eq("provider", "google").abortSignal(options().signal).maybeSingle();
  if (error || !integration?.refresh_token || !integration.account_email || !hasGoogleCalendarScope(integration.scope)) {
    throw new CalendarSynchronizationError("google_reconnection_required");
  }
  const oauth = new google.auth.OAuth2({ clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI,
    transporterOptions: options() });
  oauth.setCredentials({ access_token: integration.access_token, refresh_token: integration.refresh_token,
    expiry_date: integration.expires_at ? Date.parse(integration.expires_at) : undefined });
  try { await oauth.getAccessToken(); } catch { throw new CalendarSynchronizationError("google_reconnection_required"); }
  if (oauth.credentials.access_token && oauth.credentials.access_token !== integration.access_token) {
    const { error: storageError } = await admin.from("integrations").update({ access_token: oauth.credentials.access_token,
      expires_at: oauth.credentials.expiry_date ? new Date(oauth.credentials.expiry_date).toISOString() : null })
      .eq("provider_id", providerId).eq("provider", "google").abortSignal(options().signal);
    if (storageError) throw new CalendarSynchronizationError("credential_storage_failed");
  }
  const calendar = google.calendar({ version: "v3", auth: oauth });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data: event } = await calendar.events.get({ calendarId: "primary", eventId: target.video_room_id! }, options());
      validateEvent(event, target, integration.account_email);
      // Check DB AFTER Google GET. A stale move must not patch a newer event version.
      const current = await readAppointment();
      if (await readAuditVersion() !== auditVersion || !sameDates(current, target) || current.video_room_id !== target.video_room_id || current.video_join_url !== target.video_join_url) {
        throw new CalendarSynchronizationError("appointment_changed");
      }
      if (sameDates(eventDates(event), target)) return { coherent: true, appointment: current };
      if (!repair) return { coherent: false, appointment: current };
      await calendar.events.patch({ calendarId: "primary", eventId: target.video_room_id!, conferenceDataVersion: 1,
        sendUpdates: "none", requestBody: {
          start: { dateTime: target.start_datetime, ...(event.start?.timeZone ? { timeZone: event.start.timeZone } : {}) },
          end: { dateTime: target.end_datetime, ...(event.end?.timeZone ? { timeZone: event.end.timeZone } : {}) },
        } }, { ...options(), headers: { "If-Match": event.etag! } });
      // A PATCH response is not proof: always re-read Google and the database.
      const verified = await calendar.events.get({ calendarId: "primary", eventId: target.video_room_id! }, options());
      validateEvent(verified.data, target, integration.account_email);
      const latest = await readAppointment();
      if (await readAuditVersion() !== auditVersion || !sameDates(latest, target) || latest.video_room_id !== target.video_room_id || latest.video_join_url !== target.video_join_url) {
        throw new CalendarSynchronizationError("appointment_changed");
      }
      if (sameDates(eventDates(verified.data), target)) return { coherent: true, appointment: latest };
    } catch (failure: unknown) {
      if (failure instanceof CalendarSynchronizationError) throw failure;
      const e = failure as { code?: unknown; response?: { status?: number } };
      const status = e.response?.status ?? e.code;
      // Revoked/missing/cancelled events need intervention; never create a replacement.
      if ([400, 401, 403, 404, 410].includes(Number(status))) throw new CalendarSynchronizationError("google_intervention_required");
      // A timeout or 412 is ambiguous: the next attempt starts with GET, never blind PATCH.
      if (attempt === 2) break;
    }
  }
  throw new CalendarSynchronizationError("google_result_unconfirmed");
}

/** Existing SQL audit is the durable intent. No new dates are written by recovery. */
export async function latestAppointmentMove(admin: SupabaseClient, appointmentId: string, providerId: string) {
  const { data, error } = await admin.from("appointment_reschedule_audit")
    .select("id,new_start_datetime,new_end_datetime,actor")
    .eq("appointment_id", appointmentId).eq("provider_id", providerId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
  if (error) throw new CalendarSynchronizationError("audit_unavailable");
  return data as null | { id: string; new_start_datetime: string; new_end_datetime: string; actor: string | null };
}

export async function resumeAppointmentMove(admin: SupabaseClient, appointmentId: string, providerId: string) {
  const audit = await latestAppointmentMove(admin, appointmentId, providerId);
  if (!audit) throw new CalendarSynchronizationError("move_not_found");
  const result = await synchronizeAppointmentCalendar({ admin, appointmentId, providerId, repair: true,
    expected: { start_datetime: audit.new_start_datetime, end_datetime: audit.new_end_datetime } });
  if (audit.actor === "client") {
    const { notifyProfessionalAppointment } = await import("@/lib/professionalAppointmentAlerts");
    await notifyProfessionalAppointment(admin, "rescheduled", audit.id);
  }
  return result.appointment;
}
