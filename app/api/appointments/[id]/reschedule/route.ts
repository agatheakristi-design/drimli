import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  const duration = Date.parse(appointment.end_datetime) - Date.parse(appointment.start_datetime);
  const newStart = new Date(body.start);
  const newEnd = new Date(newStart.getTime() + duration);
  if (newStart <= new Date()) return NextResponse.json({ error: "Choisissez une date future." }, { status: 400 });

  const [appointments, blocks] = await Promise.all([
    admin.from("appointments").select("id").eq("provider_id", auth.user.id)
      .in("status", ["pending", "confirmed"]).neq("id", id)
      .lt("start_datetime", newEnd.toISOString()).gt("end_datetime", newStart.toISOString()).limit(1),
    admin.from("provider_blocks").select("id").eq("provider_id", auth.user.id)
      .lt("start_datetime", newEnd.toISOString()).gt("end_datetime", newStart.toISOString()).limit(1),
  ]);
  if (appointments.error || blocks.error) return NextResponse.json({ error: "Vérification du créneau impossible." }, { status: 500 });
  if ((appointments.data?.length ?? 0) || (blocks.data?.length ?? 0)) {
    return NextResponse.json({ error: "Ce créneau n’est pas disponible." }, { status: 409 });
  }

  const { data, error } = await admin.rpc("reschedule_paid_appointment", {
    p_appointment_id: id,
    p_provider_id: auth.user.id,
    p_new_start: newStart.toISOString(),
    p_new_end: newEnd.toISOString(),
    p_now: new Date().toISOString(),
  });
  if (error || !data) {
    const message = error?.message.includes("holding limit")
      ? "La nouvelle date dépasse la limite de 80 jours."
      : error?.message.includes("payment state")
        ? "Les fonds sont déjà en cours de versement ou le paiement n’est plus déplaçable."
        : "Déplacement impossible.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ appointment: data });
}
