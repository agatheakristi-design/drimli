export type AccountantMail = { from: string; to: string; subject: string; text: string; html: string };
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function accountantMonthlyMail(options: { from: string; to: string; period: string; link: string; missing: number }): AccountantMail {
  const month = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${options.period}-01T12:00:00Z`));
  const prefix = /^[aàâeéèêiîoôuûy]/i.test(month) ? "d’" : "de ";
  const lines = ["Bonjour,", "", `Les factures clients et avoirs ${prefix}${month} émis via DRIMLI sont disponibles.`,
    "Le fichier ZIP contient les dossiers Factures et Avoirs.",
    ...(options.missing ? [`${options.missing} PDF sont indisponibles ; le récapitulatif figure dans Documents-manquants.txt.`] : []),
    "", "Télécharger les documents (lien valable 7 jours) :", options.link,
    "", "Si le lien a expiré, demandez au professionnel de le renouveler depuis sa rubrique Factures. Aucun compte DRIMLI n’est nécessaire pour utiliser le lien reçu.", "", "Cordialement,", "DRIMLI"];
  return { from: options.from, to: options.to, subject: `DRIMLI — Vos documents comptables ${prefix}${month}`, text: lines.join("\n"),
    html: lines.map(line => line === options.link ? `<p><a href="${escapeHtml(line)}">Télécharger les documents</a></p>` : `<p>${escapeHtml(line) || "&nbsp;"}</p>`).join("") };
}
