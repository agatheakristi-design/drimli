import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function signedUrl(bucket: string | null, path: string | null) {
  if (!bucket || !path) return null;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: invoices, error } = await admin
    .from("drimli_commission_invoices")
    .select("id, invoice_number, period_month, total_including_tax, currency, storage_bucket, file_path")
    .eq("provider_id", auth.user.id)
    .order("period_month", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (invoices || []).map((invoice) => invoice.id);
  const { data: notes, error: notesError } = ids.length
    ? await admin
        .from("drimli_commission_credit_notes")
        .select("id, invoice_id, credit_note_number, total_including_tax, currency, storage_bucket, file_path")
        .eq("provider_id", auth.user.id)
        .in("invoice_id", ids)
        .order("issued_at", { ascending: true })
    : { data: [], error: null };
  if (notesError) return NextResponse.json({ error: notesError.message }, { status: 500 });

  const notesByInvoice = new Map<string, typeof notes>();
  for (const note of notes || []) {
    notesByInvoice.set(note.invoice_id, [...(notesByInvoice.get(note.invoice_id) || []), note]);
  }
  const documents = await Promise.all(
    (invoices || []).map(async (invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      periodMonth: invoice.period_month,
      totalIncludingTax: invoice.total_including_tax,
      currency: invoice.currency,
      downloadUrl: await signedUrl(invoice.storage_bucket, invoice.file_path),
      creditNotes: await Promise.all(
        (notesByInvoice.get(invoice.id) || []).map(async (note) => ({
          id: note.id,
          number: note.credit_note_number,
          totalIncludingTax: note.total_including_tax,
          currency: note.currency,
          downloadUrl: await signedUrl(note.storage_bucket, note.file_path),
        }))
      ),
    }))
  );
  return NextResponse.json({ documents });
}
