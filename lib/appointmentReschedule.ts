import type { SupabaseClient } from "@supabase/supabase-js";

export class AppointmentRescheduleError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export type ReschedulableAppointment = {
  id: string;
  provider_id: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
};

export async function reschedulePaidAppointment(params: {
  admin: SupabaseClient;
  appointment: ReschedulableAppointment;
  newStartIso: string;
  now?: Date;
}) {
  const { admin, appointment, newStartIso, now = new Date() } = params;
  if (appointment.status !== "confirmed") {
    throw new AppointmentRescheduleError("Ce rendez-vous ne peut pas être déplacé.");
  }
  const duration = Date.parse(appointment.end_datetime) - Date.parse(appointment.start_datetime);
  const newStart = new Date(newStartIso);
  const newEnd = new Date(newStart.getTime() + duration);
  if (!Number.isFinite(newStart.getTime()) || duration <= 0 || newStart <= now) {
    throw new AppointmentRescheduleError("Choisissez une date future.", 400);
  }

  const [appointments, blocks] = await Promise.all([
    admin.from("appointments").select("id").eq("provider_id", appointment.provider_id)
      .in("status", ["pending", "confirmed"]).neq("id", appointment.id)
      .lt("start_datetime", newEnd.toISOString()).gt("end_datetime", newStart.toISOString()).limit(1),
    admin.from("provider_blocks").select("id").eq("provider_id", appointment.provider_id)
      .lt("start_datetime", newEnd.toISOString()).gt("end_datetime", newStart.toISOString()).limit(1),
  ]);
  if (appointments.error || blocks.error) {
    throw new AppointmentRescheduleError("Vérification du créneau impossible.", 500);
  }
  if ((appointments.data?.length ?? 0) || (blocks.data?.length ?? 0)) {
    throw new AppointmentRescheduleError("Ce créneau n’est pas disponible.");
  }

  const { data, error } = await admin.rpc("reschedule_paid_appointment_guarded", {
    p_appointment_id: appointment.id,
    p_provider_id: appointment.provider_id,
    p_expected_start: appointment.start_datetime,
    p_new_start: newStart.toISOString(),
    p_new_end: newEnd.toISOString(),
    p_now: now.toISOString(),
  });
  if (error || !data) {
    const message = error?.message.includes("holding limit")
      ? "La nouvelle date dépasse la limite de 80 jours."
      : error?.message.includes("payment state")
        ? "Les fonds sont déjà en cours de versement ou le paiement n’est plus déplaçable."
        : error?.message.includes("changed concurrently")
          ? "Ce rendez-vous vient déjà d’être déplacé. Actualisez la page."
        : error?.message.includes("no_overlap_same_provider")
          ? "Ce créneau n’est plus disponible."
          : "Déplacement impossible.";
    throw new AppointmentRescheduleError(message);
  }
  return data;
}
