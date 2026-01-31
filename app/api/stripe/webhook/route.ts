import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAppointmentConfirmationEmail } from "@/lib/email";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-12-15.clover",
});

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

function pickAppointmentId(metadata: Record<string, any> | null | undefined): string | null {
  if (!metadata) return null;
  if (typeof metadata.appointmentId === "string") return metadata.appointmentId;
  if (typeof metadata.appointment_id === "string") return metadata.appointment_id;
  return null;
}

function monthKeyFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function generatePatientInvoicePdf(params: {
  invoiceNumber: string;
  providerName: string;
  providerVatRate: number; // ex: 0.2
  clientName: string;
  clientEmail?: string | null;
  serviceTitle: string;
  serviceTtcCents: number;
  issuedAtIso: string;
}) {
  // Lazy import to keep startup light
  const { chromium } = await import("playwright");

  const vatRate = Number.isFinite(params.providerVatRate) ? params.providerVatRate : 0;
  const ttc = params.serviceTtcCents / 100;
  const ht = vatRate > 0 ? ttc / (1 + vatRate) : ttc;
  const vat = ttc - ht;

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Facture ${params.invoiceNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 40px; }
    .row { display: flex; justify-content: space-between; }
    .brand { font-weight: 700; font-size: 18px; letter-spacing: 0.5px; }
    .muted { color: #555; font-size: 12px; }
    .h1 { font-size: 20px; font-weight: 700; margin: 18px 0 4px; }
    .box { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; }
    th { background: #fafafa; }
    .right { text-align: right; }
    .total { font-weight: 700; font-size: 14px; }
    .footer { margin-top: 18px; font-size: 11px; color: #666; }
  </style>
</head>
<body>
  <div class="row">
    <div>
      <div class="brand">DRIMLI</div>
      <div class="muted">Facture générée via la plateforme Drimli</div>
    </div>
    <div class="muted" style="text-align:right">
      <div><b>Facture</b> ${params.invoiceNumber}</div>
      <div>Date: ${new Date(params.issuedAtIso).toLocaleDateString("fr-FR")}</div>
    </div>
  </div>

  <div class="h1">Facture client</div>

  <div class="box">
    <div class="row">
      <div>
        <div class="muted">Émetteur (Professionnel)</div>
        <div><b>${escapeHtml(params.providerName)}</b></div>
      </div>
      <div>
        <div class="muted">Client</div>
        <div><b>${escapeHtml(params.clientName || "Client")}</b></div>
        ${params.clientEmail ? `<div class="muted">${escapeHtml(params.clientEmail)}</div>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Prestation</th>
          <th class="right">Montant TTC</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(params.serviceTitle)}</td>
          <td class="right">${fmt(ttc)}</td>
        </tr>
      </tbody>
    </table>

    <table>
      <tbody>
        <tr>
          <td class="right muted">Total HT</td>
          <td class="right">${fmt(ht)}</td>
        </tr>
        <tr>
          <td class="right muted">TVA (${Math.round(vatRate * 100)}%)</td>
          <td class="right">${fmt(vat)}</td>
        </tr>
        <tr>
          <td class="right total">Total TTC</td>
          <td class="right total">${fmt(ttc)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    Cette facture est émise par le professionnel. Drimli fournit le service technique de génération et d’archivage.
  </div>
</body>
</html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
  });
  await browser.close();

  return Buffer.from(pdfBuffer);
}

function escapeHtml(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const rawBody = await req.text();
    const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      return NextResponse.json(
        { error: "Webhook signature verification failed", details: err?.message },
        { status: 400 }
      );
    }

    // Idempotence webhook
    const { data: alreadyEvent } = await supabaseAdmin
      .from("stripe_webhook_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (alreadyEvent) return NextResponse.json({ received: true, idempotent: true });

    await supabaseAdmin.from("stripe_webhook_events").insert({ id: event.id, type: event.type });

    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // Email client collecté par Stripe Checkout
    const stripeClientEmail =
      (session.customer_details && typeof (session.customer_details as any).email === "string"
        ? (session.customer_details as any).email
        : null) ||
      (typeof (session as any).customer_email === "string" ? (session as any).customer_email : null);

    const appointmentId = pickAppointmentId(session.metadata);
    if (!appointmentId) {
      console.warn("checkout.session.completed without appointment id in metadata:", session.metadata);
      return NextResponse.json({ received: true, warning: "Missing appointment id in metadata" });
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent as any)?.id ?? null;

    // 1) Charger appointment
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, provider_id, product_id, client_name, client_email, start_datetime, status, join_token, confirmation_email_sent_at")
      .eq("id", appointmentId)
      .maybeSingle();

    if (apptErr || !appt) {
      console.error("Appointment not found:", apptErr?.message);
      return NextResponse.json({ received: true, warning: "Appointment not found" });
    }

    // 1.5) Sync client_email from Stripe (si Drimli ne l'avait pas)
    if (!appt.client_email && stripeClientEmail) {
      const { error: emUpErr } = await supabaseAdmin
        .from("appointments")
        .update({ client_email: stripeClientEmail })
        .eq("id", appt.id);
      if (emUpErr) {
        console.error("Failed to store client_email:", emUpErr.message);
      } else {
        (appt as any).client_email = stripeClientEmail;
      }
    }

    // 2) Confirmer appointment
    if (appt.status !== "confirmed") {
      const { error: upErr } = await supabaseAdmin
        .from("appointments")
        .update({ status: "confirmed" })
        .eq("id", appt.id);

      if (upErr) {
        console.error("Failed to update appointment status:", upErr.message);
        return NextResponse.json({ received: true, warning: "Update failed" });
      }
    }

    // 3) Charger infos pro + service

    const [{ data: prof, error: profErr }, { data: prod, error: prodErr }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("provider_id", appt.provider_id)
        .maybeSingle(),
      supabaseAdmin
        .from("products")
        .select("title, price_cents")
        .eq("id", appt.product_id)
        .maybeSingle(),
    ]);

    const providerName = String(prof?.full_name ?? "").trim();

    if (!providerName) {
      console.error("❌ Missing provider full_name in profiles for provider_id:", appt.provider_id);
    }
    const vatRate = 0;
    const serviceTitle = (prod?.title || "Prestation").toString();
    const serviceTtcCents = Number(prod?.price_cents ?? 0) || 0;

    // 4) Facture COMMISSION (déjà en place chez toi) — on garde le code simple
    // Récupérer la commission (application_fee_amount) si possible
    let feeCents: number | null = null;
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        feeCents = pi.application_fee_amount ?? null;
      } catch (e: any) {
        console.error("Could not retrieve payment intent:", e?.message || e);
      }
    }
    if (!feeCents && session.metadata?.drimli_fee_cents) {
      feeCents = Number(session.metadata.drimli_fee_cents);
    }

    if (feeCents && feeCents > 0) {
      const year = new Date().getUTCFullYear();

      const { data: seqRow } = await supabaseAdmin
        .from("invoice_sequences")
        .upsert({ year, last_number: 0 }, { onConflict: "year" })
        .select("year,last_number")
        .maybeSingle();

      const nextNumber = (seqRow?.last_number ?? 0) + 1;

      const { error: seqErr } = await supabaseAdmin
        .from("invoice_sequences")
        .update({ last_number: nextNumber })
        .eq("year", year);

      if (!seqErr) {
        const invoiceNumber = `DR-${year}-${String(nextNumber).padStart(6, "0")}`;

        await supabaseAdmin.from("invoices").insert({
          provider_id: appt.provider_id,
          appointment_id: appt.id,
          type: "COMMISSION",
          status: "ISSUED",
          invoice_number: invoiceNumber,
          currency: "eur",
          total_ht: feeCents,
          total_vat: 0,
          total_ttc: feeCents,
          stripe_payment_intent_id: paymentIntentId,
          stripe_checkout_session_id: session.id,
        });
      }
    }

    // 5) Générer + archiver la facture PATIENT (PDF)
    // On évite les doublons grâce à l’index unique session_id
    const { data: existingPatientInvoice } = await supabaseAdmin
      .from("patient_invoices")
      .select("id")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

    if (!existingPatientInvoice) {
      const periodMonth = appt.start_datetime ? monthKeyFromIso(appt.start_datetime) : monthKeyFromIso(new Date().toISOString());
      const nowIso = new Date().toISOString();
      const invoiceNumber = `C-${periodMonth}-${session.id.slice(-6).toUpperCase()}`;

      const pdf = await generatePatientInvoicePdf({
        invoiceNumber,
        providerName,
        providerVatRate: vatRate,
        clientName: appt.client_name || "Client",
        clientEmail: appt.client_email,
        serviceTitle,
        serviceTtcCents,
        issuedAtIso: nowIso,
      });

      const filePath = `providers/${appt.provider_id}/invoices/${periodMonth}/patient_invoice_${session.id}.pdf`;

      const upload = await supabaseAdmin.storage
        .from("invoices")
        .upload(filePath, pdf, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (upload.error) {
        console.error("PDF upload failed:", upload.error.message);
      } else {
        const { error: insErr } = await supabaseAdmin.from("patient_invoices").insert({
          provider_id: appt.provider_id,
          appointment_id: appt.id,
          stripe_checkout_session_id: session.id,
          period_month: periodMonth,
          bucket: "invoices",
          file_path: filePath,
        });

        if (insErr) {
          console.error("patient_invoices insert failed:", insErr.message);
        } else {
          console.log("✅ Patient invoice archived:", filePath);
        }
      }
    }

    // 5.5) Assurer un join_token (lien Drimcall)
    if (!appt.join_token) {
      // On réutilise access_token si présent (compat), sinon on génère
      const fallback = (appt as any).access_token || null;
      const token = fallback || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const { data: upTok, error: upTokErr } = await supabaseAdmin
        .from("appointments")
        .update({ join_token: token })
        .eq("id", appt.id)
        .select("join_token")
        .maybeSingle();
      if (!upTokErr && upTok?.join_token) {
        (appt as any).join_token = upTok.join_token;
      }
    }

    // 6) Email de confirmation (Drimcall) — 1 seule fois

    if (appt.client_email && appt.join_token && appt.start_datetime) {
      // Verrou anti-doublon : on "réserve" l'envoi en base
      const { data: lockRow, error: lockErr } = await supabaseAdmin
        .from("appointments")
        .update({ confirmation_email_sent_at: new Date().toISOString() })
        .eq("id", appt.id)
        .is("confirmation_email_sent_at", null)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (lockErr) {
        console.error("Email lock failed:", lockErr.message);
      }

      // On envoie seulement si on a pris le lock
      if (lockRow?.id) {
        const manageUrl = `${APP_URL}/rendez-vous/${encodeURIComponent(appt.join_token)}`;
        const waitingRoomUrl = `${APP_URL}/attente/${encodeURIComponent(appt.join_token)}`;

        try {
          await sendAppointmentConfirmationEmail({
            to: appt.client_email,
            patientName: appt.client_name,
            providerName,
            serviceTitle,
            startDateTimeIso: new Date(appt.start_datetime).toISOString(),
            manageUrl,
            });
        } catch (e: any) {
          console.error("Email send failed:", e?.message || e);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error("Webhook handler error:", e?.message || e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
