import { createClient } from "@supabase/supabase-js";
import { sendGoogleReviewRequestEmail } from "@/lib/email";
import { fetchGoogleReviewUrl } from "@/lib/googlePlaces";
import {
  GOOGLE_REVIEW_DELAY_MS,
  processGoogleReviewRequest,
} from "@/lib/googleReviewRequests";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

type AppointmentRow = {
  id: string;
  provider_id: string;
  status: string;
  end_datetime: string;
  client_email: string | null;
  google_review_request_sent_at: string | null;
};

type DeliveryMode = "automatic" | "admin_test";

export async function listDueGoogleReviewRequestAppointmentIds(now: Date) {
  const dueBefore = new Date(now.getTime() - GOOGLE_REVIEW_DELAY_MS);
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("status", "confirmed")
    .lte("end_datetime", dueBefore.toISOString())
    .is("google_review_request_sent_at", null)
    .not("client_email", "is", null)
    .order("end_datetime", { ascending: true })
    .limit(50)
    .returns<Array<{ id: string }>>();

  if (error) throw error;
  return (data ?? []).map((appointment) => appointment.id);
}

export async function sendGoogleReviewRequestForAppointment(
  appointmentId: string,
  now: Date,
  mode: DeliveryMode = "automatic"
) {
  const { data: appointment, error: appointmentError } = await supabaseAdmin
    .from("appointments")
    .select(
      "id, provider_id, status, end_datetime, client_email, google_review_request_sent_at"
    )
    .eq("id", appointmentId)
    .maybeSingle<AppointmentRow>();

  if (appointmentError) throw appointmentError;
  if (!appointment) return "skipped" as const;

  const [profileResult, googleProfileResult] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("provider_id", appointment.provider_id)
      .maybeSingle<{ full_name: string | null }>(),
    supabaseAdmin
      .from("google_business_profiles")
      .select("google_place_id")
      .eq("provider_id", appointment.provider_id)
      .eq("google_reviews_enabled", true)
      .maybeSingle<{ google_place_id: string }>(),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (googleProfileResult.error) throw googleProfileResult.error;

  const isAdminTest = mode === "admin_test";

  return processGoogleReviewRequest(
    {
      appointmentId: appointment.id,
      status: appointment.status,
      endDateTime: appointment.end_datetime,
      clientEmail: appointment.client_email,
      sentAt: isAdminTest ? null : appointment.google_review_request_sent_at,
      providerName: profileResult.data?.full_name ?? null,
      googlePlaceId: googleProfileResult.data?.google_place_id ?? null,
    },
    {
      getReviewUrl: fetchGoogleReviewUrl,
      sendEmail: (payload) =>
        sendGoogleReviewRequestEmail({
          ...payload,
          idempotencyKey: isAdminTest
            ? `google-review-request-test/${payload.appointmentId}`
            : undefined,
        }),
      markSent: async (id, sentAt) => {
        if (isAdminTest) return;

        const { error } = await supabaseAdmin
          .from("appointments")
          .update({ google_review_request_sent_at: sentAt })
          .eq("id", id)
          .eq("status", "confirmed")
          .is("google_review_request_sent_at", null);
        if (error) throw error;
      },
    },
    now
  );
}
