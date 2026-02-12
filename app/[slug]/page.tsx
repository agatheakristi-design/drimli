import { createClient } from "@supabase/supabase-js";

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
  return m + " min";
}

export default async function Page({ params }: { params: any }) {
  const resolvedParams = await Promise.resolve(params);
  const slug = resolvedParams.slug as string;

  // 1) Profil
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("provider_id, full_name, profession, city, description, avatar_url, published")
    .eq("slug", slug)
    .maybeSingle();

  if (error) return <main style={{ padding: 24 }}>Erreur : {error.message}</main>;
  if (!profile) return <main style={{ padding: 24 }}>Page introuvable</main>;
  if (!profile.published) return <main style={{ padding: 24 }}>Profil non publié</main>;

  // 2) Services (products)
  const { data: products } = await supabase
    .from("products")
    .select("id, title, description, duration_minutes, price_cents, active, created_at")
    .eq("provider_id", profile.provider_id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  return (
    <main style={{ padding: 32, maxWidth: 820, margin: "0 auto", fontFamily: "sans-serif" }}>
      {/* HERO */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {profile.avatar_url && (
          <img
            src={profile.avatar_url}
            alt={profile.full_name}
            style={{
              width: 120,
              height: 120,
              borderRadius: 999,
              objectFit: "cover",
              border: "1px solid #eee",
            }}
          />
        )}

        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>{profile.full_name}</h1>

          {profile.profession && (
            <p style={{ margin: "6px 0 0", fontSize: 18, opacity: 0.9 }}>{profile.profession}</p>
          )}

          {profile.city && <p style={{ margin: "4px 0 0", opacity: 0.75 }}>📍 {profile.city}</p>}
        </div>
      </div>

      {/* DESCRIPTION */}
      {profile.description && (
        <div style={{ marginTop: 24, lineHeight: 1.6, fontSize: 16 }}>{profile.description}</div>
      )}

      {/* SERVICES */}
      <div style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Services</h2>

        {(products ?? []).length === 0 ? (
          <p style={{ marginTop: 10, opacity: 0.75 }}>Aucun service disponible pour le moment.</p>
        ) : (
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {(products ?? []).map((p: any) => (
              <div
                key={p.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 16,
                  padding: 16,
                  background: "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{p.title ?? "Service"}</div>

                    {(p.duration_minutes || p.price_cents != null) && (
                      <div style={{ marginTop: 6, opacity: 0.8 }}>
                        {[minutesLabel(p.duration_minutes), euros(p.price_cents)].filter(Boolean).join(" • ")}
                      </div>
                    )}
                  </div>

                  <a
                    href={`/reserver/${p.id}`}
                    style={{
                      alignSelf: "center",
                      padding: "10px 14px",
                      borderRadius: 12,
                      background: "#1f3cff",
                      color: "white",
                      textDecoration: "none",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Réserver
                  </a>
                </div>

                {p.description && (
                  <div style={{ marginTop: 10, lineHeight: 1.5, opacity: 0.95 }}>{p.description}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
