import type { Metadata } from "next";

export type SeoProfile = {
  provider_id: string;
  slug: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  profession?: string | null;
};

export type SeoService = {
  id: string;
  created_at?: string | null;
  active?: boolean | null;
  title?: string | null;
  duration_minutes?: number | null;
  price_cents?: number | null;
};

export const descriptionTemplates = [
  "Prenez rendez-vous avec {PRENOM} {NOM}, {METIER}. {PRESTATION} de {DUREE} à {PRIX} €, réservation en ligne sur Drimli.",
  "{PRENOM} {NOM}, {METIER} : consultez ses disponibilités et réservez {PRESTATION} de {DUREE} directement en ligne sur Drimli.",
  "Réservez votre rendez-vous avec {PRENOM} {NOM}, {METIER}. {PRESTATION}, durée {DUREE}, tarif {PRIX} €. Réservation sur Drimli.",
  "Découvrez les disponibilités de {PRENOM} {NOM}, {METIER}, et prenez rendez-vous en ligne pour {PRESTATION} sur Drimli.",
  "Besoin d'un rendez-vous avec {PRENOM} {NOM}, {METIER} ? Réservez {PRESTATION} de {DUREE} directement en ligne sur Drimli.",
  "{PRENOM} {NOM} exerce comme {METIER}. Consultez ses créneaux disponibles et réservez {PRESTATION} en ligne sur Drimli.",
  "Prenez rendez-vous en ligne avec {PRENOM} {NOM}, {METIER}. {PRESTATION} : {DUREE}, {PRIX} €. Disponibilités sur Drimli.",
  "Consultez le profil et les disponibilités de {PRENOM} {NOM}, {METIER}. Réservez votre rendez-vous directement sur Drimli.",
  "{PRENOM} {NOM} – {METIER}. Réservez {PRESTATION} de {DUREE} au tarif de {PRIX} € et choisissez votre créneau sur Drimli.",
  "Réservez facilement une séance avec {PRENOM} {NOM}, {METIER}. Consultez ses créneaux disponibles et prenez rendez-vous sur Drimli.",
  "Prenez rendez-vous avec {PRENOM} {NOM}, {METIER}, pour {PRESTATION}. Durée : {DUREE}. Tarif : {PRIX} €. Réservation sur Drimli.",
  "Vous recherchez {PRENOM} {NOM}, {METIER} ? Consultez ses disponibilités et réservez directement votre rendez-vous sur Drimli.",
  "Retrouvez {PRENOM} {NOM}, {METIER}, sur Drimli. Consultez les disponibilités pour {PRESTATION} et réservez votre créneau en ligne.",
  "Rendez-vous avec {PRENOM} {NOM}, {METIER} : choisissez votre créneau pour {PRESTATION} et réservez directement en ligne sur Drimli.",
  "Consultez les créneaux de {PRENOM} {NOM}, {METIER}, et réservez {PRESTATION} de {DUREE} au tarif de {PRIX} € sur Drimli.",
  "{PRENOM} {NOM}, {METIER}, propose {PRESTATION}. Consultez ses disponibilités et prenez rendez-vous simplement en ligne sur Drimli.",
  "Réservez en ligne avec {PRENOM} {NOM}, {METIER}. Retrouvez {PRESTATION}, sa durée, son tarif et les créneaux disponibles sur Drimli.",
  "Prenez rendez-vous avec {PRENOM} {NOM}, {METIER}. Consultez les informations de {PRESTATION} et choisissez votre disponibilité sur Drimli.",
  "Retrouvez les disponibilités de {PRENOM} {NOM}, {METIER}. {PRESTATION} de {DUREE}, au tarif de {PRIX} €. Réservation sur Drimli.",
  "{PRENOM} {NOM} – {METIER}. Consultez les créneaux disponibles pour {PRESTATION} et prenez rendez-vous directement en ligne sur Drimli."
] as const;

const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") ?? "";

// FNV-1a, unsigned 32-bit: stable across requests and runtimes.
export function templateIndex(providerId: string) {
  let hash = 2166136261;
  for (const character of providerId.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0) % descriptionTemplates.length;
}

export function representativeService(services: readonly SeoService[]) {
  const date = (value: string | null | undefined) => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : Infinity;
  };
  return [...services].filter((service) => service.active === true).sort((a, b) => {
    const first = date(a.created_at);
    const second = date(b.created_at);
    return first !== second ? (first < second ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

function professionalIdentity(profile: SeoProfile) {
  const first = clean(profile.first_name);
  const last = clean(profile.last_name);
  const name = first && last ? `${first} ${last}` : clean(profile.full_name) || first || last;
  const profession = clean(profile.profession);
  const url = `https://www.drimli.io/${profile.slug}`;
  return { name, profession, url };
}

export function professionalJsonLd(profile: SeoProfile) {
  const { name, profession, url } = professionalIdentity(profile);
  if (!name) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${url}#profile`,
    url,
    mainEntity: {
      "@type": "Person",
      "@id": `${url}#person`,
      name,
      ...(profession ? { jobTitle: profession } : {}),
      url,
    },
  };
}

export function serializeProfessionalJsonLd(data: NonNullable<ReturnType<typeof professionalJsonLd>>) {
  // Prevent user-controlled text from closing the HTML script element.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function professionalMetadata(profile: SeoProfile, services: readonly SeoService[]): Metadata {
  const { name, profession, url } = professionalIdentity(profile);
  const identity = [name, profession].filter(Boolean).join(", ");
  const heading = [name, profession].filter(Boolean).join(" – ");
  const service = representativeService(services);
  const prestation = clean(service?.title);
  const duration = typeof service?.duration_minutes === "number" && Number.isFinite(service.duration_minutes) && service.duration_minutes > 0
    ? `${service.duration_minutes.toLocaleString("fr-FR")} min` : "";
  const price = typeof service?.price_cents === "number" && Number.isInteger(service.price_cents) && service.price_cents >= 0
    ? (service.price_cents / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "";
  const template = descriptionTemplates[templateIndex(profile.provider_id)];
  // The full historical name is substituted as a unit; it is never split into guessed names.
  const values: Record<string, string> = { IDENTITE: name, METIER: profession, PRESTATION: prestation, DUREE: duration, PRIX: price };
  const normalizedTemplate = template.replaceAll("{PRENOM} {NOM}", "{IDENTITE}");
  const required = [...normalizedTemplate.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  const complete = required.every((key) => values[key] !== "") &&
    (templateIndex(profile.provider_id) !== 16 || Boolean(duration && price));
  let description: string;
  if (complete) {
    description = normalizedTemplate.replace(/\{(\w+)\}/g, (_, key: string) => values[key]);
  } else {
    const intro = identity ? `Prenez rendez-vous en ligne avec ${identity}.` : "Consultez cette page professionnelle sur Drimli.";
    const details = prestation
      ? `${prestation}${duration ? ` de ${duration}` : ""}${price ? ` à ${price} €` : ""}. `
      : "";
    description = `${intro} ${details}Consultez ses disponibilités et réservez votre créneau sur Drimli.`;
  }
  return {
    title: heading ? `${heading} | Drimli` : "Drimli",
    description,
    alternates: { canonical: url },
    openGraph: { title: heading || "Drimli", description, url },
  };
}
