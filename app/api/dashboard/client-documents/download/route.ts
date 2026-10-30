import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return NextResponse.json({ error: "Session expirée." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || "";
  const type = params.get("type");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !["invoice", "credit_note"].includes(type || "")) return NextResponse.json({ error: "Document invalide." }, { status: 400, headers });
  const { data: document, error } = await admin.from(type === "invoice" ? "client_invoices" : "client_credit_notes")
    .select("storage_bucket, file_path").eq("provider_id", auth.user.id).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Téléchargement impossible." }, { status: 500, headers });
  if (!document?.storage_bucket || !document.file_path) return NextResponse.json({ error: "Document indisponible." }, { status: 404, headers });
  // The browser supplies neither the bucket nor the path: use only owned metadata.
  const { data: signed, error: signError } = await admin.storage.from(document.storage_bucket).createSignedUrl(document.file_path, 300);
  if (signError || !signed?.signedUrl) return NextResponse.json({ error: "Téléchargement impossible." }, { status: 500, headers });
  return NextResponse.json({ url: signed.signedUrl }, { headers });
}
