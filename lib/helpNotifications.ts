import type { SupabaseClient } from "@supabase/supabase-js";
import { buildHelpNotificationEmail, sendHelpNotificationEmail, type HelpNotificationEmail } from "@/lib/email";

type Notification = {
  id: string;
  kind: "request" | "reply";
  source_id: string;
  request_id: string;
  lease_token: string;
  payload: HelpNotificationEmail | null;
};

// One message per invocation keeps the job bounded; expired leases recover crashes.
export async function processHelpNotification(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("claim_help_notification");
  if (error) throw new Error("Help notification claim failed");
  const notification = (data as Notification[] | null)?.[0];
  if (!notification) return { processed: 0 };
  return deliverHelpNotification(admin, notification);
}

// Target this new request even when older notifications are waiting for review.
export async function processHelpRequestNotification(admin: SupabaseClient, requestId: string) {
  const { error: queueError } = await admin.from("help_notifications").upsert({
    kind: "request", source_id: requestId, request_id: requestId,
  }, { onConflict: "kind,source_id", ignoreDuplicates: true });
  if (queueError) throw new Error("Help notification enqueue failed; source retained");
  const now = new Date();
  const { data, error } = await admin.from("help_notifications").update({
    state: "processing", attempts: 1, lease_token: crypto.randomUUID(),
    lease_until: new Date(now.getTime() + 5 * 60_000).toISOString(),
  }).eq("kind", "request").eq("source_id", requestId).eq("state", "pending")
    .is("first_send_at", null).eq("attempts", 0).select().maybeSingle();
  if (error) throw new Error("Help notification claim failed; source retained");
  if (!data) return { processed: 0 };
  return deliverHelpNotification(admin, data as Notification);
}

async function deliverHelpNotification(admin: SupabaseClient, notification: Notification) {
  let emailId: string | null = null;
  let failure: string | null = null;
  try {
    let payload = notification.payload;
    if (!payload) {
      const { data: request, error: readError } = await admin.from("help_requests")
        .select("owner_id,subject,message").eq("id", notification.request_id).single();
      if (readError || !request) throw new Error("Source unavailable");
      const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(request.owner_id);
      if (ownerError || !owner.user?.email) throw new Error("Owner unavailable");
      const recipient = notification.kind === "request" ? process.env.DRIMLI_HELP_ADMIN_EMAIL : owner.user.email;
      if (!recipient || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) throw new Error("Recipient configuration missing");
      payload = buildHelpNotificationEmail({
        kind: notification.kind, recipient, requestId: notification.request_id,
        ownerId: request.owner_id, ownerEmail: owner.user.email,
        subject: request.subject, message: request.message, sourceId: notification.source_id,
      });
    }
    const { data: prepared, error: prepareError } = await admin.rpc("prepare_help_notification", {
      p_id: notification.id, p_token: notification.lease_token, p_payload: payload,
    });
    if (prepareError || !prepared) throw new Error("Preparation failed");
    emailId = await sendHelpNotificationEmail(prepared as HelpNotificationEmail, notification.id);
  } catch {
    // No user text, recipient or raw provider errors in logs.
    failure = "send_or_configuration_failed";
  }
  const { data: finished, error: finishError } = await admin.rpc("finish_help_notification", {
    p_id: notification.id, p_token: notification.lease_token,
    p_email_id: emailId, p_error: failure,
  });
  if (finishError || !finished) throw new Error("Help notification result not saved");
  return { processed: 1, sent: Boolean(emailId) };
}
