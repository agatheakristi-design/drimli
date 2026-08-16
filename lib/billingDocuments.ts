import { createHash } from "node:crypto";

export type BillingDocument = {
  kind: "invoice" | "credit_note";
  number: string;
  originalInvoiceNumber?: string | null;
  issuedAt: string;
  serviceDate: string;
  issuer: { name: string; businessName?: string | null; address: string; postalCode?: string | null; city: string; country: string; siret: string; vatNumber?: string | null };
  customer: { name: string; email?: string | null; address?: string | null; postalCode?: string | null; city?: string | null; country?: string | null };
  service: { title: string; description?: string | null; durationMinutes?: number | null };
  totals: { excludingTax: number; vatRate: number; vatAmount: number; includingTax: number; currency: string; exemptionMention?: string | null };
};

function escapeHtml(value: string | null | undefined) {
  return (value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export async function generateBillingDocumentPdf(document: BillingDocument) {
  const [{ default: chromium }, { chromium: playwrightChromium }] = await Promise.all([
    import("@sparticuz/chromium"), import("playwright-core"),
  ]);
  const money = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: document.totals.currency }).format(cents / 100);
  const date = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(new Date(iso));
  const title = document.kind === "invoice" ? "Facture client" : "Avoir client";
  const customerAddress = [document.customer.address, document.customer.postalCode, document.customer.city, document.customer.country].filter(Boolean).join(", ");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;color:#111;margin:40px}.row{display:flex;justify-content:space-between;gap:32px}.brand{font-weight:700;font-size:18px}.muted{color:#555;font-size:12px}.h1{font-size:20px;font-weight:700;margin:18px 0 4px}.box{border:1px solid #ddd;border-radius:10px;padding:14px;margin-top:14px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:10px;border-bottom:1px solid #eee;font-size:13px}th{background:#fafafa}.right{text-align:right}.total{font-weight:700;font-size:14px}.footer{margin-top:18px;font-size:11px;color:#666}</style></head><body>
<div class="row"><div><div class="brand">DRIMLI</div><div class="muted">Document généré via la plateforme Drimli</div></div><div class="muted" style="text-align:right"><div><b>${title}</b> ${escapeHtml(document.number)}</div><div>Date d’émission : ${date(document.issuedAt)}</div><div>Date de prestation : ${date(document.serviceDate)}</div>${document.originalInvoiceNumber ? `<div>Facture d’origine : ${escapeHtml(document.originalInvoiceNumber)}</div>` : ""}</div></div>
<div class="h1">${title}</div><div class="box"><div class="row"><div><div class="muted">Émetteur (Professionnel)</div><div><b>${escapeHtml(document.issuer.businessName || document.issuer.name)}</b></div>${document.issuer.businessName ? `<div>${escapeHtml(document.issuer.name)}</div>` : ""}<div class="muted">${escapeHtml(document.issuer.address)}, ${escapeHtml([document.issuer.postalCode, document.issuer.city].filter(Boolean).join(" "))}, ${escapeHtml(document.issuer.country)}</div><div class="muted">SIRET : ${escapeHtml(document.issuer.siret)}</div>${document.issuer.vatNumber ? `<div class="muted">TVA : ${escapeHtml(document.issuer.vatNumber)}</div>` : ""}</div><div><div class="muted">Client</div><div><b>${escapeHtml(document.customer.name)}</b></div>${document.customer.email ? `<div class="muted">${escapeHtml(document.customer.email)}</div>` : ""}${customerAddress ? `<div class="muted">${escapeHtml(customerAddress)}</div>` : ""}</div></div>
<table><thead><tr><th>Prestation</th><th class="right">Montant TTC</th></tr></thead><tbody><tr><td>${escapeHtml(document.service.title)}${document.service.description ? `<div class="muted">${escapeHtml(document.service.description)}</div>` : ""}${document.service.durationMinutes ? `<div class="muted">Durée : ${document.service.durationMinutes} min</div>` : ""}</td><td class="right">${money(document.totals.includingTax)}</td></tr></tbody></table>
<table><tbody><tr><td class="right muted">Total HT</td><td class="right">${money(document.totals.excludingTax)}</td></tr><tr><td class="right muted">TVA (${new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 }).format(document.totals.vatRate)})</td><td class="right">${money(document.totals.vatAmount)}</td></tr><tr><td class="right total">Total TTC</td><td class="right total">${money(document.totals.includingTax)}</td></tr></tbody></table>${document.totals.exemptionMention ? `<p class="muted">${escapeHtml(document.totals.exemptionMention)}</p>` : ""}</div>
<div class="footer">Ce document est émis par le professionnel. Drimli fournit le service technique de génération et d’archivage.</div></body></html>`;
  const browser = await playwrightChromium.launch({ args: chromium.args, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(), headless: true });
  try { const page = await browser.newPage(); await page.setContent(html, { waitUntil: "load" }); return Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" } })); }
  finally { await browser.close(); }
}

export function sha256(value: Buffer | string) { return createHash("sha256").update(value).digest("hex"); }
