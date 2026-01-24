import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type Ctx = { params: Promise<{ id: string }> | { id: string } };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const params = await Promise.resolve(ctx.params);
    const id = params?.id;

    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid appointment id (UUID expected)." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing server env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data, error } = await admin
      .from("appointments")
      .select("id, start_datetime, end_datetime, video_provider, video_join_url, video_room_id")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

    return NextResponse.json(
      {
        id: data.id,
        startsAt: data.start_datetime,
        endsAt: data.end_datetime,
        videoProvider: data.video_provider ?? "none",
        videoJoinUrl: data.video_join_url ?? null,
        videoRoomId: data.video_room_id ?? null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
