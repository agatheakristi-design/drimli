import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isGoogleMeetUrl,
  sendAppointmentConfirmationEmail,
} from "@/lib/email";
import {
  createGoogleMeetAppointment,
  GoogleMeetError,
} from "@/lib/googleCalendar";

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
    supabase_write: "Google Meet fields could not be stored.",
    appointment_reload: "Confirmed appointment could not be reloaded.",
    email_send: "Confirmation email could not be sent.",
  };

  return messages[stage] ?? "Google Meet creation failed.";
}

function pickAppointmentId(metadata: Record<string, string> | null | undefined): string | null {
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
  const [{ default: chromium }, { chromium: playwrightChromium }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("playwright-core"),
  ]);

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

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
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

    // Idempotence webhook
    const { data: alreadyEvent } = await supabaseAdmin
      .from("stripe_webhook_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (event.type !== "checkout.session.completed") {
      if (!alreadyEvent) {
        await supabaseAdmin
          .from("stripe_webhook_events")
          .insert({ id: event.id, type: event.type });
      }
      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // Email client collecté par Stripe Checkout
    const stripeClientEmail =
      session.customer_details?.email || session.customer_email || null;

    const appointmentId = pickAppointmentId(session.metadata);
    if (!appointmentId) {
      console.warn("checkout.session.completed without appointment id in metadata:", session.metadata);
      return NextResponse.json({ received: true, warning: "Missing appointment id in metadata" });
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    // 1) Charger appointment
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, provider_id, product_id, client_name, client_email, start_datetime, end_datetime, status, confirmation_email_sent_at, video_provider, video_join_url, video_room_id")
      .eq("id", appointmentId)
      .maybeSingle();

    if (apptErr || !appt) {
      console.error("Appointment not found:", apptErr?.message);
      return NextResponse.json({ received: true, warning: "Appointment not found" });
    }

    if (alreadyEvent && appt.confirmation_email_sent_at) {
      if (
        appt.video_provider === "google_meet" &&
        isGoogleMeetUrl(appt.video_join_url)
      ) {
        return NextResponse.json({ received: true, idempotent: true });
      }

      console.error("[GOOGLE_MEET_ERROR]", {
        appointmentId: appt.id,
        providerId: appt.provider_id,
        stage: "appointment_reload",
        message: "Inconsistent state: email marked sent without a Google Meet URL.",
      });
      return NextResponse.json(
        { error: "Inconsistent appointment confirmation state" },
        { status: 500 }
      );
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

    // 2.5) Créer le rendez-vous Google Meet si le professionnel est connecté
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
          throw new GoogleMeetError(
            "supabase_write",
            `Failed to store Google Meet fields: ${videoUpdateError.message}`
          );
        }

        if (!videoUpdate?.video_join_url) {
          throw new GoogleMeetError(
            "supabase_write",
            "Google Meet was created but appointments.video_join_url was not persisted."
          );
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
        message: safeMeetFailureMessage(stage),
      });
      return NextResponse.json(
        { error: "Meeting creation failed" },
        { status: 500 }
      );
    }

    const { data: reloadedAppointment, error: reloadError } =
      await supabaseAdmin
        .from("appointments")
        .select(
          "id, provider_id, product_id, client_name, client_email, start_datetime, end_datetime, status, confirmation_email_sent_at, video_provider, video_join_url, video_room_id"
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
      return NextResponse.json(
        { error: "Appointment reload failed" },
        { status: 500 }
      );
    }

    const hasValidMeetUrl = isGoogleMeetUrl(
      reloadedAppointment.video_join_url
    );

    if (
      reloadedAppointment.video_provider !== "google_meet" ||
      !hasValidMeetUrl
    ) {
      console.error("[GOOGLE_MEET_ERROR]", {
        appointmentId: appt.id,
        providerId: appt.provider_id,
        stage: "appointment_reload",
        message: reloadedAppointment.confirmation_email_sent_at
          ? "Inconsistent state: email marked sent without a Google Meet URL."
          : "Google Meet URL is absent after appointment reload.",
      });
      return NextResponse.json(
        { error: "Meeting link unavailable" },
        { status: 500 }
      );
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
    const vatRate = 0;
    const serviceTitle = (prod?.title || "Prestation").toString();
    const serviceTtcCents = Number(prod?.price_cents ?? 0) || 0;

    // 4) Email de confirmation — uniquement après persistance et relecture de Meet
    if (
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
          videoProvider: reloadedAppointment.video_provider,
          videoJoinUrl: reloadedAppointment.video_join_url,
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
      } catch {
        console.error("[GOOGLE_MEET_ERROR]", {
          appointmentId: appt.id,
          providerId: appt.provider_id,
          stage: "email_send",
          message: safeMeetFailureMessage("email_send"),
        });
        return NextResponse.json(
          { error: "Confirmation email failed" },
          { status: 500 }
        );
      }
    }

    // 5) Facture COMMISSION (déjà en place chez toi) — on garde le code simple
    // Récupérer la commission (application_fee_amount) si possible
    let feeCents: number | null = null;
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        feeCents = pi.application_fee_amount ?? null;
      } catch (error: unknown) {
        console.error("Could not retrieve payment intent:", errorMessage(error));
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

    // 6) Générer + archiver la facture PATIENT (PDF)
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

    if (!alreadyEvent) {
      const { error: eventStoreError } = await supabaseAdmin
        .from("stripe_webhook_events")
        .insert({ id: event.id, type: event.type });

      if (eventStoreError) {
        console.warn("Stripe webhook event completion marker was not stored.");
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Webhook handler error:", errorMessage(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
