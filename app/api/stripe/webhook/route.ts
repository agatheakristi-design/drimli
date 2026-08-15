import Stripe from "stripe";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAppointmentConfirmationEmail } from "@/lib/email";
import {
  createGoogleMeetAppointment,
  GoogleMeetError,
} from "@/lib/googleCalendar";
import {
  buildAppointmentPortalUrl,
  generateAppointmentJoinToken,
} from "@/lib/video/appointmentPortal";
import { calculateTaxBreakdown } from "@/lib/billing";
import { ensureClientCreditNote } from "@/lib/clientCreditNotes";
import {
  recordCollectedCommission,
  syncRefundedCommissionMovements,
} from "@/lib/drimliCommissionLedger";

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function expandedApplicationFee(paymentIntent: Stripe.PaymentIntent) {
  const charge = typeof paymentIntent.latest_charge === "object"
    ? paymentIntent.latest_charge
    : null;
  return charge && typeof charge.application_fee === "object"
    ? charge.application_fee
    : null;
}

async function retrieveApplicationFeeWithRetry(
  paymentIntentId: string,
  initialPaymentIntent: Stripe.PaymentIntent
) {
  const initialFee = expandedApplicationFee(initialPaymentIntent);
  if (initialFee) return initialFee;

  for (const delayMs of [0, 500, 1_000, 1_500]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const refreshedPaymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["latest_charge.application_fee"] }
    );
    const applicationFee = expandedApplicationFee(refreshedPaymentIntent);
    if (applicationFee) return applicationFee;
  }

  return null;
}

function safeMeetFailureMessage(stage: string) {
  const messages: Record<string, string> = {
    integration_lookup: "Google integration could not be checked.",
    integration_missing: "Google integration is absent.",
    refresh_token_missing: "Google refresh token is absent.",
    calendar_scope_missing: "Google Calendar scope is absent.",
    oauth_refresh: "Google OAuth refresh failed.",
    token_storage: "Refreshed Google credentials could not be stored.",
    calendar_insert: "Google Calendar event creation failed.",
    conference_creation: "Google Meet conference creation failed.",
    hangout_link_retrieval: "Google Meet URL retrieval failed.",
    organizer_mismatch:
      "Google Calendar organizer does not match the connected professional account.",
    supabase_write: "Google Meet fields could not be stored.",
    appointment_reload: "Confirmed appointment could not be reloaded.",
    email_send: "Confirmation email could not be sent.",
  };

  return messages[stage] ?? "Google Meet creation failed.";
}

type SupabaseWriteDiagnostic = {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};

class SupabaseMeetWriteError extends GoogleMeetError {
  constructor(public readonly diagnostic: SupabaseWriteDiagnostic) {
    super("supabase_write", "Google Meet fields could not be stored.");
    this.name = "SupabaseMeetWriteError";
  }
}

