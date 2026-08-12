import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBillingDocumentPdf, sha256 } from "@/lib/billingDocuments";

export async function ensureClientCreditNote(admin: SupabaseClient, refundId: string, refundedAt: string) {
  const { data: note, error } = await admin.rpc("create_client_credit_note", { p_refund_id: refundId, p_refunded_at: refundedAt });
  if (error || !note) throw new Error("Credit note reservation failed");
  if (note.file_path) return note;
  const issuer = note.issuer_snapshot;
  const customer = note.customer_snapshot;
  const service = note.service_snapshot;
  const pdf = await generateBillingDocumentPdf({
    kind: "credit_note", number: note.credit_note_number,
    originalInvoiceNumber: service.originalInvoiceNumber,
    issuedAt: note.issued_at, serviceDate: service.serviceDate,
    issuer, customer, service,
    totals: { excludingTax: note.total_excluding_tax, vatRate: Number(note.vat_rate), vatAmount: note.vat_amount, includingTax: note.total_including_tax, currency: note.currency, exemptionMention: note.vat_exemption_mention },
  });
  const month = note.issued_at.slice(0, 7);
  const filePath = `providers/${note.provider_id}/credit-notes/${month}/credit_note_${note.stripe_refund_id}.pdf`;
  const upload = await admin.storage.from("invoices").upload(filePath, pdf, { contentType: "application/pdf", upsert: true });
  if (upload.error) throw upload.error;
  const { data: completed, error: updateError } = await admin.from("client_credit_notes").update({ storage_bucket: "invoices", file_path: filePath, generated_at: new Date().toISOString(), content_hash: sha256(pdf) }).eq("id", note.id).is("file_path", null).select("*").maybeSingle();
  if (updateError) throw updateError;
  return completed || note;
}
