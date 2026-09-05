import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AppointmentRescheduleError, reschedulePaidAppointment } from "@/lib/appointmentReschedule";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { start?: unknown } | null;
  if (typeof body?.start !== "string" || !Number.isFinite(Date.parse(body.start))) {
    return NextResponse.json({ error: "Nouvelle date invalide." }, { status: 400 });
  }
  const { data: appointment } = await admin.from("appointments")
    .select("id, provider_id, start_datetime, end_datetime, status")
    .eq("id", id)
    .eq("provider_id", auth.user.id)
    .maybeSingle();
  if (!appointment || appointment.status !== "confirmed") {
    return NextResponse.json({ error: "Ce rendez-vous ne peut pas être déplacé." }, { status: 409 });
  }
  try {
    const data = await reschedulePaidAppointment({ admin, appointment, newStartIso: body.start });
    return NextResponse.json({ appointment: data });
  } catch (error) {
    const failure = error instanceof AppointmentRescheduleError
      ? error
      : new AppointmentRescheduleError("Déplacement impossible.", 500);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
