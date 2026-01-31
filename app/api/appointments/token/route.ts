import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function randomToken(len = 24) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const appointmentId = body?.appointmentId as string | undefined;

    if (!appointmentId) {
      return NextResponse.json({ error: "Missing appointmentId" }, { status: 400 });
    }

    const admin = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // 1) Read existing token
    const { data: appt, error: readErr } = await admin
      .from("appointments")
      .select("id, join_token")
      .eq("id", appointmentId)
      .maybeSingle<{ id: string; join_token: string | null }>();

    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });
    if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

    if (appt.join_token) {
      return NextResponse.json({ join_token: appt.join_token }, { status: 200 });
    }

    // 2) Create token (retry a few times for uniqueness)
    for (let i = 0; i < 5; i++) {
      const token = randomToken(32);
      const { data: updated, error: upErr } = await admin
        .from("appointments")
        .update({ join_token: token })
        .eq("id", appointmentId)
        .is("join_token", null)
        .select("join_token")
        .maybeSingle<{ join_token: string | null }>();

      if (!upErr && updated?.join_token) {
        return NextResponse.json({ join_token: updated.join_token }, { status: 200 });
      }
    }

    return NextResponse.json({ error: "Could not allocate join_token" }, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
