import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function provider(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id;
}

export async function GET(request: Request) {
  const providerId = await provider(request);
  if (!providerId) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const { data, error } = await admin.rpc("professional_appointment_alerts", { p_provider_id: providerId });
  if (error) return NextResponse.json({ error: "Notifications indisponibles." }, { status: 500 });
  const events = (data || []).filter((row: { payload: { seen_at?: string } }) => !row.payload.seen_at)
    .map((row: { event_id: string; kind: string }) => ({ event_id: row.event_id, kind: row.kind }));
  return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const providerId = await provider(request);
  if (!providerId) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const events = body?.events;
  if (!Array.isArray(events) || events.length > 1000 || events.some(event =>
    !event || typeof event.event_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.event_id)
      || !["confirmed", "rescheduled", "cancelled"].includes(event.kind))) {
    return NextResponse.json({ error: "Événements invalides." }, { status: 400 });
  }
  const { error } = await admin.rpc("mark_professional_appointment_alerts_seen", {
    p_provider_id: providerId, p_events: events.map(event => ({ event_id: event.event_id, kind: event.kind })),
  });
  if (error) return NextResponse.json({ error: "Lecture non enregistrée." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
