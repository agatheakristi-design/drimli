import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processHelpRequestNotification } from "@/lib/helpNotifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (Number(request.headers.get("content-length")) > 24_000) {
    return NextResponse.json({ error: "Message trop long." }, { status: 413 });
  }
  try {
    const body = await request.json().catch(() => null);
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!subject || subject.length > 120 || !message || message.length > 4000) {
      return NextResponse.json({ error: "Sujet ou message invalide." }, { status: 400 });
    }
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` },
        fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(5_000) }) },
    };
    // The insert keeps the authenticated user's RLS and owner_id default.
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options);
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    const { data, error } = await client.from("help_requests").insert({ subject, message })
      .select("id,subject,message,created_at").single();
    if (error || !data) return NextResponse.json({ error: "Envoi non confirmé." }, { status: 503 });
    after(async () => {
      try {
        const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5_000) }) },
        });
        const result = await processHelpRequestNotification(admin, data.id);
        if ("sent" in result && !result.sent) console.error("[HELP_NOTIFICATION_RETRY_REQUIRED]");
      } catch {
        console.error("[HELP_NOTIFICATION_RETRY_REQUIRED]");
      }
    });
    return NextResponse.json({ request: data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Envoi non confirmé." }, { status: 503 });
  }
}
