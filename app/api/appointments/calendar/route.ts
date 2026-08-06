import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { buildAppointmentPortalUrl } from "@/lib/video/appointmentPortal";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-12-15.clover",
});

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

function escapeIcsText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function formatIcsDate(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function unavailable(status = 404) {
  return NextResponse.json(
    { error: "Le calendrier n’est pas encore disponible." },
    { status }
  );
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");

  if (!sessionId) return unavailable(400);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const appointmentId = session.metadata?.appointment_id;

    if (session.payment_status !== "paid" || !appointmentId) {
      return unavailable(403);
    }

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select(
        "id, provider_id, product_id, status, start_datetime, end_datetime, join_token"
      )
      .eq("id", appointmentId)
      .maybeSingle();

    if (
      appointmentError ||
      !appointment ||
      appointment.status !== "confirmed" ||
      !appointment.start_datetime ||
      !appointment.end_datetime ||
      !appointment.join_token
    ) {
      return unavailable();
    }

    const [{ data: product }, { data: provider }] = await Promise.all([
      supabaseAdmin
        .from("products")
        .select("title")
        .eq("id", appointment.product_id)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("provider_id", appointment.provider_id)
        .maybeSingle(),
    ]);

    const serviceTitle = String(product?.title || "Rendez-vous").trim();
    const providerName = String(provider?.full_name || "votre professionnel").trim();
    const portalUrl = buildAppointmentPortalUrl(appointment.join_token);
    const description = [
      `${serviceTitle} avec ${providerName}.`,
      `Rejoindre la visioconférence : ${portalUrl}`,
    ].join("\n");

    const calendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Drimli//Rendez-vous//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${appointment.id}@drimli.app`,
      `DTSTAMP:${formatIcsDate(new Date().toISOString())}`,
      `DTSTART:${formatIcsDate(appointment.start_datetime)}`,
      `DTEND:${formatIcsDate(appointment.end_datetime)}`,
      `SUMMARY:${escapeIcsText(serviceTitle)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `URL:${portalUrl}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    return new NextResponse(calendar, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="rendez-vous-drimli.ics"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return unavailable();
  }
}
