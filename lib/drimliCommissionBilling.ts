import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DRIMLI_BILLING_IDENTITY = Object.freeze({
  tradeName: "DRIMLI",
  legalName: "LEWIS PARKER",
  legalForm: "SAS",
  capital: "1 000 €",
  address: "au Château",
  postalCode: "32170",
  city: "Monpardiac",
  country: "France",
  siren: "892 166 588",
  rcs: "892 166 588 RCS Auch",
  vatNumber: "FR19 892166588",
  vatRate: 0.2,
});

export function drimliVatBreakdown(totalIncludingTax: number) {
  if (!Number.isInteger(totalIncludingTax) || totalIncludingTax <= 0) {
    throw new Error("A positive amount in cents is required");
  }
  const totalExcludingTax = Math.round((totalIncludingTax * 5) / 6);
  return {
    totalExcludingTax,
    vatAmount: totalIncludingTax - totalExcludingTax,
    totalIncludingTax,
  };
}

type InvoiceRow = {
  id: string;
  provider_id: string;
  invoice_number: string;
  period_month: string;
  issued_at: string;
  issuer_snapshot: Record<string, string>;
  customer_snapshot: Record<string, string | null>;
  description: string;
  total_excluding_tax: number;
  vat_amount: number;
  total_including_tax: number;
  currency: string;
  file_path: string | null;
};

type CreditNoteRow = {
  id: string;
  provider_id: string;
  invoice_id: string;
  credit_note_number: string;
  issued_at: string;
  reason: string;
  total_excluding_tax: number;
  vat_amount: number;
  total_including_tax: number;
  currency: string;
  file_path: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function frenchDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(
    new Date(iso)
  );
}

function issuerBlock(issuer: Record<string, string>) {
  return `<strong>${escapeHtml(issuer.tradeName)}</strong><br>${escapeHtml(issuer.legalName)} – ${escapeHtml(issuer.legalForm)}<br>${escapeHtml(issuer.address)}<br>${escapeHtml(issuer.postalCode)} ${escapeHtml(issuer.city)}, ${escapeHtml(issuer.country)}<br>SIREN : ${escapeHtml(issuer.siren)}<br>RCS : ${escapeHtml(issuer.rcs)}<br>TVA : ${escapeHtml(issuer.vatNumber)}`;
}

function customerBlock(customer: Record<string, string | null>) {
  const name = customer.businessName || customer.fullName || "Professionnel";
  const address = [customer.address, customer.postalCode, customer.city, customer.country]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" ");
  return `<strong>${escapeHtml(name)}</strong>${customer.businessName && customer.fullName ? `<br>${escapeHtml(customer.fullName)}` : ""}${address ? `<br>${address}` : ""}${customer.siret ? `<br>SIRET : ${escapeHtml(customer.siret)}` : ""}${customer.vatNumber ? `<br>TVA : ${escapeHtml(customer.vatNumber)}` : ""}`;
}

async function renderPdf(html: string) {
  const [{ default: chromium }, { chromium: playwrightChromium }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("playwright-core"),
  ]);
  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (await chromium.executablePath()),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
      })
    );
  } finally {
    await browser.close();
  }
}

