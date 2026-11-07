import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const headers = { "Cache-Control": "private, no-store" };
  if (!token) return NextResponse.json({ error: "Non autorisé." }, { status: 401, headers });
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }) },
    });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Non autorisé." }, { status: 401, headers });
    const { data, error } = await admin.from("appointments").select("id")
      .eq("provider_id", auth.user.id).eq("status", "confirmed")
      .gt("start_datetime", new Date().toISOString())
      .order("start_datetime", { ascending: true }).order("id", { ascending: true })
      .limit(1).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ appointment: data }, { headers });
  } catch {
    return NextResponse.json({ error: "Rendez-vous indisponible." }, { status: 503, headers });
  }
}
