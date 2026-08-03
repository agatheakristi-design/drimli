import crypto from "node:crypto";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export type GoogleMeetFailureStage =
  | "integration_lookup"
  | "integration_missing"
  | "refresh_token_missing"
  | "calendar_scope_missing"
  | "oauth_refresh"
  | "token_storage"
  | "calendar_insert"
  | "conference_creation"
  | "hangout_link_retrieval"
  | "supabase_write"
  | "appointment_reload"
  | "email_send";

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
}) {
  const { data: integration, error } = await supabaseAdmin
    .from("integrations")
    .select("access_token, refresh_token, expires_at, scope")
    .eq("provider_id", params.providerId)
    .eq("provider", "google")
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

  if (!integration.scope?.includes("googleapis.com/auth/calendar")) {
    throw new GoogleMeetError(
      "calendar_scope_missing",
      "Google Calendar scope missing. Reconnect the Google account."
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expires_at
      ? new Date(integration.expires_at).getTime()
      : undefined,
  });

  try {
    await oauth2Client.getAccessToken();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new GoogleMeetError(
      "oauth_refresh",
      `Google OAuth refresh failed: ${message}`
    );
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
      .eq("provider", "google");

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
  let event;

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
    });
    event = response.data;
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error !== null
        ? "code" in error && error.code === 409
          ? 409
          : "response" in error &&
              typeof error.response === "object" &&
              error.response !== null &&
              "status" in error.response
            ? error.response.status
            : null
        : null;

    if (status !== 409) {
      throw new GoogleMeetError(
        "calendar_insert",
        "Google Calendar event insertion failed."
      );
    }

    try {
      const existingEvent = await calendar.events.get({
        calendarId: "primary",
        eventId: calendarEventId,
      });
      event = existingEvent.data;
    } catch {
      throw new GoogleMeetError(
        "calendar_insert",
        "Existing Google Calendar event could not be retrieved."
      );
    }
  }

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

    await new Promise((resolve) => setTimeout(resolve, 400));

    let refreshedEvent;
    try {
      refreshedEvent = await calendar.events.get({
        calendarId: "primary",
        eventId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new GoogleMeetError(
        "hangout_link_retrieval",
        `Google Meet link retrieval failed: ${message}`
      );
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

  return {
    eventId,
    hangoutLink,
  };
}
