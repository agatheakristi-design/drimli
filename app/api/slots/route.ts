import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type AvailabilityRange = { start: string; end: string };
type Availability = Partial<Record<DayKey, AvailabilityRange | null>> & {
  week?: Partial<Record<DayKey, AvailabilityRange[]>>;
};
type IntervalRow = { start_datetime: string | null; end_datetime: string | null };

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

function addOneDay(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function parisOffsetMs(instantMs: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const parisAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return parisAsUtc - instantMs;
}

export function parisDateTimeToIso(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Invalid Europe/Paris date or time");
  }

  const wallTimeAsUtc = Date.parse(`${date}T${time}:00Z`);
  let instant = wallTimeAsUtc - parisOffsetMs(wallTimeAsUtc);
  instant = wallTimeAsUtc - parisOffsetMs(instant);

  const result = new Date(instant);
  const resultParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(result);
  const resultValues = Object.fromEntries(
    resultParts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const formattedDate = `${resultValues.year}-${resultValues.month}-${resultValues.day}`;
  const formattedTime = `${resultValues.hour}:${resultValues.minute}`;

  if (formattedDate !== date || formattedTime !== time) {
    throw new Error("Invalid Europe/Paris wall-clock time");
  }

  return result.toISOString();
}

export function generateSlots(params: {
  date: string;
  openingTime: string;
  closingTime: string;
  durationMinutes: number;
}) {
  const openingMs = Date.parse(
    parisDateTimeToIso(params.date, params.openingTime)
  );
  const closingMs = Date.parse(
    parisDateTimeToIso(params.date, params.closingTime)
  );
  const durationMs = params.durationMinutes * 60 * 1000;
  const slots: { start: string; end: string }[] = [];

  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    closingMs <= openingMs
  ) {
    return slots;
  }

  for (let cursor = openingMs; cursor + durationMs <= closingMs; cursor += durationMs) {
    slots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(cursor + durationMs).toISOString(),
    });
  }

  return slots;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const providerId = searchParams.get("providerId") || "";
    const serviceId = searchParams.get("serviceId") || "";
    const dateStr = searchParams.get("date") || ""; // YYYY-MM-DD

    if (!providerId || !serviceId || !dateStr) {
      return NextResponse.json({ error: "Missing providerId, serviceId or date" }, { status: 400 });
    }

    if (!isUuid(providerId) || !isUuid(serviceId)) {
      return NextResponse.json({ error: "Invalid UUID" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json({ error: "Invalid date format (expected YYYY-MM-DD)" }, { status: 400 });
    }

    // Guard dates passées (Europe/Paris)
    const todayParis = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (dateStr < todayParis) {
      return NextResponse.json({ error: "Date passée interdite." }, { status: 400 });
    }

    // Supabase admin (bypass RLS)
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

    if (serviceError) return NextResponse.json({ error: serviceError.message }, { status: 500 });

    if (!service || !service.duration_minutes || service.active === false) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    if (service.provider_id !== providerId) {
      return NextResponse.json({ error: "Service/provider mismatch" }, { status: 400 });
    }

    const durationMinutes = service.duration_minutes;

    // 2) charger disponibilités du pro
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("availability")
      .eq("provider_id", providerId)
      .maybeSingle<{
        availability: Availability | null;
      }>();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!profile?.availability) return NextResponse.json([], { status: 200 });

    // Jour de semaine stable (midi UTC)
    const dayDate = new Date(dateStr + "T12:00:00Z");
    const dayKey = (Object.keys(DAY_INDEX) as DayKey[]).find((k) => DAY_INDEX[k] === dayDate.getUTCDay());
    if (!dayKey) return NextResponse.json([], { status: 200 });

    const weeklyRanges = profile.availability.week?.[dayKey];
    const legacyRange = profile.availability[dayKey];
    const dayRanges = Array.isArray(weeklyRanges)
      ? weeklyRanges
      : legacyRange?.start && legacyRange.end
        ? [legacyRange]
        : [];

    if (dayRanges.length === 0) return NextResponse.json([], { status: 200 });

    // 3) slots théoriques
    const slots = dayRanges.flatMap((range) =>
      generateSlots({
        date: dateStr,
        openingTime: range.start,
        closingTime: range.end,
        durationMinutes,
      })
    );

    // Fenêtre journée
    const startWindow = parisDateTimeToIso(dateStr, "00:00");
    const endWindow = parisDateTimeToIso(addOneDay(dateStr), "00:00");

    // 4) RDV déjà pris (pending + confirmed)
    const { data: appts, error: apptErr } = await admin
      .from("appointments")
      .select("start_datetime, end_datetime, status")
      .eq("provider_id", providerId)
      .in("status", ["pending", "confirmed"])
      .lt("start_datetime", endWindow)
      .gt("end_datetime", startWindow);

    if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 });

    const busy = ((appts ?? []) as IntervalRow[]).filter(
      (appointment) =>
        appointment.start_datetime && appointment.end_datetime
    );

    // 5) Blocages (pause déjeuner, indispo, etc.)
    const { data: blocks, error: blocksErr } = await admin
      .from("provider_blocks")
      .select("start_datetime, end_datetime")
      .eq("provider_id", providerId)
      .lt("start_datetime", endWindow)
      .gt("end_datetime", startWindow);

    if (blocksErr) return NextResponse.json({ error: blocksErr.message }, { status: 500 });

    const blocked = ((blocks ?? []) as IntervalRow[]).filter(
      (block) => block.start_datetime && block.end_datetime
    );

    // 6) Ne garder que les slots libres
    const free = slots.filter((s) => {
      const isBusy = busy.some((appointment) =>
        overlaps(
          s.start,
          s.end,
          appointment.start_datetime!,
          appointment.end_datetime!
        )
      );
      if (isBusy) return false;
      const isBlocked = blocked.some((block) =>
        overlaps(
          s.start,
          s.end,
          block.start_datetime!,
          block.end_datetime!
        )
      );
      return !isBlocked;
    });

    return NextResponse.json(free, { status: 200 });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal error",
      },
      { status: 500 }
    );
  }
}
