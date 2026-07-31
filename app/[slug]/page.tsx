import { createClient } from "@supabase/supabase-js";
import styles from "./page.module.css";
import Button from "@/app/components/ui/Button";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function euros(priceCents?: number | null) {
  if (priceCents == null) return null;
  return (priceCents / 100).toFixed(0) + " €";
}

function minutesLabel(m?: number | null) {
  if (!m) return null;
  return `${m} min`;
}

export default async function Page({ params }: { params: any }) {
  const resolvedParams = await Promise.resolve(params);
  const slug = resolvedParams.slug as string;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "provider_id, full_name, profession, city, description, avatar_url, published"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return <main className={styles.page}>Erreur : {error.message}</main>;
  }

  if (!profile) {
    return <main className={styles.page}>Page introuvable</main>;
  }

  if (!profile.published) {
    return <main className={styles.page}>Profil non publié</main>;
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
    <main className={styles.page}>
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

          {profile.city && (
            <p className={styles.city}>📍 {profile.city}</p>
          )}

          {profile.description && (
            <p className={styles.description}>{profile.description}</p>
          )}
        </div>
      </section>

      <section className={styles.services}>
        <h2>Prestations</h2>

        {(products ?? []).length === 0 ? (
          <p className={styles.empty}>
            Aucune prestation disponible pour le moment.
          </p>
        ) : (
          <div className={styles.list}>
            {(products ?? []).map((p: any) => (
              <article key={p.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3>{p.title ?? "Prestation"}</h3>

                    {(p.duration_minutes || p.price_cents != null) && (
                      <div className={styles.meta}>
                        {[minutesLabel(p.duration_minutes), euros(p.price_cents)]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    )}
                  </div>

                  <Button href={`/reserver/${p.id}`}>
                    Réserver
                  </Button>
                </div>

                {p.description && (
                  <p className={styles.cardDescription}>
                    {p.description}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
