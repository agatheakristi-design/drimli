import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { buildProfessionalSitemap } from "@/lib/professionalSitemap";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  // Let Next.js return a server error rather than a successful, misleading empty sitemap.
  return buildProfessionalSitemap(client);
}
