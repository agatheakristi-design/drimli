import type { SupabaseClient } from "@supabase/supabase-js";
import { sendProfessionalAppointmentEmail } from "@/lib/email";

export type AppointmentAlertKind = "confirmed" | "rescheduled" | "cancelled";
export type AppointmentAlertPayload = {
  kind: AppointmentAlertKind;
  recipient: string | null;
  client_name: string | null;
  provider_name: string;
  service_title: string;
  start: string;
  end: string;
  old_start?: string;
  old_end?: string;
};

// Permanent DB claim: concurrent calls and later replays must never send again.
// No background queue or automatic retry of failed/uncertain deliveries.
export async function notifyProfessionalAppointment(
  admin: SupabaseClient, kind: AppointmentAlertKind, eventId: string
) {
  try {
    const { data, error } = await admin.rpc("claim_professional_appointment_email", {
      p_kind: kind, p_event_id: eventId,
    });
    if (error) throw new Error("Email claim failed");
    if (!data) return;
    let state: "sent" | "failed" | "uncertain" = "uncertain";
    let emailId: string | null = null;
    try {
      if (!data.recipient) {
        state = "failed";
      } else {
        const sent = await sendProfessionalAppointmentEmail(data as AppointmentAlertPayload, eventId);
        emailId = sent?.id ?? null;
        state = emailId ? "sent" : "uncertain";
      }
    } catch {
      // A timeout can mean Resend accepted the email: do not release the claim.
      state = "uncertain";
    }
    const { error: finishError } = await admin.rpc("finish_professional_appointment_email", {
      p_kind: kind, p_event_id: eventId, p_state: state, p_email_id: emailId,
    });
    if (finishError || state !== "sent") throw new Error("Email requires investigation");
  } catch {
    // Never invalidate a confirmed payment, move or cancellation for an email.
    console.error("[PROFESSIONAL_APPOINTMENT_EMAIL_ATTENTION]", { kind, eventId });
  }
}

export async function notifyClientCancellation(
  admin: SupabaseClient, appointmentId: string, providerId: string, refundId: string
) {
  try {
    const { error } = await admin.rpc("record_client_cancellation_alert", {
      p_id: appointmentId, p_provider_id: providerId, p_refund_id: refundId,
    });
    if (error) throw new Error("Cancellation alert recording failed");
    await notifyProfessionalAppointment(admin, "cancelled", appointmentId);
  } catch {
    console.error("[CLIENT_CANCELLATION_ALERT_ATTENTION]", { appointmentId });
  }
}
