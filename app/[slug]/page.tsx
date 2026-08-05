import { createClient } from "@supabase/supabase-js";
import styles from "./page.module.css";
import PublicFlowShell from "@/app/components/public/PublicFlowShell";
import ExpandableServiceList, {
  type PublicService,
} from "@/app/components/public/ExpandableServiceList";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const PROVISIONAL_REVIEWS_PRESENTATION = {
  rating: "4,9",
  countLabel: "128 avis",
} as const;

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }> | { slug: string };
}) {
  const resolvedParams = await Promise.resolve(params);
  const slug = resolvedParams.slug as string;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "provider_id, full_name, profession, country, description, avatar_url, published"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return (
      <PublicFlowShell>
        <p className={styles.state}>Impossible de charger cette page.</p>
      </PublicFlowShell>
    );
  }

  if (!profile) {
    return (
      <PublicFlowShell>
        <p className={styles.state}>Page introuvable</p>
      </PublicFlowShell>
    );
  }

  if (!profile.published) {
    return (
      <PublicFlowShell>
        <p className={styles.state}>Profil non publié</p>
      </PublicFlowShell>
    );
  }

  const { data: products } = await supabase
    .from("products")
    .select(
      "id, title, description, duration_minutes, price_cents, active, created_at"
    )
    .eq("provider_id", profile.provider_id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  return (
    <PublicFlowShell>
      <section className={styles.hero}>
        {profile.avatar_url && (
          <img
            src={profile.avatar_url}
            alt={profile.full_name}
            className={styles.avatar}
          />
        )}

        <div className={styles.heroContent}>
          <h1>{profile.full_name}</h1>

          {profile.profession && (
            <p className={styles.profession}>{profile.profession}</p>
          )}

          {profile.description && (
            <p className={styles.description}>{profile.description}</p>
          )}

          <p className={styles.reassurance}>
            <span className={styles.ratingStar}>★</span>
            <strong>{PROVISIONAL_REVIEWS_PRESENTATION.rating}</strong>
            <span>· {PROVISIONAL_REVIEWS_PRESENTATION.countLabel}</span>
            <span className={styles.country}>{profile.country || "France"}</span>
          </p>
        </div>
      </section>

      <section className={styles.services}>
        <div className={styles.sectionHeading}>
          <h2>Sélectionner une prestation</h2>
        </div>

        {(products ?? []).length === 0 ? (
          <p className={styles.empty}>
            Aucune prestation disponible pour le moment.
          </p>
        ) : (
          <ExpandableServiceList
            providerId={profile.provider_id}
            services={(products ?? []) as PublicService[]}
          />
        )}
      </section>
    </PublicFlowShell>
  );
}
