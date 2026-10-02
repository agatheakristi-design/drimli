import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetadataRoute } from "next";

const reservedSlugs = new Set([
  "api", "auth", "creer-mot-de-passe", "dashboard", "forgot-password", "login",
  "onboarding", "page", "paiement", "paiements", "privacy", "rendez-vous",
  "reserver", "reset-password", "services", "signup", "terms", "upload-test",
  "_next", "robots.txt", "sitemap.xml", "favicon.ico",
]);

type Profile = {
  id: string;
  provider_id: string | null;
  published: boolean;
  slug: string | null;
  first_name: string | null;
  last_name: string | null;
  profession: string | null;
};
type Service = {
  id: string;
  provider_id: string | null;
  active: boolean;
  title: string | null;
  duration_minutes: number | null;
};
const filled = (value: string | null) => Boolean(value?.trim());

export function hasEligibleSeoProfile(profile: Profile) {
  return profile.published === true && Boolean(profile.provider_id) &&
    Boolean(profile.slug && profile.slug.length <= 120 &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.slug) && !reservedSlugs.has(profile.slug)) &&
    filled(profile.first_name) && filled(profile.last_name) && filled(profile.profession);
}

export function hasEligibleSeoService(service: Service) {
  return service.active === true && Boolean(service.provider_id) && filled(service.title) &&
    typeof service.duration_minutes === "number" && Number.isFinite(service.duration_minutes) &&
    service.duration_minutes > 0;
}

export function isProfessionalSeoEligible(profile: Profile, services: readonly Service[]) {
  return hasEligibleSeoProfile(profile) && services.some((service) =>
    service.provider_id === profile.provider_id && hasEligibleSeoService(service));
}

// Keyset pagination: keep reading until empty, even if Supabase caps a response below 500 rows.
async function readRows<T extends { id: string }>(client: SupabaseClient, table: string, fields: string, flag: string): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = client.from(table).select(fields).eq(flag, true).order("id", { ascending: true }).limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error || !data) throw new Error(`Unable to read ${table} for the professional sitemap`);
    if (data.length === 0) return rows;
    const batch = data as unknown as T[];
    const next = batch[batch.length - 1].id;
    if (!next || (cursor && next <= cursor)) throw new Error("Invalid sitemap pagination cursor");
    rows.push(...batch);
    cursor = next;
  }
}

export async function buildProfessionalSitemap(client: SupabaseClient): Promise<MetadataRoute.Sitemap> {
  const [profiles, services] = await Promise.all([
    readRows<Profile>(client, "profiles", "id,provider_id,published,slug,first_name,last_name,profession", "published"),
    readRows<Service>(client, "products", "id,provider_id,active,title,duration_minutes", "active"),
  ]);
  const providers = new Set(services.filter(hasEligibleSeoService).map((service) => service.provider_id));
  return profiles.filter((profile) => hasEligibleSeoProfile(profile) && providers.has(profile.provider_id))
    .map((profile) => ({ url: `https://www.drimli.io/${profile.slug}` }));
}
