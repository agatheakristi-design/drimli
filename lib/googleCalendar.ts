import crypto from "node:crypto";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { hasGoogleCalendarScope } from "@/lib/googleOAuthScopes";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export type GoogleMeetFailureStage =
  | "time_budget"
  | "integration_lookup"
  | "integration_missing"
  | "refresh_token_missing"
  | "calendar_scope_missing"
  | "oauth_refresh"
  | "token_storage"
  | "calendar_insert"
  | "conference_creation"
  | "hangout_link_retrieval"
  | "organizer_mismatch"
  | "supabase_write"
  | "appointment_reload"
  | "email_send";

function temporaryGoogleFailure(error: unknown) {
  const value = error as { code?: unknown; response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
  const status = value?.response?.status ?? value?.code;
  return [429, 500, 502, 503, 504, "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(status as string | number) ||
    (status === 403 && Boolean(value.response?.data?.error?.errors?.some(item =>
      item.reason === "rateLimitExceeded" || item.reason === "userRateLimitExceeded")));
}

export class GoogleMeetError extends Error {
  constructor(
    public readonly stage: GoogleMeetFailureStage,
    message: string
  ) {
    super(message);
    this.name = "GoogleMeetError";
  }
}

export async function createGoogleMeetAppointment(params: {
  appointmentId: string;
  providerId: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  attendeeEmail?: string | null;
  deadlineMs?: number;
}) {
  const deadline = Math.min(params.deadlineMs ?? Infinity, Date.now() + 12_000);
  const options = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GoogleMeetError("time_budget", "Google Meet time budget exhausted.");
    return { timeout: Math.min(2_000, remaining), retry: false as const, signal: AbortSignal.timeout(remaining) };
  };
  const signal = options().signal;
  const { data: integration, error } = await supabaseAdmin
    .from("integrations")
    .select("account_email, access_token, refresh_token, expires_at, scope")
    .eq("provider_id", params.providerId)
    .eq("provider", "google")
    .abortSignal(signal)
    .maybeSingle();

  if (error) {
    throw new GoogleMeetError(
      "integration_lookup",
      `Google integration lookup failed: ${error.message}`
    );
  }

  if (!integration) {
    throw new GoogleMeetError(
      "integration_missing",
      "Google account not connected."
    );
  }

  if (!integration.refresh_token) {
    throw new GoogleMeetError(
      "refresh_token_missing",
      "Google refresh token missing. Reconnect the Google account."
    );
  }

  if (!hasGoogleCalendarScope(integration.scope)) {
    throw new GoogleMeetError(
      "calendar_scope_missing",
      "Google Calendar scope missing. Reconnect the Google account."
    );
  }

  const oauth2Client = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    transporterOptions: options(),
  });

  oauth2Client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expires_at
      ? new Date(integration.expires_at).getTime()
      : undefined,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      options();
      await oauth2Client.getAccessToken();
      break;
    } catch (error: unknown) {
      if (!temporaryGoogleFailure(error) || attempt === 2 || Date.now() + 250 >= deadline) {
        throw new GoogleMeetError("oauth_refresh", "Google OAuth refresh failed.");
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  const refreshedCredentials = oauth2Client.credentials;

  if (
    refreshedCredentials.access_token &&
    refreshedCredentials.access_token !== integration.access_token
  ) {
    const { error: tokenUpdateError } = await supabaseAdmin
      .from("integrations")
      .update({
        access_token: refreshedCredentials.access_token,
        expires_at: refreshedCredentials.expiry_date
          ? new Date(refreshedCredentials.expiry_date).toISOString()
          : null,
      })
      .eq("provider_id", params.providerId)
      .eq("provider", "google")
      .abortSignal(signal);

    if (tokenUpdateError) {
      throw new GoogleMeetError(
        "token_storage",
        `Failed to store refreshed Google token: ${tokenUpdateError.message}`
      );
    }
  }

  const calendar = google.calendar({
    version: "v3",
    auth: oauth2Client,
  });

  const calendarEventId = `drimli${crypto
    .createHash("sha256")
    .update(params.appointmentId)
    .digest("hex")
    .slice(0, 40)}`;
  let event: import("googleapis").calendar_v3.Schema$Event | undefined;
  let creationUncertain = false;
  for (let attempt = 0; attempt < 3 && !event; attempt += 1) {
    if (attempt > 0) {
      const delay = attempt * 250;
      if (Date.now() + delay >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    try {
      try {
        const existing = await calendar.events.get({ calendarId: "primary", eventId: calendarEventId }, options());
        event = existing.data;
        break;
      } catch (error: unknown) {
        const status = (error as { code?: number; response?: { status?: number } })?.response?.status ?? (error as { code?: number })?.code;
        if (status !== 404) throw error;
        // After an uncertain insert, a 404 is not enough to risk a second meeting.
        if (creationUncertain) continue;
      }
      try {
        const response = await calendar.events.insert({
          calendarId: "primary",
          conferenceDataVersion: 1,
          requestBody: {
            id: calendarEventId,
            summary: params.title,
            description: params.description,
            start: {
              dateTime: params.start,
            },
            end: {
              dateTime: params.end,
            },
            attendees: params.attendeeEmail
              ? [{ email: params.attendeeEmail }]
              : undefined,
            conferenceData: {
              createRequest: {
                requestId: `meet-${params.appointmentId}`,
                conferenceSolutionKey: {
                  type: "hangoutsMeet",
                },
              },
            },
          },
        }, options());
        event = response.data;
      } catch (error: unknown) {
        const status = (error as { code?: number; response?: { status?: number } })?.response?.status ?? (error as { code?: number })?.code;
        if (status === 409) { creationUncertain = true; continue; }
        if (temporaryGoogleFailure(error)) creationUncertain = true;
        throw error;
      }
    } catch (error: unknown) {
      if (!temporaryGoogleFailure(error)) {
        throw new GoogleMeetError("calendar_insert", "Google Calendar event lookup or creation failed.");
      }
      if (attempt === 2) throw new GoogleMeetError("calendar_insert", "Google Calendar temporary errors exhausted.");
    }
  }
  if (!event) throw new GoogleMeetError("calendar_insert", "Google Calendar creation could not be safely confirmed.");
  if (event.status === "cancelled") throw new GoogleMeetError("calendar_insert", "Google Calendar event is cancelled.");

  const eventId = event.id;

  if (!eventId) {
    throw new GoogleMeetError(
      "calendar_insert",
      "Google Calendar did not return an event id."
    );
  }

  let hangoutLink =
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find(
      (entryPoint) => entryPoint.entryPointType === "video"
    )?.uri;

  for (let attempt = 0; !hangoutLink && attempt < 10; attempt += 1) {
    const conferenceStatus =
      event.conferenceData?.createRequest?.status?.statusCode;

    if (conferenceStatus === "failure") {
      throw new GoogleMeetError(
        "conference_creation",
        "Google Calendar conference creation failed."
      );
    }

    if (Date.now() + 400 >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 400));

    let refreshedEvent;
    try {
      refreshedEvent = await calendar.events.get({
        calendarId: "primary",
        eventId,
      }, options());
    } catch (error: unknown) {
      if (temporaryGoogleFailure(error)) continue;
      throw new GoogleMeetError("hangout_link_retrieval", "Google Meet link retrieval failed.");
    }
    event = refreshedEvent.data;
    hangoutLink =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(
        (entryPoint) => entryPoint.entryPointType === "video"
      )?.uri;
  }

  if (!hangoutLink) {
    const conferenceStatus =
      event.conferenceData?.createRequest?.status?.statusCode ?? "unknown";
    throw new GoogleMeetError(
      "hangout_link_retrieval",
      `Google Calendar did not return a Google Meet link (conference status: ${conferenceStatus}).`
    );
  }

  const connectedGoogleEmail = integration.account_email?.trim() ?? "";
  const organizerEmail = event.organizer?.email?.trim() ?? "";
  const creatorEmail = event.creator?.email?.trim() ?? "";
  const organizerMatchesConnectedAccount = Boolean(
    connectedGoogleEmail &&
      organizerEmail &&
      connectedGoogleEmail.toLowerCase() === organizerEmail.toLowerCase()
  );

  console.log("[GOOGLE_MEET_ORGANIZER]", {
    appointmentId: params.appointmentId,
    providerId: params.providerId,
    connectedGoogleEmail: connectedGoogleEmail || null,
    organizerEmail: organizerEmail || null,
    creatorEmail: creatorEmail || null,
    organizerMatchesConnectedAccount,
    calendarId: "primary",
    eventId,
    conferenceId: event.conferenceData?.conferenceId ?? null,
    hangoutLinkPresent: true,
  });

  if (!organizerMatchesConnectedAccount) {
    throw new GoogleMeetError(
      "organizer_mismatch",
      "Google Calendar organizer does not match the connected professional account."
    );
  }

  return {
    eventId,
    hangoutLink,
  };
}
