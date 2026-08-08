import { createClient } from "@supabase/supabase-js";
import styles from "./page.module.css";
import PublicFlowShell from "@/app/components/public/PublicFlowShell";
import ExpandableServiceList, {
  type PublicService,
} from "@/app/components/public/ExpandableServiceList";
import PublicPageViewTracker from "@/app/components/public/PublicPageViewTracker";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

  const { data: googleBusinessProfile } = await supabase
    .from("google_business_profiles")
    .select("google_maps_url, google_rating, google_reviews_count")
    .eq("provider_id", profile.provider_id)
    .eq("google_reviews_enabled", true)
    .maybeSingle();

  const googleRating = Number(googleBusinessProfile?.google_rating);
  const googleReviewsCount = Number(
    googleBusinessProfile?.google_reviews_count
  );
  const showGoogleReviews =
    Boolean(googleBusinessProfile?.google_maps_url) &&
    googleBusinessProfile?.google_rating !== null &&
    googleBusinessProfile?.google_rating !== undefined &&
    googleBusinessProfile?.google_reviews_count !== null &&
    googleBusinessProfile?.google_reviews_count !== undefined &&
    Number.isFinite(googleRating) &&
    Number.isInteger(googleReviewsCount) &&
    googleReviewsCount >= 0;

  return (
    <PublicFlowShell>
      <PublicPageViewTracker slug={slug} />

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

          {showGoogleReviews ? (
            <p className={styles.reassurance}>
              <span className={styles.googleReviewsSummary}>
                <span className={styles.ratingStar}>★</span>
                <strong>
                  {googleRating.toLocaleString("fr-FR", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </strong>
                <span>
                  · {googleReviewsCount.toLocaleString("fr-FR")} avis
                </span>
                <span className={styles.googleAttribution}>Google</span>
              </span>
              {profile.country ? (
                <span className={styles.country}>· {profile.country}</span>
              ) : null}
            </p>
          ) : null}
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
