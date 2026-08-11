import { Resend } from "resend";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const resend = new Resend(requireEnv("RESEND_API_KEY"));

/**
 * IMPORTANT:
 * - En dev, tu peux utiliser l'adresse "onboarding@resend.dev" (ou celle recommandée par Resend)
 * - En prod, il faudra un domaine vérifié et un FROM du domaine.
 *
 * Pour éviter que ça casse, on utilise RESEND_FROM si présent, sinon une valeur dev.
 */
const FROM = process.env.RESEND_FROM || "Drimli <onboarding@resend.dev>";

export type AppointmentEmailPayload = {
  appointmentId: string;
  to: string;
  patientName?: string | null;
  providerName: string;
  serviceTitle: string;
  startDateTimeIso: string;
  endDateTimeIso: string;
  appointmentJoinUrl: string;
};

export type GoogleReviewRequestEmailPayload = {
  appointmentId: string;
  to: string;
  providerName: string;
  reviewUrl: string;
  idempotencyKey?: string;
};

export async function sendAppointmentConfirmationEmail(p: AppointmentEmailPayload) {
  const subject = `Votre rendez-vous avec ${p.providerName} est confirmé`;

  const patientLine = p.patientName?.trim()
    ? `Bonjour ${p.patientName.trim()},`
    : `Bonjour,`;

  const dateLabel = new Date(p.startDateTimeIso).toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const startLabel = new Date(p.startDateTimeIso).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  });
  const endLabel = new Date(p.endDateTimeIso).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Email simple (on fera joli après). Pas de CSS, compatible partout.
  const text = [
    patientLine,
    "",
    "Votre rendez-vous est confirmé.",
    "",
    `Professionnel : ${p.providerName}`,
    `Prestation : ${p.serviceTitle}`,
    `Date : ${dateLabel}`,
    `Horaire : ${startLabel} – ${endLabel}`,
    "",
    "Rejoindre la visio :",
    p.appointmentJoinUrl,
    "",
    "—",
    "Drimli",
  ].join("\n");
const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.6; color:#111;">
    <p>${escapeHtml(patientLine)}</p>

    <p><strong>Votre rendez-vous avec ${escapeHtml(p.providerName)} est confirmé.</strong></p>

    <p>
      <strong>Prestation :</strong> ${escapeHtml(p.serviceTitle)}<br/>
      <strong>Date :</strong> ${escapeHtml(dateLabel)}<br/>
      <strong>Horaire :</strong> ${escapeHtml(startLabel)} – ${escapeHtml(endLabel)}<br/>
    </p>

    <p>Cliquez sur le bouton ci-dessous pour rejoindre votre visioconférence Google Meet.</p>

    <p style="margin:16px 0;">
      <a href="${escapeHtml(p.appointmentJoinUrl)}"
         target="_blank"
         rel="noreferrer"
         style="display:inline-block;padding:12px 16px;background:#111;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;">
        Rejoindre la visio
      </a>
    </p>

    <p style="opacity:0.7;">—<br/>Drimli</p>
  </div>
  `;

  const { data, error } = await resend.emails.send(
    {
      from: FROM,
      to: p.to,
      subject,
      text,
      html,
    },
    { idempotencyKey: `appointment-confirmation/${p.appointmentId}` }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function sendGoogleReviewRequestEmail(
  p: GoogleReviewRequestEmailPayload
) {
  const subject = "Merci pour notre échange";
  const text = [
    "Bonjour,",
    "",
    "Merci pour notre échange aujourd’hui.",
    "",
    "Si vous souhaitez partager votre expérience, vous pouvez laisser un avis sur ma fiche Google en cliquant sur le bouton ci-dessous.",
    "",
    "Chaque avis compte et m’aide à développer mon activité.",
    "",
    "Laisser un avis Google",
    p.reviewUrl,
    "",
    "À bientôt,",
    p.providerName,
    "",
    "Cet email vous est envoyé automatiquement après votre rendez-vous afin de vous permettre de partager votre expérience si vous le souhaitez.",
  ].join("\n");
  const html = `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111;">
    <p>Bonjour,</p>
    <p>Merci pour notre échange aujourd’hui.</p>
    <p>Si vous souhaitez partager votre expérience, vous pouvez laisser un avis sur ma fiche Google en cliquant sur le bouton ci-dessous.</p>
    <p>Chaque avis compte et m’aide à développer mon activité.</p>
    <p style="margin:20px 0;">
      <a href="${escapeHtml(p.reviewUrl)}"
         target="_blank"
         rel="noreferrer"
         style="display:inline-block;padding:12px 16px;background:#111;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;">
        Laisser un avis Google
      </a>
    </p>
    <p>À bientôt,<br/>${escapeHtml(p.providerName)}</p>
    <p style="margin-top:28px;font-size:12px;color:#666;">
      Cet email vous est envoyé automatiquement après votre rendez-vous afin de vous permettre de partager votre expérience si vous le souhaitez.
    </p>
  </div>`;

  const { data, error } = await resend.emails.send(
    {
      from: FROM,
      to: p.to,
      subject,
      text,
      html,
    },
    {
      idempotencyKey:
        p.idempotencyKey ?? `google-review-request/${p.appointmentId}`,
    }
  );

  if (error) throw new Error(error.message || "Resend send failed");
  return data;
}

export async function sendAccountantMonthlyZipEmail(p: {
  to: string;
  monthKey: string; // "YYYY-MM"
  zipUrl: string;
  providerName?: string;
}) {
  const subject = `DRIMLI – Monthly invoices + statement (${p.monthKey})`;

  const text = [
    `Bonjour,`,
    "",
    `Veuillez trouver le ZIP mensuel DRIMLI (${p.monthKey}) contenant :`,
    `- le relevé DRIMLI (statement)`,
    `- les factures patients du mois`,
    "",
    `Professionnel : ${p.providerName || "—"}`,
    "",
    "Lien de téléchargement (valide 7 jours) :",
    p.zipUrl,
    "",
    "—",
    "Drimli",
  ].join("\n");

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5;">
    <p>Bonjour,</p>

    <p>
      Veuillez trouver le ZIP mensuel DRIMLI (<strong>${escapeHtml(p.monthKey)}</strong>) contenant :
      <ul>
        <li>le relevé DRIMLI (statement)</li>
        <li>les factures patients du mois</li>
      </ul>
    </p>

    <p><strong>Professionnel :</strong> ${escapeHtml(p.providerName || "—")}</p>

    <p>
      <strong>Lien de téléchargement (valide 7 jours) :</strong><br/>
      <a href="${p.zipUrl}">${p.zipUrl}</a>
    </p>

    <p style="opacity:0.7;">—<br/>Drimli</p>
  </div>
  `;

  const { data, error } = await resend.emails.send({
    from: FROM,
    to: p.to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(error.message || "Resend send failed");
  }

  return data;
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
