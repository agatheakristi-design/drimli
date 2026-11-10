import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resumeAppointmentMove } from "@/lib/googleCalendarReschedule";
import { clientAppointmentPermissions } from "@/lib/clientAppointmentPolicy";
import type { CancellationPolicy } from "@/lib/payoutPolicy";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!token || token.length > 200) return NextResponse.json({ error: "Lien invalide." }, { status: 404, headers });
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }) },
    });
    const { data, error } = await admin.from("appointments").select("id,provider_id,status")
      .eq("join_token", token).maybeSingle();
    if (error || !data || data.status !== "confirmed") return NextResponse.json({ error: "Rendez-vous indisponible." }, { status: 404, headers });
    // Recovery only: it never accepts or writes a new date and never repeats a payment.
    const appointment = await resumeAppointmentMove(admin, data.id, data.provider_id);
    const { data: snapshot } = await admin.from("billing_checkout_snapshots").select("cancellation_policy")
      .eq("appointment_id", data.id).maybeSingle();
    const permissions = snapshot?.cancellation_policy
      ? clientAppointmentPermissions(snapshot.cancellation_policy as CancellationPolicy, appointment.start_datetime)
      : { canReschedule: false, canCancel: false };
    return NextResponse.json({ appointment: { start_datetime: appointment.start_datetime, end_datetime: appointment.end_datetime }, permissions }, { headers });
  } catch {
    return NextResponse.json({ code: "CALENDAR_SYNC_PENDING", error: "La synchronisation du calendrier reste à vérifier. Le déplacement n’est pas confirmé." }, { status: 503, headers });
  }
}