function sanitizeDatabaseDiagnostic(value: string | null | undefined) {
  if (!value) return null;

  return value
    .replace(/https:\/\/meet\.google\.com\/[^\s,)'";]+/gi, "[MEET_URL_REDACTED]")
    .slice(0, 1_000);
}

function pickAppointmentId(metadata: Record<string, string> | null | undefined): string | null {
  if (!metadata) return null;
  if (typeof metadata.appointmentId === "string") return metadata.appointmentId;
  if (typeof metadata.appointment_id === "string") return metadata.appointment_id;
  return null;
}

async function ensureAppointmentJoinToken(
  appointmentId: string,
  existingToken: string | null | undefined
) {
  const existing = existingToken?.trim();
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateAppointmentJoinToken();
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({ join_token: token })
      .eq("id", appointmentId)
      .is("join_token", null)
      .select("join_token")
      .maybeSingle<{ join_token: string | null }>();

    if (data?.join_token) return data.join_token;
    if (error && error.code !== "23505") throw error;

    const { data: concurrent, error: concurrentError } = await supabaseAdmin
      .from("appointments")
      .select("join_token")
      .eq("id", appointmentId)
      .maybeSingle<{ join_token: string | null }>();

    if (concurrentError) throw concurrentError;
    if (concurrent?.join_token) return concurrent.join_token;
  }

  throw new Error("Appointment join token could not be allocated.");
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
  providerBusinessName?: string | null;
  providerAddress: string;
  providerPostalCode?: string | null;
  providerCity: string;
  providerCountry: string;
  providerSiret: string;
  providerVatNumber?: string | null;
  providerVatRate: number; // ex: 0.2
  vatExemptionMention?: string | null;
  clientName: string;
  clientEmail?: string | null;
  serviceTitle: string;
  serviceDescription?: string | null;
  serviceDurationMinutes?: number | null;
  totalExcludingTax: number;
  vatAmount: number;
  totalIncludingTax: number;
  currency: string;
  issuedAtIso: string;
  serviceDateIso: string;
}) {
  // Lazy import to keep startup light
  const [{ default: chromium }, { chromium: playwrightChromium }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("playwright-core"),
  ]);

  const vatRate = Number.isFinite(params.providerVatRate) ? params.providerVatRate : 0;
  const ttc = params.totalIncludingTax / 100;
  const ht = params.totalExcludingTax / 100;
  const vat = params.vatAmount / 100;

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: params.currency }).format(n);

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
      <div>Date de prestation: ${new Date(params.serviceDateIso).toLocaleDateString("fr-FR")}</div>
    </div>
  </div>

  <div class="h1">Facture client</div>

  <div class="box">
    <div class="row">
      <div>
        <div class="muted">Émetteur (Professionnel)</div>
        <div><b>${escapeHtml(params.providerBusinessName || params.providerName)}</b></div>
        <div>${escapeHtml(params.providerName)}</div>
        <div class="muted">${escapeHtml(params.providerAddress)}, ${escapeHtml([params.providerPostalCode, params.providerCity].filter(Boolean).join(" "))}, ${escapeHtml(params.providerCountry)}</div>
        <div class="muted">SIRET : ${escapeHtml(params.providerSiret)}</div>
        ${params.providerVatNumber ? `<div class="muted">TVA : ${escapeHtml(params.providerVatNumber)}</div>` : ""}
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
          <td>${escapeHtml(params.serviceTitle)}${params.serviceDescription ? `<div class="muted">${escapeHtml(params.serviceDescription)}</div>` : ""}${params.serviceDurationMinutes ? `<div class="muted">Durée : ${params.serviceDurationMinutes} min</div>` : ""}</td>
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
    ${params.vatExemptionMention ? `<p class="muted">${escapeHtml(params.vatExemptionMention)}</p>` : ""}
  </div>

  <div class="footer">
    Cette facture est émise par le professionnel. Drimli fournit le service technique de génération et d’archivage.
  </div>
