import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "provider_id, full_name, profession, city, description, booking_url, contact_phone, contact_whatsapp, contact_email"
    )
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (!profile) {
    return <main style={{ padding: 24 }}>Page introuvable</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>{profile.full_name}</h1>

      {/* BOUTONS */}
      <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
        {profile.booking_url && (
          <a href={profile.booking_url} target="_blank">📅 Réserver</a>
        )}
        {profile.contact_whatsapp && (
          <a href={`https://wa.me/${profile.contact_whatsapp}`} target="_blank">💬 WhatsApp</a>
        )}
        {profile.contact_phone && (
          <a href={`tel:${profile.contact_phone}`}>📞 Appeler</a>
        )}
        {profile.contact_email && (
          <a href={`mailto:${profile.contact_email}`}>✉️ Email</a>
        )}
      </div>
    </main>
  );
}
