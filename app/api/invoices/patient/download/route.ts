import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");
  const token = searchParams.get("token");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const { data: currentInvoice } = await supabaseAdmin
    .from("client_invoices")
    .select("storage_bucket, file_path, client_download_token_hash")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  let row = currentInvoice
    ? { bucket: currentInvoice.storage_bucket, file_path: currentInvoice.file_path }
    : null;

  if (currentInvoice?.client_download_token_hash) {
    if (!token) return NextResponse.json({ error: "Invoice token required" }, { status: 403 });
    const actual = Buffer.from(createHash("sha256").update(token).digest("hex"));
    const expected = Buffer.from(currentInvoice.client_download_token_hash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return NextResponse.json({ error: "Invalid invoice token" }, { status: 403 });
    }
  }

  if (!row && !currentInvoice) {
    const legacy = await supabaseAdmin
      .from("patient_invoices")
      .select("bucket, file_path")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    row = legacy.data;
  }

  if (!row?.bucket || !row.file_path) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Crée un lien signé (valide 10 min)
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(row.bucket)
    .createSignedUrl(row.file_path, 600);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "Unable to create signed url" }, { status: 500 });
  }

  // Redirige vers le PDF
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
