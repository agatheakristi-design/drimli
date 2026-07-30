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

export async function createGoogleMeetAppointment(params: {
  providerId: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  attendeeEmail?: string | null;
}) {
  const { data: integration, error } = await supabaseAdmin
    .from("integrations")
    .select("access_token, refresh_token, expires_at")
    .eq("provider_id", params.providerId)
    .eq("provider", "google")
    .maybeSingle();

  if (error) {
    throw new Error(`Google integration lookup failed: ${error.message}`);
  }

  if (!integration) {
    throw new Error("Google account not connected.");
  }

  if (!integration.refresh_token) {
    throw new Error(
      "Google refresh token missing. Reconnect the Google account."
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

  await oauth2Client.getAccessToken();

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
      console.error(
        "Failed to store refreshed Google token:",
        tokenUpdateError.message
      );
    }
  }

  const calendar = google.calendar({
    version: "v3",
    auth: oauth2Client,
  });

  const response = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    requestBody: {
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
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
        },
      },
    },
  });

  const eventId = response.data.id;
  const hangoutLink =
    response.data.hangoutLink ||
    response.data.conferenceData?.entryPoints?.find(
      (entryPoint) => entryPoint.entryPointType === "video"
    )?.uri;

  if (!eventId) {
    throw new Error("Google Calendar did not return an event id.");
  }

  if (!hangoutLink) {
    throw new Error("Google Calendar did not return a Google Meet link.");
  }

  return {
    eventId,
    hangoutLink,
  };
}