</body>
</html>`;

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(),
    headless: true,
  });
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
  let claimedEventId: string | null = null;
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
    } catch (error: unknown) {
      return NextResponse.json(
        {
          error: "Webhook signature verification failed",
          details: errorMessage(error),
        },
        { status: 400 }
      );
    }

    const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
      "claim_stripe_webhook_event",
      { p_id: event.id, p_type: event.type }
    );
    if (claimError) throw claimError;
    if (!claimed) {
      const { data: existingEvent, error: existingEventError } = await supabaseAdmin
        .from("stripe_webhook_events")
        .select("processing_status")
        .eq("id", event.id)
        .maybeSingle<{ processing_status: string }>();
      if (existingEventError) throw existingEventError;
      if (existingEvent?.processing_status === "completed") {
        return NextResponse.json({ received: true, idempotent: true });
      }
      return NextResponse.json(
        { error: "Webhook event is already being processed" },
        { status: 409 }
      );
    }
    claimedEventId = event.id;

    if (event.type === "refund.created" || event.type === "refund.updated" || event.type === "refund.failed") {
      const refund = event.data.object as Stripe.Refund;
      let paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
      if (!paymentIntentId && refund.charge) {
        const charge = await stripe.charges.retrieve(typeof refund.charge === "string" ? refund.charge : refund.charge.id);
        paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      }
      if (!paymentIntentId) throw new Error("Refund is missing its payment intent");
      const { data: payment } = await supabaseAdmin.from("drimli_payments").select("id, provider_id, amount_paid, application_fee_amount, currency, paid_at").eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
      if (payment) {
        const { data: stored, error: refundError } = await supabaseAdmin.from("drimli_refunds").upsert({ payment_id: payment.id, stripe_refund_id: refund.id, amount: refund.amount, currency: refund.currency.toUpperCase(), status: refund.status || "pending" }, { onConflict: "stripe_refund_id" }).select("id").single();
        if (refundError) throw refundError;
        const allRefunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
        const refundedAmount = allRefunds.data.filter((item) => item.status === "succeeded").reduce((sum, item) => sum + item.amount, 0);
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.application_fee"] });
        const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
        const applicationFee = charge && typeof charge.application_fee === "object" ? charge.application_fee : null;
        await supabaseAdmin.from("drimli_payments").update({ refunded_amount: refundedAmount, refunded_application_fee_amount: applicationFee?.amount_refunded ?? 0, status: refundedAmount === 0 ? "paid" : refundedAmount >= payment.amount_paid ? "refunded" : "partially_refunded", updated_at: new Date().toISOString() }).eq("id", payment.id);
        if (applicationFee) {
          await syncRefundedCommissionMovements({
            admin: supabaseAdmin,
            stripe,
            payment,
            applicationFeeId: applicationFee.id,
            refundId: stored.id,
            stripeRefundCreated: refund.created,
          });
        }
        if (refund.status === "succeeded") await ensureClientCreditNote(supabaseAdmin, stored.id, new Date(refund.created * 1000).toISOString());
      }
      const { error: completionError } = await supabaseAdmin.from("stripe_webhook_events").update({ processing_status: "completed", processed_at: new Date().toISOString(), last_error: null }).eq("id", event.id);
      if (completionError) throw completionError;
      return NextResponse.json({ received: true });
    }

    if (event.type !== "checkout.session.completed") {
      const { error: completionError } = await supabaseAdmin.from("stripe_webhook_events").update({
        processing_status: "completed",
        processed_at: new Date().toISOString(),
      }).eq("id", event.id);
      if (completionError) throw completionError;
      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== "paid") {
      const { error: pendingStatusError } = await supabaseAdmin.from("stripe_webhook_events").update({
        processing_status: "failed",
        last_error: `Unexpected payment status: ${session.payment_status}`,
      }).eq("id", event.id);
      if (pendingStatusError) throw pendingStatusError;
      return NextResponse.json({ received: true, pending: true });
    }

    // Email client collecté par Stripe Checkout
    const stripeClientEmail =
      session.customer_details?.email || session.customer_email || null;

    const appointmentId = pickAppointmentId(session.metadata);
    if (!appointmentId) {
      console.warn("checkout.session.completed without appointment id in metadata:", session.metadata);
      throw new Error("Missing appointment id in metadata");
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    if (!paymentIntentId || !session.amount_total || !session.currency) {
      throw new Error("Paid Checkout Session is missing payment identifiers or amount");
    }

    const { data: billingSnapshot, error: snapshotError } = await supabaseAdmin
      .from("billing_checkout_snapshots")
      .select("*")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();
    if (snapshotError || !billingSnapshot) throw new Error("Billing snapshot not found");
    if (
      billingSnapshot.amount_total !== session.amount_total ||
      billingSnapshot.currency.toLowerCase() !== session.currency.toLowerCase()
    ) throw new Error("Stripe payment does not match billing snapshot");
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.application_fee"],
    });
    if (paymentIntent.application_fee_amount !== billingSnapshot.application_fee_amount) {
      throw new Error("Stripe application fee does not match billing snapshot");
    }

    // 1) Charger appointment
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, provider_id, product_id, client_name, client_email, start_datetime, end_datetime, status, confirmation_email_sent_at, video_provider, video_join_url, video_room_id, join_token")
      .eq("id", appointmentId)
      .maybeSingle();

    if (apptErr || !appt) {
      console.error("Appointment not found:", apptErr?.message);
      throw new Error("Appointment not found");
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
        appt.client_email = stripeClientEmail;
      }
    }

    // 2) Confirmer appointment
    const { error: upErr } = await supabaseAdmin
      .from("appointments")
      .update({ status: "confirmed", stripe_payment_intent_id: paymentIntentId })
      .eq("id", appt.id);

    if (upErr) {
      throw new Error(`Failed to record paid appointment: ${upErr.message}`);
    }

    const paidAt = new Date(
      typeof paymentIntent.latest_charge === "object" && paymentIntent.latest_charge
        ? paymentIntent.latest_charge.created * 1000
        : paymentIntent.created * 1000
    ).toISOString();
    const { data: paymentRecord, error: paymentRecordError } = await supabaseAdmin.from("drimli_payments").upsert({
      appointment_id: appt.id,
      provider_id: appt.provider_id,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      amount_paid: session.amount_total,
      currency: session.currency.toUpperCase(),
      application_fee_amount: billingSnapshot.application_fee_amount,
      status: "paid",
      paid_at: paidAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_checkout_session_id" }).select("id, provider_id, application_fee_amount, currency, paid_at").single();
    if (paymentRecordError || !paymentRecord) throw paymentRecordError || new Error("Payment record missing");

    let joinToken: string;
    try {
      joinToken = await ensureAppointmentJoinToken(appt.id, appt.join_token);
    } catch {
      console.error("[APPOINTMENT_PORTAL_ERROR]", {
        appointmentId: appt.id,
        providerId: appt.provider_id,
        stage: "join_token_allocation",
      });
      throw new Error("Appointment portal unavailable after payment was recorded");
    }

    const { data: existingClientInvoice } = await supabaseAdmin
      .from("client_invoices")
      .select("*")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

    let clientInvoice = existingClientInvoice;
    if (!clientInvoice) {
      const tax = calculateTaxBreakdown(
        session.amount_total,
        billingSnapshot.vat_regime,
        Number(billingSnapshot.vat_rate)
      );
      const issuedAt = paidAt;
      const { data: reservedInvoice, error: reserveError } = await supabaseAdmin.rpc(
        "create_paid_client_invoice",
        { p_invoice: {
          provider_id: appt.provider_id, appointment_id: appt.id,
          product_id: appt.product_id, stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId, issued_at: issuedAt,
          paid_at: paidAt, service_date: appt.start_datetime,
          issuer_full_name: billingSnapshot.issuer_full_name,
          issuer_business_name: billingSnapshot.issuer_business_name,
          issuer_profession: billingSnapshot.issuer_profession,
          issuer_email: billingSnapshot.issuer_email, issuer_phone: billingSnapshot.issuer_phone,
          issuer_address: billingSnapshot.issuer_address, issuer_city: billingSnapshot.issuer_city,
          issuer_postal_code: billingSnapshot.issuer_postal_code,
          issuer_country: billingSnapshot.issuer_country, issuer_siret: billingSnapshot.issuer_siret,
          issuer_vat_number: billingSnapshot.issuer_vat_number,
          customer_name: billingSnapshot.customer_name, customer_email: billingSnapshot.customer_email,
          customer_phone: billingSnapshot.customer_phone, service_title: billingSnapshot.service_title,
          service_description: billingSnapshot.service_description,
          service_duration_minutes: billingSnapshot.service_duration_minutes,
          total_excluding_tax: tax.totalExcludingTax, vat_rate: tax.vatRate,
          vat_amount: tax.vatAmount, total_including_tax: session.amount_total,
          currency: session.currency.toUpperCase(), vat_regime: billingSnapshot.vat_regime,
          vat_exemption_mention: tax.vatExemptionMention,
          client_download_token_hash: billingSnapshot.client_download_token_hash,
        } }
      );
      if (reserveError || !reservedInvoice) throw new Error("Invoice reservation failed");
      clientInvoice = reservedInvoice;
    }

    if (!clientInvoice.file_path) {
      const pdf = await generatePatientInvoicePdf({
        invoiceNumber: clientInvoice.invoice_number,
        providerName: clientInvoice.issuer_full_name,
        providerBusinessName: clientInvoice.issuer_business_name,
        providerAddress: clientInvoice.issuer_address,
        providerPostalCode: clientInvoice.issuer_postal_code,
        providerCity: clientInvoice.issuer_city,
        providerCountry: clientInvoice.issuer_country,
        providerSiret: clientInvoice.issuer_siret,
        providerVatNumber: clientInvoice.issuer_vat_number,
        providerVatRate: Number(clientInvoice.vat_rate),
        vatExemptionMention: clientInvoice.vat_exemption_mention,
        clientName: clientInvoice.customer_name,
        clientEmail: clientInvoice.customer_email,
        serviceTitle: clientInvoice.service_title,
        serviceDescription: clientInvoice.service_description,
        serviceDurationMinutes: clientInvoice.service_duration_minutes,
        totalExcludingTax: clientInvoice.total_excluding_tax,
        vatAmount: clientInvoice.vat_amount,
        totalIncludingTax: clientInvoice.total_including_tax,
        currency: clientInvoice.currency,
        issuedAtIso: clientInvoice.issued_at,
        serviceDateIso: clientInvoice.service_date,
      });
      const periodMonth = monthKeyFromIso(clientInvoice.issued_at);
      const filePath = `providers/${appt.provider_id}/invoices/${periodMonth}/patient_invoice_${session.id}.pdf`;
      const upload = await supabaseAdmin.storage.from("invoices").upload(filePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (upload.error) throw upload.error;

      const { error: invoiceError } = await supabaseAdmin.from("client_invoices").update({
        storage_bucket: "invoices",
        file_path: filePath,
        generated_at: new Date().toISOString(),
        content_hash: createHash("sha256").update(pdf).digest("hex"),
      }).eq("id", clientInvoice.id).is("file_path", null);
      if (invoiceError) throw invoiceError;

      await supabaseAdmin.from("patient_invoices").upsert({
        provider_id: appt.provider_id,
        appointment_id: appt.id,
        stripe_checkout_session_id: session.id,
        period_month: periodMonth,
        bucket: "invoices",
        file_path: filePath,
      }, { onConflict: "stripe_checkout_session_id" });
    }

    const paidApplicationFee = await retrieveApplicationFeeWithRetry(
      paymentIntentId,
      paymentIntent
    );
    if (!paidApplicationFee) {
      throw new Error("Stripe application fee is not available yet");
    }
    await recordCollectedCommission(
      supabaseAdmin,
      paymentRecord,
      paidApplicationFee.id
    );

    // Effet secondaire : Google Meet ne doit pas bloquer le paiement,
    // la facture ou le calendrier client.
    try {
      if (
        !appt.video_join_url &&
        appt.start_datetime &&
        appt.end_datetime
      ) {
        const meeting = await createGoogleMeetAppointment({
          appointmentId: appt.id,
          providerId: appt.provider_id,
          title: "Rendez-vous Drimli",
          start: new Date(appt.start_datetime).toISOString(),
          end: new Date(appt.end_datetime).toISOString(),
          attendeeEmail: appt.client_email,
        });

        const { data: videoUpdate, error: videoUpdateError } =
          await supabaseAdmin
          .from("appointments")
          .update({
            video_provider: "google_meet",
            video_join_url: meeting.hangoutLink,
            video_room_id: meeting.eventId,
          })
          .eq("id", appt.id)
          .select("video_provider, video_join_url, video_room_id")
          .maybeSingle();

        if (videoUpdateError) {
          throw new SupabaseMeetWriteError({
            code: videoUpdateError.code ?? null,
            message:
              sanitizeDatabaseDiagnostic(videoUpdateError.message) ??
              "Supabase update failed.",
            details: sanitizeDatabaseDiagnostic(videoUpdateError.details),
            hint: sanitizeDatabaseDiagnostic(videoUpdateError.hint),
          });
        }

        if (!videoUpdate?.video_join_url) {
          throw new SupabaseMeetWriteError({
            code: null,
            message: "Supabase update returned no persisted Google Meet URL.",
            details: "The update matched no readable appointment row.",
            hint: "Check the appointment filter and update/select permissions.",
          });
        }

        console.log("[GOOGLE_MEET_SUCCESS]", {
          appointmentId: appt.id,
          providerId: appt.provider_id,
          eventId: videoUpdate.video_room_id,
          hangoutLinkPresent: true,
        });
      }
    } catch (error: unknown) {
      const stage =
        error instanceof GoogleMeetError ? error.stage : "unknown";
      console.error("[GOOGLE_MEET_ERROR]", {
        appointmentId: appt.id,
        providerId: appt.provider_id,
        stage,
        message:
          error instanceof SupabaseMeetWriteError
            ? error.diagnostic.message
            : safeMeetFailureMessage(stage),
        ...(error instanceof SupabaseMeetWriteError
          ? {
              code: error.diagnostic.code,
              details: error.diagnostic.details,
              hint: error.diagnostic.hint,
              fields: [
                "video_provider",
                "video_join_url",
                "video_room_id",
              ],
            }
          : {}),
      });
    }

    const { data: reloadedAppointment, error: reloadError } =
      await supabaseAdmin
        .from("appointments")
        .select(
          "id, provider_id, product_id, client_name, client_email, start_datetime, end_datetime, status, confirmation_email_sent_at, video_provider, video_join_url, video_room_id, join_token"
        )
        .eq("id", appt.id)
        .maybeSingle();

    if (reloadError || !reloadedAppointment) {
      console.error("[GOOGLE_MEET_ERROR]", {
        appointmentId: appt.id,
        providerId: appt.provider_id,
        stage: "appointment_reload",
        message: "Confirmed appointment could not be reloaded.",
      });
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

    if (profErr) {
      console.error("Profile lookup failed:", profErr.message);
    }
    if (prodErr) {
      console.error("Product lookup failed:", prodErr.message);
    }

    const providerName = String(prof?.full_name ?? "").trim();

    if (!providerName) {
      console.error("❌ Missing provider full_name in profiles for provider_id:", appt.provider_id);
    }
    const serviceTitle = (prod?.title || "Prestation").toString();

    // Effet secondaire : l'email peut être retenté sans invalider le paiement.
    if (
      reloadedAppointment &&
      !reloadedAppointment.confirmation_email_sent_at &&
      reloadedAppointment.client_email &&
      reloadedAppointment.start_datetime &&
      reloadedAppointment.end_datetime
    ) {
      try {
        await sendAppointmentConfirmationEmail({
          appointmentId: appt.id,
          to: reloadedAppointment.client_email,
          patientName: reloadedAppointment.client_name,
          providerName,
          serviceTitle,
          startDateTimeIso: new Date(
            reloadedAppointment.start_datetime
          ).toISOString(),
          endDateTimeIso: new Date(
            reloadedAppointment.end_datetime
          ).toISOString(),
          appointmentJoinUrl: buildAppointmentPortalUrl(joinToken),
        });

        const { error: sentAtError } = await supabaseAdmin
          .from("appointments")
          .update({ confirmation_email_sent_at: new Date().toISOString() })
          .eq("id", appt.id)
          .is("confirmation_email_sent_at", null);

        if (sentAtError) {
          throw new GoogleMeetError(
            "email_send",
            "Confirmation email was sent but its status could not be stored."
          );
        }
      } catch (error: unknown) {
        const errorRecord =
          typeof error === "object" && error !== null
            ? (error as Record<string, unknown>)
            : null;
        const sanitizedMessage = errorMessage(error)
          .replace(
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
            "[email redacted]"
          )
          .replace(
            /(?:re_|sk_(?:live|test)_|whsec_)[A-Za-z0-9_-]+/g,
            "[secret redacted]"
          );
        const resendCode = errorRecord?.code;
        const resendStatus = errorRecord?.statusCode ?? errorRecord?.status;

        console.error("[GOOGLE_MEET_ERROR]", {
          appointmentId: appt.id,
          providerId: appt.provider_id,
          stage: "email_send",
          errorType:
            typeof errorRecord?.name === "string"
              ? errorRecord.name
              : error instanceof Error
                ? error.constructor.name
                : typeof error,
          message: sanitizedMessage,
          ...(typeof resendCode === "string" || typeof resendCode === "number"
            ? { code: resendCode }
            : {}),
          ...(typeof resendStatus === "string" ||
          typeof resendStatus === "number"
            ? { status: resendStatus }
            : {}),
        });
      }
    }

    const { error: completionError } = await supabaseAdmin.from("stripe_webhook_events").update({
      processing_status: "completed",
      processed_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", event.id);
    if (completionError) throw completionError;

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Webhook handler error:", errorMessage(error));
    if (claimedEventId) {
      await supabaseAdmin.from("stripe_webhook_events").update({
        processing_status: "failed",
        last_error: errorMessage(error).slice(0, 1_000),
      }).eq("id", claimedEventId);
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
