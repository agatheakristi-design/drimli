import { NextResponse } from "next/server";
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

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  // Cherche la facture patient liée à cette session Stripe
  const { data: row, error } = await supabaseAdmin
    .from("patient_invoices")
    .select("bucket, file_path")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (error || !row) {
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
