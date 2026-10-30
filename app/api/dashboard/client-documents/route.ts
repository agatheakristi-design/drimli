import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addOneDayYMD, parisDateTimeToIso } from "@/app/components/calendar/utils";

export const runtime = "nodejs";
const PAGE_SIZE = 20;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return NextResponse.json({ error: "Session expirée." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "all";
  const search = (params.get("search") || "").trim();
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const invoiceOffset = Number(params.get("invoiceOffset") || 0);
  const noteOffset = Number(params.get("noteOffset") || 0);
  const validDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  if (!["all", "invoice", "credit_note"].includes(type) || search.length > 120 || !validDate(from) || !validDate(to) || (from && to && from > to) || ![invoiceOffset, noteOffset].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000)) {
    return NextResponse.json({ error: "Filtres invalides." }, { status: 400, headers });
  }
  // Quote filter punctuation; preserve LIKE escapes through PostgREST parsing.
  const pattern = JSON.stringify(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const end = to ? parisDateTimeToIso(addOneDayYMD(to), "00:00") : "";
  try {
    let invoices = admin.from("client_invoices").select("id, appointment_id, invoice_number, issued_at, customer_name, customer_email, customer_business_name, total_including_tax, currency, storage_bucket, file_path").eq("provider_id", auth.user.id);
    let notes = admin.from("client_credit_notes").select("id, invoice_id, refund_id, credit_note_number, issued_at, customer_snapshot, total_including_tax, currency, storage_bucket, file_path").eq("provider_id", auth.user.id);
    if (from) { const start = parisDateTimeToIso(from, "00:00"); invoices = invoices.gte("issued_at", start); notes = notes.gte("issued_at", start); }
    if (end) { invoices = invoices.lt("issued_at", end); notes = notes.lt("issued_at", end); }
    if (search) {
      invoices = invoices.or(`customer_name.ilike.${pattern},customer_email.ilike.${pattern},customer_business_name.ilike.${pattern},invoice_number.ilike.${pattern}`);
      notes = notes.or(`customer_snapshot->>name.ilike.${pattern},customer_snapshot->>email.ilike.${pattern},customer_snapshot->>businessName.ilike.${pattern},credit_note_number.ilike.${pattern}`);
    }
    const [invoiceResult, noteResult] = await Promise.all([
      type === "credit_note" ? { data: [], error: null } : invoices.order("issued_at", { ascending: false }).order("id", { ascending: false }).range(invoiceOffset, invoiceOffset + PAGE_SIZE),
      type === "invoice" ? { data: [], error: null } : notes.order("issued_at", { ascending: false }).order("id", { ascending: false }).range(noteOffset, noteOffset + PAGE_SIZE),
    ]);
    if (invoiceResult.error || noteResult.error) throw new Error("documents");
    const combined = [
      ...(invoiceResult.data || []).map(row => ({ ...row, type: "invoice" as const, number: row.invoice_number, client: row.customer_business_name || row.customer_name, refund_id: null as string | null })),
      ...(noteResult.data || []).map(row => ({ ...row, type: "credit_note" as const, number: row.credit_note_number, client: row.customer_snapshot.businessName || row.customer_snapshot.name || "—", appointment_id: null as string | null })),
    ].sort((a, b) => Date.parse(b.issued_at) - Date.parse(a.issued_at) || b.id.localeCompare(a.id) || a.type.localeCompare(b.type));
    const page = combined.slice(0, PAGE_SIZE);
    const appointmentIds = page.flatMap(row => row.appointment_id ? [row.appointment_id] : []);
    const refundIds = page.flatMap(row => row.refund_id ? [row.refund_id] : []);
    const payments = appointmentIds.length ? await admin.from("drimli_payments").select("id, appointment_id").eq("provider_id", auth.user.id).in("appointment_id", appointmentIds) : { data: [], error: null };
    if (payments.error) throw new Error("payments");
    const paymentRows = payments.data || [];
    const [paymentRefunds, noteRefunds] = await Promise.all([
      paymentRows.length ? admin.from("drimli_refunds").select("id, payment_id, amount, currency, status").in("payment_id", paymentRows.map(row => row.id)) : { data: [], error: null },
      // Only refund IDs from credit notes already scoped to this professional.
      refundIds.length ? admin.from("drimli_refunds").select("id, payment_id, amount, currency, status").in("id", refundIds) : { data: [], error: null },
    ]);
    if (paymentRefunds.error || noteRefunds.error) throw new Error("refunds");
    const refunds = [...(paymentRefunds.data || []), ...(noteRefunds.data || [])];
    return NextResponse.json({
      documents: page.map(row => {
        const payment = paymentRows.find(payment => payment.appointment_id === row.appointment_id);
        const related = new Map(refunds.filter(refund => row.type === "credit_note" ? refund.id === row.refund_id : refund.payment_id === payment?.id).map(refund => [refund.id, refund]));
        return { id: row.id, type: row.type, number: row.number, issuedAt: row.issued_at, client: row.client, amount: row.total_including_tax, currency: row.currency, downloadable: Boolean(row.storage_bucket && row.file_path), refunds: Array.from(related.values()).map(refund => ({ amount: refund.amount, currency: refund.currency, status: refund.status })) };
      }),
      next: combined.length > PAGE_SIZE ? { invoiceOffset: invoiceOffset + page.filter(row => row.type === "invoice").length, noteOffset: noteOffset + page.filter(row => row.type === "credit_note").length } : null,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Impossible de charger les documents." }, { status: 500, headers });
  }
}
