import { emptyBusinessCustomer, type BusinessCustomer } from "./bookingCustomer";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export type CompanyResult = { name: string; siren: string; establishmentCount: number; establishments: BusinessCustomer[] };

export function parseCompanyResults(payload: unknown, query: string): CompanyResult[] {
  const results = row(payload).results;
  if (!Array.isArray(results)) throw new Error("Réponse de recherche invalide.");
  return results.map((value) => {
    const company = row(value);
    const siren = text(company.siren);
    const name = text(company.nom_raison_sociale) || text(company.nom_complet);
    const matching = Array.isArray(company.matching_etablissements) ? company.matching_etablissements : [];
    const establishments = new Map<string, BusinessCustomer>();
    for (const item of [company.siege, ...matching]) {
      const establishment = row(item);
      const siret = text(establishment.siret);
      if (!/^\d{14}$/.test(siret) || !siret.startsWith(siren) || establishment.etat_administratif === "F") continue;
      if (/^\d{14}$/.test(query) && siret !== query) continue;
      const street = [establishment.complement_adresse, establishment.numero_voie, establishment.indice_repetition, establishment.type_voie, establishment.libelle_voie].map(text).filter(Boolean).join(" ");
      establishments.set(siret, {
        ...emptyBusinessCustomer, businessName: name, siren, siret,
        address: street || text(establishment.adresse), postalCode: text(establishment.code_postal),
        city: text(establishment.libelle_commune) || text(establishment.libelle_commune_etranger),
        country: establishment.code_pays_etranger || establishment.libelle_pays_etranger ? "" : "FR",
      });
    }
    return { name, siren, establishmentCount: Number(company.nombre_etablissements) || establishments.size, establishments: [...establishments.values()] };
  }).filter((company) => company.name && /^\d{9}$/.test(company.siren));
}

export async function searchCompanies(query: string, page: number, establishmentPage: number, signal: AbortSignal) {
  const compact = query.trim().replace(/\s/g, "");
  const q = /^\d{9}$|^\d{14}$/.test(compact) ? compact : query.trim();
  const params = new URLSearchParams({ q, page: String(page), per_page: "5", minimal: "true", include: "siege,matching_etablissements", limite_matching_etablissements: "10", page_etablissements: String(establishmentPage) });
  const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok) throw new Error("Recherche indisponible. Vous pouvez saisir les coordonnées manuellement.");
  const payload: unknown = await response.json();
  return { companies: parseCompanyResults(payload, q), hasMore: Number(row(payload).total_pages) > page };
}
