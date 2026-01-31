import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import archiver from "archiver";
import { sendAccountantMonthlyZipEmail } from "@/lib/email";

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

function prevMonthKey(now = new Date()): string {
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  firstOfThisMonth.setUTCMonth(firstOfThisMonth.getUTCMonth() - 1);
  return `${firstOfThisMonth.getUTCFullYear()}-${String(firstOfThisMonth.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function generateStatementPdf(monthKey: string, providerName: string, invoiceCount: number) {
  const { chromium } = await import("playwright");
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
body{font-family:Arial,sans-serif;margin:40px;color:#111}
.brand{font-weight:800;font-size:20px}
.muted{color:#555;font-size:12px}
.box{border:1px solid #ddd;border-radius:12px;padding:16px;margin-top:14px}
td{padding:8px 0;font-size:13px}
</style></head>
<body>
<div class="brand">DRIMLI</div>
<div class="muted">Monthly Statement — not an invoice</div>
<h2>DRIMLI Monthly Statement</h2>
<div class="muted">Professionnel: <b>${escapeHtml(providerName)}</b></div>
<div class="box">
  <table style="width:100%">
    <tr><td>Période</td><td style="text-align:right"><b>${monthKey}</b></td></tr>
    <tr><td>Factures patients incluses</td><td style="text-align:right"><b>${invoiceCount}</b></td></tr>
  </table>
</div>
<p class="muted">Ce document est un relevé de synthèse destiné à la comptabilité. Les factures patients sont jointes dans le ZIP.</p>
</body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await browser.close();
  return Buffer.from(pdf);
}

function escapeHtml(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function makeZip(entries: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const archive = archiver("zip", { zlib: { level: 9 } });

  return await new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (d: Buffer) => chunks.push(d));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    for (const e of entries) archive.append(e.data, { name: e.name });
    archive.finalize().catch(reject);
  });
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const expected = `Bearer ${requireEnv("CRON_SECRET")}`;
    if (auth !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const monthKey = prevMonthKey();
    console.log("🧾 Monthly ZIP generation started for:", monthKey);

    // Providers ayant un comptable
    const { data: providers, error: provErr } = await supabaseAdmin
      .from("profiles")
      .select("provider_id, full_name, accountant_email")
      .not("accountant_email", "is", null);

    if (provErr) return NextResponse.json({ error: provErr.message }, { status: 500 });

    for (const p of providers || []) {
      const providerId = p.provider_id;
      const providerName = (p.full_name || "Professionnel").toString();
      const accountantEmail = (p.accountant_email || "").toString().trim();
      if (!providerId || !accountantEmail) continue;

      // skip si déjà généré
      const { data: already } = await supabaseAdmin
        .from("monthly_statements")
        .select("id")
        .eq("provider_id", providerId)
        .eq("statement_month", monthKey)
        .maybeSingle();

      if (already?.id) {
        console.log("↩️ déjà généré, skip", providerId, monthKey);
        continue;
      }

      // Récupérer les factures patients du mois (déjà archivées)
      const { data: invRows, error: invErr } = await supabaseAdmin
        .from("patient_invoices")
        .select("bucket, file_path")
        .eq("provider_id", providerId)
        .eq("period_month", monthKey);

      if (invErr) {
        console.error("patient_invoices query failed", invErr.message);
        continue;
      }

      const patientInvoices = invRows || [];

      // Générer le statement PDF
      const statementPdf = await generateStatementPdf(monthKey, providerName, patientInvoices.length);
      const statementPdfPath = `providers/${providerId}/statements/DRIMLI_statement_${monthKey}.pdf`;

      const upStatement = await supabaseAdmin.storage
        .from("invoices")
        .upload(statementPdfPath, statementPdf, { contentType: "application/pdf", upsert: true });

      if (upStatement.error) {
        console.error("statement upload failed", upStatement.error.message);
        continue;
      }

      // Construire le ZIP : statement + invoices/
      const zipEntries: Array<{ name: string; data: Buffer }> = [
        { name: `DRIMLI_statement_${monthKey}.pdf`, data: statementPdf },
      ];

      for (const row of patientInvoices) {
        const bucket = row.bucket || "invoices";
        const path = row.file_path;
        const dl = await supabaseAdmin.storage.from(bucket).download(path);
        if (dl.error || !dl.data) continue;
        const buf = Buffer.from(await dl.data.arrayBuffer());
        const filename = path.split("/").pop() || "invoice.pdf";
        zipEntries.push({ name: `invoices/${filename}`, data: buf });
      }

      const zipBuffer = await makeZip(zipEntries);
      const zipPath = `providers/${providerId}/statements/DRIMLI_${monthKey}.zip`;

      const upZip = await supabaseAdmin.storage
        .from("invoices")
        .upload(zipPath, zipBuffer, { contentType: "application/zip", upsert: true });

      if (upZip.error) {
        console.error("zip upload failed", upZip.error.message);
        continue;
      }

      // Log en DB
      const { error: logErr } = await supabaseAdmin.from("monthly_statements").insert({
        provider_id: providerId,
        statement_month: monthKey,
        zip_bucket: "invoices",
        zip_path: zipPath,
        statement_pdf_bucket: "invoices",
        statement_pdf_path: statementPdfPath,
        sent_to: accountantEmail,
        status: "generated",
      });

      if (logErr) {
        console.error("monthly_statements insert failed", logErr.message);
      }

      console.log("✅ ZIP + statement générés pour", providerId, monthKey);
      // Lien signé du ZIP (7 jours) pour le comptable
const signedZipForEmail = await supabaseAdmin.storage
  .from("invoices")
  .createSignedUrl(zipPath, 60 * 60 * 24 * 7);

const zipUrlForEmail = signedZipForEmail.data?.signedUrl || "";

console.log("📧 Sending accountant email to:", accountantEmail);

await sendAccountantMonthlyZipEmail({
  to: accountantEmail,
  monthKey,
  zipUrl: zipUrlForEmail,
  providerName,
});

console.log("✅ Accountant email sent to:", accountantEmail);
     const signed = await supabaseAdmin.storage
  .from("invoices")
  .createSignedUrl(zipPath, 60 * 60 * 24 * 7);

const zipUrl = signed.data?.signedUrl || "";

try {
  await sendAccountantMonthlyZipEmail({
    to: accountantEmail.trim().toLowerCase(),
    monthKey,
    zipUrl,
    providerName,
  });
} catch (e: any) {
  console.error("❌ Email failed for", providerId, accountantEmail, e?.message || e);

  await supabaseAdmin
    .from("monthly_statements")
    .update({ status: "failed", error_message: String(e?.message || e) })
    .eq("provider_id", providerId)
    .eq("statement_month", monthKey);

  continue;
}
    }

    return NextResponse.json({ ok: true, month: monthKey });
  } catch (e: any) {
    console.error("monthly route error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
