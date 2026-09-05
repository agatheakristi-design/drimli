import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientAppointmentPermissions } from "@/lib/clientAppointmentPolicy";
import { AppointmentRescheduleError, reschedulePaidAppointment } from "@/lib/appointmentReschedule";
import { sendAppointmentRescheduledEmail } from "@/lib/email";
import { buildAppointmentPortalUrl } from "@/lib/video/appointmentPortal";
import type { CancellationPolicy } from "@/lib/payoutPolicy";

export const runtime = "nodejs";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

function parisDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!token || token.length > 200) return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  const body = await request.json().catch(() => null) as { start?: unknown } | null;
  if (typeof body?.start !== "string" || !Number.isFinite(Date.parse(body.start))) {
    return NextResponse.json({ error: "Nouvelle date invalide." }, { status: 400 });
  }

  const { data: appointment } = await admin.from("appointments")
    .select("id, provider_id, product_id, client_name, client_email, start_datetime, end_datetime, status")
    .eq("join_token", token).maybeSingle();
  if (!appointment) return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  const { data: snapshot } = await admin.from("billing_checkout_snapshots")
    .select("cancellation_policy").eq("appointment_id", appointment.id).maybeSingle();
  if (!snapshot?.cancellation_policy) return NextResponse.json({ error: "Conditions introuvables." }, { status: 409 });
  const permissions = clientAppointmentPermissions(
    snapshot.cancellation_policy as CancellationPolicy,
    appointment.start_datetime,
    new Date()
  );
  if (!permissions.canReschedule) {
    return NextResponse.json({ error: "Le délai de déplacement est dépassé." }, { status: 409 });
  }

  const duration = Date.parse(appointment.end_datetime) - Date.parse(appointment.start_datetime);
  const requestedStart = new Date(body.start);
  const requestedEnd = new Date(requestedStart.getTime() + duration);
  if (!clientAppointmentPermissions(
    snapshot.cancellation_policy as CancellationPolicy,
    requestedStart,
    new Date()
  ).canReschedule) {
    return NextResponse.json(
      { error: "Le nouveau créneau est trop proche pour respecter vos conditions de modification." },
      { status: 409 }
    );
  }
  const slotsUrl = new URL("/api/slots", request.url);
  slotsUrl.search = new URLSearchParams({
    providerId: appointment.provider_id,
    serviceId: appointment.product_id,
    date: parisDate(requestedStart.toISOString()),
  }).toString();
  const slotsResponse = await fetch(slotsUrl, { cache: "no-store" });
  const slots = await slotsResponse.json().catch(() => []) as Array<{ start?: string; end?: string }>;
  const offered = slotsResponse.ok && slots.some(
    (slot) => slot.start === requestedStart.toISOString() && slot.end === requestedEnd.toISOString()
  );
  if (!offered) return NextResponse.json({ error: "Ce créneau n’est plus disponible." }, { status: 409 });

  try {
    const moved = await reschedulePaidAppointment({
      admin,
      appointment,
      newStartIso: requestedStart.toISOString(),
    });
    const [{ data: profile }, { data: product }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("provider_id", appointment.provider_id).maybeSingle(),
      admin.from("products").select("title").eq("id", appointment.product_id).maybeSingle(),
    ]);
    try {
      await sendAppointmentRescheduledEmail({
        appointmentId: appointment.id,
        to: appointment.client_email,
        patientName: appointment.client_name,
        providerName: profile?.full_name?.trim() || "Votre professionnel",
        serviceTitle: product?.title?.trim() || "Rendez-vous",
        startDateTimeIso: moved.start_datetime,
        endDateTimeIso: moved.end_datetime,
        appointmentJoinUrl: buildAppointmentPortalUrl(token),
      });
    } catch (emailError) {
      console.error("[CLIENT_RESCHEDULE_EMAIL_ERROR]", {
        appointmentId: appointment.id,
        type: emailError instanceof Error ? emailError.name : "UnknownError",
        message: "Reschedule confirmation email failed",
      });
    }
    return NextResponse.json({
      appointment: { start_datetime: moved.start_datetime, end_datetime: moved.end_datetime },
      permissions: clientAppointmentPermissions(
        snapshot.cancellation_policy as CancellationPolicy,
        moved.start_datetime,
        new Date()
      ),
    });
  } catch (error) {
    const failure = error instanceof AppointmentRescheduleError
      ? error
      : new AppointmentRescheduleError("Déplacement impossible.", 500);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
