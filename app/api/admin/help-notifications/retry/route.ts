import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.DRIMLI_HELP_CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Six sequential Supabase calls (5s each) + Resend (10s) leave a 20s margin.
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }) },
    });
    const { processHelpNotification } = await import("@/lib/helpNotifications");
    const result = await processHelpNotification(admin);
    const { count, error } = await admin.from("help_notifications")
      .select("id", { count: "exact", head: true }).eq("state", "attention");
    if (error) throw new Error("Queue status unavailable");
    if (count) console.error("[HELP_NOTIFICATIONS_ATTENTION]", { count });
    return NextResponse.json({ ...result, attention: count ?? 0 }, { status: count || ("sent" in result && !result.sent) ? 503 : 200 });
  } catch {
    console.error("[HELP_NOTIFICATIONS_RETRY_REQUIRED]");
    return NextResponse.json({ error: "Notifications temporarily unavailable; queue retained." }, { status: 503 });
  }
}
