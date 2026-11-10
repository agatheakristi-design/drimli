import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resumeAppointmentMove } from "@/lib/googleCalendarReschedule";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Non autorisé." }, { status: 401, headers });
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }) },
    });
    const { data: auth, error } = await admin.auth.getUser(token);
    if (error || !auth.user) return NextResponse.json({ error: "Non autorisé." }, { status: 401, headers });
    const { id } = await context.params;
    const appointment = await resumeAppointmentMove(admin, id, auth.user.id);
    return NextResponse.json({ synchronized: true, appointment: { id: appointment.id, start_datetime: appointment.start_datetime, end_datetime: appointment.end_datetime } }, { headers });
  } catch {
    return NextResponse.json({ error: "Synchronisation non confirmée.", code: "CALENDAR_SYNC_PENDING" }, { status: 503, headers });
  }
}
