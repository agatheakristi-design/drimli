import { NextResponse } from "next/server";
import {
  listDueGoogleReviewRequestAppointmentIds,
  sendGoogleReviewRequestForAppointment,
} from "@/lib/googleReviewRequestServer";
import {
  hasReviewRequestAdminAccess,
  isGoogleReviewAutomationEnabled,
} from "@/lib/googleReviewRequests";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (
    !hasReviewRequestAdminAccess(
      request.headers.get("authorization"),
      process.env.CRON_SECRET ?? ""
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !isGoogleReviewAutomationEnabled(
      process.env.GOOGLE_REVIEW_AUTOMATION_ENABLED
    )
  ) {
    return NextResponse.json({ enabled: false, processed: 0, sent: 0 });
  }

  const now = new Date();
  let appointmentIds: string[];
  try {
    appointmentIds = await listDueGoogleReviewRequestAppointmentIds(now);
  } catch (error: unknown) {
    console.error("[GOOGLE_REVIEW_REQUEST_CRON_ERROR]", {
      stage: "appointments_query",
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const appointmentId of appointmentIds) {
    try {
      const result = await sendGoogleReviewRequestForAppointment(
        appointmentId,
        now
      );
      if (result === "sent") sent += 1;
      else skipped += 1;
    } catch (error: unknown) {
      failed += 1;
      console.error("[GOOGLE_REVIEW_REQUEST_CRON_ERROR]", {
        stage: "appointment_processing",
        appointmentId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    processed: appointmentIds.length,
    sent,
    skipped,
    failed,
  });
}
