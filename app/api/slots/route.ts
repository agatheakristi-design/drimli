import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

const DAY_INDEX: Record<DayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aS = new Date(aStart).getTime();
  const aE = new Date(aEnd).getTime();
  const bS = new Date(bStart).getTime();
  const bE = new Date(bEnd).getTime();
  return aS < bE && bS < aE;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const providerId = searchParams.get("providerId") || "";
    const serviceId = searchParams.get("serviceId") || "";
    const dateStr = searchParams.get("date") || ""; // YYYY-MM-DD

    if (!providerId || !serviceId || !dateStr) {
      return NextResponse.json(
        { error: "Missing providerId, serviceId or date" },
        { status: 400 }
      );
    }

    if (!isUuid(providerId) || !isUuid(serviceId)) {
      return NextResponse.json({ error: "Invalid UUID" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: "Invalid date format (expected YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // ✅ Guard dates passées (Europe/Paris)
    const todayParis = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()); // YYYY-MM-DD

    if (dateStr < todayParis) {
      return NextResponse.json({ error: "Date passée interdite." }, { status: 400 });
    }

    // ✅ Supabase admin (bypass RLS)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 1) charger service (durée)
    const { data: service, error: serviceError } = await admin
      .from("products")
      .select("id, provider_id, duration_minutes, active")
      .eq("id", serviceId)
      .maybeSingle<{ id: string; provider_id: string; duration_minutes: number | null; active: boolean | null }>();

    if (serviceError) {
      return NextResponse.json({ error: serviceError.message }, { status: 500 });
    }

    if (!service || !service.duration_minutes || service.active === false) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    if (service.provider_id !== providerId) {
      return NextResponse.json({ error: "Service/provider mismatch" }, { status: 400 });
    }

    const durationMs = service.duration_minutes * 60 * 1000;

    // 2) charger disponibilités du pro
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("availability")
      .eq("provider_id", providerId)
      .maybeSingle<{ availability: any }>();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    if (!profile?.availability) {
      return NextResponse.json([], { status: 200 });
    }

    // Jour de semaine stable (midi UTC)
    const dayDate = new Date(dateStr + "T12:00:00Z");
    const dayKey = (Object.keys(DAY_INDEX) as DayKey[]).find(
      (k) => DAY_INDEX[k] === dayDate.getUTCDay()
    );

    if (!dayKey) return NextResponse.json([], { status: 200 });

    const dayAvailability = profile.availability[dayKey];
    if (!dayAvailability?.start || !dayAvailability?.end) {
      return NextResponse.json([], { status: 200 });
    }

    // 3) slots théoriques (ISO)
    const slots: { start: string; end: string }[] = [];
    let cursor = new Date(`${dateStr}T${dayAvailability.start}:00`);
    const endDay = new Date(`${dateStr}T${dayAvailability.end}:00`);

    while (cursor.getTime() + durationMs <= endDay.getTime()) {
      const start = new Date(cursor);
      const end = new Date(cursor.getTime() + durationMs);
      slots.push({ start: start.toISOString(), end: end.toISOString() });
      cursor = new Date(cursor.getTime() + durationMs);
    }

    // 4) retirer slots occupés (pending + confirmed)
    const startWindow = new Date(`${dateStr}T00:00:00`).toISOString();
    const endWindow = new Date(`${dateStr}T23:59:59`).toISOString();

    const { data: appts, error: apptErr } = await admin
      .from("appointments")
      .select("start_datetime, end_datetime, status")
      .eq("provider_id", providerId)
      .in("status", ["pending", "confirmed"])
      .gte("start_datetime", startWindow)
      .lte("start_datetime", endWindow);

    if (apptErr) {
      return NextResponse.json({ error: apptErr.message }, { status: 500 });
    }

    const busy = (appts ?? []).filter((a: any) => a.start_datetime && a.end_datetime);

    const free = slots.filter((s) => {
      return !busy.some((b: any) =>
        overlaps(s.start, s.end, b.start_datetime, b.end_datetime)
      );
    });

    return NextResponse.json(free, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}