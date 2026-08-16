import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function signed(bucket?: string | null, path?: string | null) {
  if (!bucket || !path) return null;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: appointmentId } = await context.params;
  const { data: appointment } = await admin.from("appointments").select("id, provider_id").eq("id", appointmentId).maybeSingle();
  if (!appointment || appointment.provider_id !== auth.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: payment } = await admin.from("drimli_payments").select("id, amount_paid, application_fee_amount, refunded_amount, refunded_application_fee_amount, currency, status, paid_at").eq("appointment_id", appointmentId).maybeSingle();
  if (!payment) return NextResponse.json({ payment: null, invoice: null, refunds: [] });
  const [{ data: invoice }, { data: refunds }, { data: snapshot }] = await Promise.all([
    admin.from("client_invoices").select("id, invoice_number, total_including_tax, currency, storage_bucket, file_path").eq("appointment_id", appointmentId).maybeSingle(),
    admin.from("drimli_refunds").select("id, amount, currency, status, stripe_refund_id, created_at").eq("payment_id", payment.id).order("created_at", { ascending: false }),
    admin.from("billing_checkout_snapshots").select("cancellation_policy, cancellation_refund_deadline_hours").eq("appointment_id", appointmentId).maybeSingle(),
  ]);
  const refundIds = (refunds || []).map((refund) => refund.id);
  const { data: creditNotes } = refundIds.length ? await admin.from("client_credit_notes").select("id, refund_id, credit_note_number, total_including_tax, currency, storage_bucket, file_path").in("refund_id", refundIds) : { data: [] };
  return NextResponse.json({
    payment: { ...payment, professional_amount: payment.amount_paid - payment.application_fee_amount - payment.refunded_amount + payment.refunded_application_fee_amount },
    invoice: invoice ? { ...invoice, download_url: await signed(invoice.storage_bucket, invoice.file_path) } : null,
    cancellation_policy: snapshot?.cancellation_policy ?? null,
    cancellation_refund_deadline_hours: snapshot?.cancellation_refund_deadline_hours ?? null,
    refunds: await Promise.all((refunds || []).map(async (refund) => {
      const note = (creditNotes || []).find((item) => item.refund_id === refund.id);
      return { ...refund, credit_note: note ? { ...note, download_url: await signed(note.storage_bucket, note.file_path) } : null };
    })),
  });
}