function documentHtml(params: {
  title: string;
  number: string;
  issuedAt: string;
  issuer: Record<string, string>;
  customer: Record<string, string | null>;
  description: string;
  reference?: string;
  totalExcludingTax: number;
  vatAmount: number;
  totalIncludingTax: number;
  currency: string;
  paid: boolean;
}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;color:#1d1d1f;margin:40px;font-size:13px}.row{display:flex;justify-content:space-between;gap:40px}.brand{font-size:19px;font-weight:700}.muted{color:#666;font-size:12px}.title{font-size:21px;font-weight:700;margin:28px 0 6px}.box{border-top:1px solid #ddd;padding-top:16px;margin-top:18px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px 0;border-bottom:1px solid #e8e8e8;text-align:left}.right{text-align:right}.total{font-weight:700}.paid{display:inline-block;margin-top:18px;padding:5px 10px;border:1px solid #aaa;border-radius:999px;font-size:12px}.footer{margin-top:30px;color:#666;font-size:11px}
</style></head><body><div class="row"><div><div class="brand">DRIMLI</div><div class="muted">${issuerBlock(params.issuer)}</div></div><div class="muted" style="text-align:right"><strong>${escapeHtml(params.title)} ${escapeHtml(params.number)}</strong><br>Date : ${frenchDate(params.issuedAt)}${params.reference ? `<br>Facture d’origine : ${escapeHtml(params.reference)}` : ""}</div></div><div class="title">${escapeHtml(params.title)}</div><div class="box row"><div><div class="muted">Émetteur</div>${issuerBlock(params.issuer)}</div><div><div class="muted">Professionnel facturé</div>${customerBlock(params.customer)}</div></div><table><thead><tr><th>Libellé</th><th class="right">Montant TTC</th></tr></thead><tbody><tr><td>${escapeHtml(params.description)}</td><td class="right">${money(params.totalIncludingTax, params.currency)}</td></tr></tbody></table><table><tbody><tr><td class="right muted">Total HT</td><td class="right">${money(params.totalExcludingTax, params.currency)}</td></tr><tr><td class="right muted">TVA 20 %</td><td class="right">${money(params.vatAmount, params.currency)}</td></tr><tr><td class="right total">Total TTC</td><td class="right total">${money(params.totalIncludingTax, params.currency)}</td></tr></tbody></table>${params.paid ? '<div class="paid">Acquittée</div>' : ""}<div class="footer">Document émis par LEWIS PARKER – DRIMLI.</div></body></html>`;
}

async function storeDocument(
  admin: SupabaseClient,
  table: "drimli_commission_invoices" | "drimli_commission_credit_notes",
  id: string,
  filePath: string,
  pdf: Buffer
) {
  const upload = await admin.storage.from("invoices").upload(filePath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error && !upload.error.message.toLowerCase().includes("already exists")) {
    throw upload.error;
  }
  const { error } = await admin
    .from(table)
    .update({
      storage_bucket: "invoices",
      file_path: filePath,
      generated_at: new Date().toISOString(),
      content_hash: createHash("sha256").update(pdf).digest("hex"),
    })
    .eq("id", id)
    .is("file_path", null);
  if (error) throw error;
}

export async function ensureDrimliInvoicePdf(admin: SupabaseClient, invoice: InvoiceRow) {
  if (invoice.file_path) return invoice;
  const pdf = await renderPdf(
    documentHtml({
      title: "Facture",
      number: invoice.invoice_number,
      issuedAt: invoice.issued_at,
      issuer: invoice.issuer_snapshot,
      customer: invoice.customer_snapshot,
      description: invoice.description,
      totalExcludingTax: invoice.total_excluding_tax,
      vatAmount: invoice.vat_amount,
      totalIncludingTax: invoice.total_including_tax,
      currency: invoice.currency,
      paid: true,
    })
  );
  const month = invoice.period_month.slice(0, 7);
  const path = `providers/${invoice.provider_id}/drimli-invoices/${month}/${invoice.invoice_number}.pdf`;
  await storeDocument(admin, "drimli_commission_invoices", invoice.id, path, pdf);
  return { ...invoice, storage_bucket: "invoices", file_path: path };
}

export async function ensureDrimliCreditNotePdf(
  admin: SupabaseClient,
  note: CreditNoteRow
) {
  if (note.file_path) return note;
  const { data: invoice, error } = await admin
    .from("drimli_commission_invoices")
    .select("invoice_number, issuer_snapshot, customer_snapshot")
    .eq("id", note.invoice_id)
    .single();
  if (error || !invoice) throw new Error("Original DRIMLI invoice not found");
  const pdf = await renderPdf(
    documentHtml({
      title: "Avoir",
      number: note.credit_note_number,
      issuedAt: note.issued_at,
      issuer: invoice.issuer_snapshot,
      customer: invoice.customer_snapshot,
      description: note.reason,
      reference: invoice.invoice_number,
      totalExcludingTax: note.total_excluding_tax,
      vatAmount: note.vat_amount,
      totalIncludingTax: note.total_including_tax,
      currency: note.currency,
      paid: false,
    })
  );
  const month = note.issued_at.slice(0, 7);
  const path = `providers/${note.provider_id}/drimli-credit-notes/${month}/${note.credit_note_number}.pdf`;
  await storeDocument(admin, "drimli_commission_credit_notes", note.id, path, pdf);
  return { ...note, storage_bucket: "invoices", file_path: path };
}
