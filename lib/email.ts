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
  to: string;
  patientName?: string | null;
  providerName: string;
  serviceTitle: string;
  startDateTimeIso: string; // ISO
  manageUrl: string; // point d'entrée du rendez-vous
  videoProvider?: string | null;
  videoJoinUrl?: string | null;
};

export async function sendAppointmentConfirmationEmail(p: AppointmentEmailPayload) {
  const subject = `Votre rendez-vous avec ${p.providerName} est confirmé`;

  const patientLine = p.patientName?.trim()
    ? `Bonjour ${p.patientName.trim()},`
    : `Bonjour,`;

  const joinUrl = p.videoProvider === "google_meet" && p.videoJoinUrl ? p.videoJoinUrl : p.manageUrl;

  const actionLabel =
    p.videoProvider === "google_meet"
      ? "Rejoindre la visio"
      : p.videoProvider === "whatsapp"
      ? "Accéder à la salle d'attente"
      : "Voir les informations du rendez-vous";

  // Email simple (on fera joli après). Pas de CSS, compatible partout.
  const text = [
    patientLine,
    "",
    "Votre rendez-vous est confirmé.",
    "",
    `Professionnel : ${p.providerName}`,
    `Prestation : ${p.serviceTitle}`,
    `Date/heure : ${new Date(p.startDateTimeIso).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
    "",
    "Le jour de votre rendez-vous, utilisez le lien ci-dessous pour accéder aux informations correspondantes :",
    joinUrl,
    "",
    "Lien de secours à copier :",
    joinUrl,
    "",
    "—",
    "Drimli",
  ].join("\n");
const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.6; color:#111;">
    <p>${patientLine}</p>

    <p><strong>Votre rendez-vous avec ${p.providerName} est confirmé.</strong></p>

    <p>
      <strong>Prestation :</strong> ${escapeHtml(p.serviceTitle)}<br/>
      <strong>Date/heure :</strong> ${escapeHtml(new Date(p.startDateTimeIso).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }))}<br/>
    </p>

    <p>
      Le jour de votre rendez-vous, cliquez simplement sur le bouton ci-dessous pour accéder aux informations correspondantes.
    </p>

    <p style="margin: 16px 0;">
      <a href="${joinUrl}"
         style="display:inline-block; padding:12px 16px; background:#111; color:#fff; text-decoration:none; border-radius:12px; font-weight:700;">
        ${escapeHtml(actionLabel)}
      </a>
    </p>

    <p style="font-size: 13px; opacity: 0.75;">
      Lien de secours à copier dans votre navigateur :<br/>
      <a href="${joinUrl}">${p.manageUrl}</a>
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
    throw new Error(error.message);
  }

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
