import { Resend, type CreateEmailOptions } from "resend";
import type { CancellationPolicy } from "@/lib/payoutPolicy";

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

// Normalize only confirmation senders; keep the configured, authorized mailbox.
function confirmationFrom() {
  const address = FROM.match(/<([^<>]+)>\s*$/)?.[1] || FROM.trim();
  return `Drimli <${address}>`;
}

function confirmationPreheader(value: string) {
  return `<div aria-hidden="true" style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;">${escapeHtml(value)}${"&#847;&zwnj;&nbsp;".repeat(100)}</div>`;
}

/** Used only by the separately gated monthly worker; payload is persisted before sending. */
export async function sendAccountantMonthlyDocuments(payload: CreateEmailOptions, idempotencyKey: string) {
  return resend.emails.send(payload, { idempotencyKey });
}

export async function getAccountantMonthlyEmail(id: string) {
  return resend.emails.get(id);
}

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

export async function sendAppointmentConfirmationEmail(p: AppointmentEmailPayload & {
  cancellationPolicy?: CancellationPolicy;
  appointmentStatus?: string;
  managementAvailable?: boolean;
}) {
  const subject = `Rendez-vous avec ${p.providerName}`;
  const patientLine = p.patientName?.trim() ? `Bonjour ${p.patientName.trim().split(/\s+/)[0]},` : "Bonjour,";
  const portal = new URL(p.appointmentJoinUrl);
  const localDevelopment = portal.protocol === "http:" && portal.hostname === "localhost";
  if ((portal.protocol !== "https:" && !localDevelopment) || portal.username || portal.password
    || !/^\/rendez-vous\/[A-Za-z0-9_-]+$/.test(portal.pathname) || portal.search || portal.hash) {
    throw new Error("Invalid appointment portal URL");
  }
  const labels = appointmentDateLabels(p.startDateTimeIso, p.endDateTimeIso);
  const preheader = `Votre rendez-vous du ${labels.date} à ${labels.start}`;
  const { clientAppointmentPermissions } = await import("@/lib/clientAppointmentPolicy");
  const permissions = p.managementAvailable && p.appointmentStatus === "confirmed" && p.cancellationPolicy
    ? clientAppointmentPermissions(p.cancellationPolicy, p.startDateTimeIso)
    : { canReschedule: false, canCancel: false };
  const rescheduleUrl = new URL(portal);
  rescheduleUrl.searchParams.set("action", "reschedule");
  const cancelUrl = new URL(portal);
  cancelUrl.searchParams.set("action", "cancel");
  const actions = [
    ...(permissions.canReschedule ? [{ label: "Modifier mon rendez-vous", url: rescheduleUrl.toString() }] : []),
    ...(permissions.canCancel ? [{ label: "Annuler mon RDV", url: cancelUrl.toString() }] : []),
  ];
  const intro = `Votre rendez-vous avec ${p.providerName} est confirmé.`;
  const icon = (name: string) => escapeHtml(new URL(`/email-icons/${name}.png`, portal).toString());
  const text = [
    patientLine, "", intro, "", "Réservation validée", "",
    `Prestation : ${p.serviceTitle}`,
    `Date : ${labels.date}`, `Horaire : ${labels.start} – ${labels.end}`, "",
    "Rejoindre la visio :", portal.toString(),
    ...actions.flatMap((action) => ["", `${action.label} :`, action.url]),
    "", "—", "Drimli",
  ].join("\n");
  const details = [["Prestation", p.serviceTitle],
    ["Date", labels.date], ["Horaire", `${labels.start} – ${labels.end}`]];
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media only screen and (max-width:480px){.email-content{padding:28px 18px!important}.email-label{width:100px!important}.email-action{display:block!important;margin:12px 0!important}.email-divider{display:none!important}}</style></head>
<body style="margin:0;padding:0;background:#ffffff;color:#1d1d1f;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
${confirmationPreheader(preheader)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#ffffff;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;">
<tr><td class="email-content" style="padding:40px 32px;">
<p style="margin:0 0 48px;text-align:center;"><img src="${escapeHtml(new URL("/drimli-logo.png", portal).toString())}" width="152" height="53" alt="Drimli" style="display:inline-block;width:152px;max-width:100%;height:auto;border:0;"></p>
<p style="margin:0 0 10px;font-size:20px;font-weight:700;">${escapeHtml(patientLine)}</p>
<p style="margin:0;font-size:16px;color:#6b6b72;">${escapeHtml(intro)}</p>
<p style="margin:34px 0;text-align:center;color:#16a34a;font-size:23px;font-weight:700;"><span style="display:inline-block;width:30px;height:30px;line-height:30px;margin-right:10px;border:2px solid #16a34a;border-radius:50%;text-align:center;vertical-align:middle;" aria-hidden="true">&#10003;&#xfe0e;</span> Réservation validée</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;font-size:16px;">
${details.map(([label, value]) => `<tr><td class="email-label" width="128" valign="top" style="width:128px;padding:8px 14px 8px 0;color:#6b6b72;">${label}</td><td valign="top" style="padding:8px 0;overflow-wrap:anywhere;word-break:break-word;${label === "Prestation" ? "font-weight:700;" : ""}">${label === "Date" || label === "Horaire" ? `<img src="${icon(label === "Date" ? "calendar" : "clock")}" width="22" height="22" alt="" style="display:inline-block;width:22px;height:22px;margin-right:10px;vertical-align:middle;border:0;">` : ""}${escapeHtml(value)}</td></tr>`).join("")}
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:32px;"><tr><td align="center">
<a href="${escapeHtml(portal.toString())}" target="_blank" rel="noopener noreferrer" style="display:block;max-width:420px;box-sizing:border-box;padding:16px 24px;background:#1d1d1f;color:#ffffff;text-align:center;text-decoration:none;border-radius:10px;font-size:18px;font-weight:700;"><img src="${icon("video")}" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-right:10px;vertical-align:middle;border:0;">Rejoindre la visio <img src="${icon("arrow")}" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-left:10px;vertical-align:middle;border:0;"></a>
</td></tr></table>
${actions.length ? `<p style="margin:24px 0 0;text-align:center;font-size:14px;">${actions.map((action) => `<a class="email-action" href="${escapeHtml(action.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#6b6b72;text-decoration:underline;text-underline-offset:3px;">${action.label}</a>`).join('<span class="email-divider" aria-hidden="true" style="margin:0 16px;color:#6b6b72;">|</span>')}</p>` : ""}
</td></tr></table>
</td></tr></table></body></html>`;
  const { data, error } = await resend.emails.send({ from: confirmationFrom(), to: p.to, subject, text, html }, {
    idempotencyKey: `appointment-confirmation/${p.appointmentId}`,
  });
  if (error) throw new Error(error.message);
  return data;
}

function appointmentDateLabels(startIso: string, endIso: string) {
  return {
    date: new Date(startIso).toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    start: new Date(startIso).toLocaleTimeString("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    }),
    end: new Date(endIso).toLocaleTimeString("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export async function sendAppointmentRescheduledEmail(
  p: AppointmentEmailPayload
) {
  const labels = appointmentDateLabels(p.startDateTimeIso, p.endDateTimeIso);
  const subject = `Votre rendez-vous avec ${p.providerName} a été déplacé`;
  const text = [
    "Bonjour,", "", "Votre rendez-vous a bien été déplacé.", "",
    `Professionnel : ${p.providerName}`,
    `Prestation : ${p.serviceTitle}`,
    `Nouvelle date : ${labels.date}`,
    `Nouvel horaire : ${labels.start} – ${labels.end}`,
    "", "Accéder à votre rendez-vous :", p.appointmentJoinUrl,
    "", "—", "Drimli",
  ].join("\n");
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111;">
    <p>Bonjour,</p><p><strong>Votre rendez-vous a bien été déplacé.</strong></p>
    <p><strong>Professionnel :</strong> ${escapeHtml(p.providerName)}<br/>
    <strong>Prestation :</strong> ${escapeHtml(p.serviceTitle)}<br/>
    <strong>Nouvelle date :</strong> ${escapeHtml(labels.date)}<br/>
    <strong>Nouvel horaire :</strong> ${escapeHtml(labels.start)} – ${escapeHtml(labels.end)}</p>
    <p><a href="${escapeHtml(p.appointmentJoinUrl)}" target="_blank" rel="noreferrer">Accéder à votre rendez-vous</a></p>
    <p style="opacity:.7;">—<br/>Drimli</p></div>`;
  const { data, error } = await resend.emails.send({ from: FROM, to: p.to, subject, text, html }, {
    idempotencyKey: `appointment-rescheduled/${p.appointmentId}/${p.startDateTimeIso}`,
  });
  if (error) throw new Error(error.message || "Resend send failed");
  return data;
}

export async function sendAppointmentCancelledEmail(p: {
  appointmentId: string;
  refundId: string;
  to: string;
  providerName: string;
  serviceTitle: string;
}) {
  const subject = `Votre rendez-vous avec ${p.providerName} est annulé`;
  const text = [
    "Bonjour,", "", "Votre rendez-vous a bien été annulé.",
    "Vous avez été remboursé intégralement.", "",
    `Professionnel : ${p.providerName}`,
    `Prestation : ${p.serviceTitle}`,
    "", "—", "Drimli",
  ].join("\n");
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111;">
    <p>Bonjour,</p><p><strong>Votre rendez-vous a bien été annulé.</strong></p>
    <p>Vous avez été remboursé intégralement.</p>
    <p><strong>Professionnel :</strong> ${escapeHtml(p.providerName)}<br/>
    <strong>Prestation :</strong> ${escapeHtml(p.serviceTitle)}</p>
    <p style="opacity:.7;">—<br/>Drimli</p></div>`;
  const { data, error } = await resend.emails.send({ from: FROM, to: p.to, subject, text, html }, {
    idempotencyKey: `appointment-cancelled/${p.appointmentId}/${p.refundId}`,
  });
  if (error) throw new Error(error.message || "Resend send failed");
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

// Same restrained text/HTML presentation as the existing appointment emails.
export async function sendProfessionalAppointmentEmail(
  p: import("@/lib/professionalAppointmentAlerts").AppointmentAlertPayload,
  eventId: string
) {
  if (p.kind === "confirmed") {
    if (!p.recipient) throw new Error("Missing professional email");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      throw new Error("Invalid appointment identifier");
    }
    const base = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const url = new URL("/dashboard/calendrier", base);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) || url.username || url.password) {
      throw new Error("Invalid application URL");
    }
    url.searchParams.set("appointment", eventId);
    const firstName = p.provider_name.trim().split(/\s+/)[0];
    const greeting = firstName ? `Hello ${firstName},` : "Hello,";
    const intro = "Un nouveau rendez-vous a été confirmé sur votre page Drimli.";
    const subject = `Nouveau rendez-vous • ${p.client_name?.trim() || "Client"}`;
    const preheader = `Hello${firstName ? ` ${firstName}` : ""}, un nouveau rendez-vous a été confirmé sur votre page Drimli.`;
    const icon = (name: string) => escapeHtml(new URL(`/email-icons/${name}.png`, url).toString());
    const labels = appointmentDateLabels(p.start, p.end);
    const details = [["Client", p.client_name?.trim() || "Client"], ["Prestation", p.service_title],
      ["Date", labels.date], ["Horaire", `${labels.start} – ${labels.end}`]];
    const text = [greeting, "", intro, "", "Rendez-vous confirmé", "",
      ...details.map(([label, value]) => `${label} : ${value}`),
      "", "Voir le rendez-vous :", url.toString(), "", "—", "Drimli"].join("\n");
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media only screen and (max-width:480px){.email-content{padding:28px 18px!important}.email-label{width:100px!important}.email-action{display:block!important;margin:12px 0!important}.email-divider{display:none!important}}</style></head>
<body style="margin:0;padding:0;background:#ffffff;color:#1d1d1f;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
${confirmationPreheader(preheader)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#ffffff;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;">
<tr><td class="email-content" style="padding:40px 32px;">
<p style="margin:0 0 48px;text-align:center;"><img src="${escapeHtml(new URL("/drimli-logo.png", url).toString())}" width="152" height="53" alt="Drimli" style="display:inline-block;width:152px;max-width:100%;height:auto;border:0;"></p>
<p style="margin:0 0 10px;font-size:20px;font-weight:700;">${escapeHtml(greeting)}</p>
<p style="margin:0;font-size:16px;color:#6b6b72;">${escapeHtml(intro)}</p>
<p style="margin:34px 0;text-align:center;color:#16a34a;font-size:23px;font-weight:700;"><span style="display:inline-block;width:30px;height:30px;line-height:30px;margin-right:10px;border:2px solid #16a34a;border-radius:50%;text-align:center;vertical-align:middle;" aria-hidden="true">&#10003;&#xfe0e;</span> Rendez-vous confirmé</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;font-size:16px;">
${details.map(([label, value]) => `<tr><td class="email-label" width="128" valign="top" style="width:128px;padding:8px 14px 8px 0;color:#6b6b72;">${label}</td><td valign="top" style="padding:8px 0;overflow-wrap:anywhere;word-break:break-word;${label === "Client" ? "font-weight:700;" : ""}">${label === "Date" || label === "Horaire" ? `<img src="${icon(label === "Date" ? "calendar" : "clock")}" width="22" height="22" alt="" style="display:inline-block;width:22px;height:22px;margin-right:10px;vertical-align:middle;border:0;">` : ""}${escapeHtml(value)}</td></tr>`).join("")}
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:32px;"><tr><td align="center">
<a href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer" style="display:block;max-width:420px;box-sizing:border-box;padding:16px 24px;background:#1d1d1f;color:#ffffff;text-align:center;text-decoration:none;border-radius:10px;font-size:18px;font-weight:700;">Voir le rendez-vous <img src="${icon("arrow")}" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-left:10px;vertical-align:middle;border:0;"></a>
</td></tr></table>
</td></tr></table>
</td></tr></table></body></html>`;
    const { data, error } = await resend.emails.send({ from: confirmationFrom(), to: p.recipient, subject, text, html }, {
      idempotencyKey: `professional-appointment/${p.kind}/${eventId}`,
    });
    if (error) throw new Error("Professional appointment email failed");
    return data;
  }
  const headings = {
    confirmed: "Nouveau rendez-vous confirmé",
    rescheduled: "Rendez-vous replanifié par le client",
    cancelled: "Rendez-vous annulé par le client",
  };
  const slot = (start: string, end: string) => {
    const labels = appointmentDateLabels(start, end);
    return `${labels.date}, ${labels.start} – ${labels.end}`;
  };
  const lines = [
    `Client : ${p.client_name?.trim() || "Client"}`,
    `Prestation : ${p.service_title}`,
    ...(p.kind === "rescheduled" && p.old_start && p.old_end
      ? [`Ancien créneau : ${slot(p.old_start, p.old_end)}`] : []),
    `${p.kind === "rescheduled" ? "Nouveau créneau" : p.kind === "cancelled" ? "Rendez-vous annulé" : "Date et heure"} : ${slot(p.start, p.end)}`,
  ];
  const base = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const url = new URL("/dashboard/calendrier", base);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Invalid application URL");
  }
  if (!p.recipient) throw new Error("Missing professional email");
  const subject = headings[p.kind];
  const greeting = `Bonjour ${p.provider_name},`;
  const text = [greeting, "", subject, "", ...lines, "", "Consulter mes rendez-vous :", url.toString(), "", "—", "Drimli"].join("\n");
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111;">
    <p>${escapeHtml(greeting)}</p><p><strong>${escapeHtml(subject)}</strong></p>
    <p>${lines.map(escapeHtml).join("<br/>")}</p>
    <p><a href="${escapeHtml(url.toString())}" target="_blank" rel="noreferrer">Consulter mes rendez-vous</a></p>
    <p style="opacity:.7;">—<br/>Drimli</p></div>`;
  const { data, error } = await resend.emails.send({ from: FROM, to: p.recipient, subject, text, html }, {
    idempotencyKey: `professional-appointment/${p.kind}/${eventId}`,
  });
  if (error) throw new Error("Professional appointment email failed");
  return data;
}

// Persist this complete payload before delivery so retries use identical content.
export type HelpNotificationEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

export function buildHelpNotificationEmail(p: {
  kind: "request" | "reply";
  recipient: string;
  requestId: string;
  ownerId: string;
  ownerEmail: string;
  subject: string;
  message: string;
  sourceId: string;
}): HelpNotificationEmail {
  const base = new URL(process.env.DRIMLI_HELP_APP_URL || requireEnv("NEXT_PUBLIC_APP_URL"));
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("Invalid application URL");
  }
  const link = new URL("/dashboard?aide=1", base).toString();
  return {
    from: process.env.DRIMLI_HELP_RESEND_FROM || FROM,
    to: p.recipient,
    subject: p.kind === "request" ? "Nouvelle demande d’aide DRIMLI" : "Une réponse est disponible dans votre rubrique Aide",
    text: p.kind === "request"
      ? `Nouvelle demande d’aide\n\nSujet : ${p.subject}\n\n${p.message}\n\nDemande : ${p.requestId}\nUtilisateur : ${p.ownerId}\nE-mail : ${p.ownerEmail}\nÉvénement : ${p.sourceId}\n\nRépondre depuis l’administration Supabase dans help_replies (request_id ci-dessus).`
      : `Bonjour,\n\nUne réponse à votre demande est disponible dans votre rubrique Aide DRIMLI.\n\nConsulter la réponse : ${link}\n\nConnectez-vous avec votre compte habituel.`,
  };
}

export async function sendHelpNotificationEmail(payload: HelpNotificationEmail, notificationId: string) {
  const options = {
    idempotencyKey: `help-notification/${notificationId}`,
    signal: AbortSignal.timeout(10_000),
  };
  const { data, error } = await resend.emails.send(payload, options);
  if (error || !data?.id) throw new Error("Help email not confirmed");
  return data.id;
}
