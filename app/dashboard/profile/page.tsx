"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import LogoutButton from "@/app/components/LogoutButton";

type ProfileForm = {
  full_name: string;
  profession: string;
  city: string;
  description: string;
  contact_whatsapp: string;
};

type ProfileRow = ProfileForm & {
  provider_id: string;
  stripe_account_id: string | null;
};

function isProfileComplete(form: { full_name: string; profession: string; city: string; description: string; contact_whatsapp: string }) {
  return !!(
    form.full_name?.trim() &&
    form.profession?.trim() &&
    form.city?.trim() &&
    form.description?.trim() &&
    form.contact_whatsapp?.trim()
  );
}

export default function ProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  const [form, setForm] = useState<ProfileForm>({
    full_name: "",
    profession: "",
    city: "",
    description: "",
    contact_whatsapp: "",
  });

  useEffect(() => {
    (async () => {
      try {
        setStatus("");

        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData.user) {
          setLoading(false);
          setStatus("❌ Tu dois être connectée pour accéder à cette page.");
          return;
        }

        const uid = userData.user.id;
        setUserId(uid);

        const { data, error } = await supabase
          .from("profiles")
          .select("provider_id, full_name, profession, city, description, contact_whatsapp, stripe_account_id")
          .eq("provider_id", uid)
          .maybeSingle<ProfileRow>();

        if (error) {
          setStatus("❌ Erreur chargement profil : " + error.message);
          setLoading(false);
          return;
        }

        setHasProfile(!!data);

        if (data) {
          setStripeAccountId(data.stripe_account_id ?? null);
          setForm({
            full_name: data.full_name ?? "",
            profession: data.profession ?? "",
            city: data.city ?? "",
            description: data.description ?? "",
            contact_whatsapp: (data as any).contact_whatsapp ?? "",
          });
        }

        setLoading(false);
      } catch (e: any) {
        setLoading(false);
        setStatus("❌ Erreur inattendue : " + (e?.message || "unknown"));
      }
    })();
  }, []);

  async function saveProfile() {
    setStatus("");

    // ✅ Profil obligatoire (MVP)
    if (!form.full_name.trim() || !form.profession.trim() || !form.city.trim() || !form.description.trim() || !(form as any).contact_whatsapp?.trim?.()) {
      setStatus("Merci de compléter tous les champs de votre profil.");
      return;
    }

    if (!userId) {
      setStatus("❌ Tu dois être connectée pour enregistrer.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        provider_id: userId,
        full_name: form.full_name,
        profession: form.profession,
        city: form.city,
        description: form.description,
        contact_whatsapp: form.contact_whatsapp,
      };

      const { error } = await supabase.from("profiles").upsert(payload, {
        onConflict: "provider_id",
      });

      if (error) {
        setStatus("❌ Erreur enregistrement : " + error.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      setStatus("✅ Profil enregistré.");
      // On ne force DrimPay que si le compte Stripe n’est pas encore lié
      if (!stripeAccountId) {
        router.push("/paiements");
      }

    } catch (e: any) {
      setSaving(false);
      setStatus("❌ Erreur inattendue : " + (e?.message || "unknown"));
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Chargement…</p>;

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }} autoComplete="off">
<h1 style={{ fontSize: 24, fontWeight: 800 }}>Créer mon profil</h1>
<p style={{ marginTop: 8, opacity: 0.85 }}>Ces infos créent votre page publique.</p>

      {status && <p style={{ marginTop: 10 }}>{status}</p>}

      <section style={{ marginTop: 18, display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Nom complet</span>
          <input
            autoComplete="off"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Profession</span>
          <input
            autoComplete="off"
            value={form.profession}
            onChange={(e) => setForm((f) => ({ ...f, profession: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Ville</span>
          <input
            autoComplete="off"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Description</span>
          <textarea
            autoComplete="off"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={4}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Numéro WhatsApp (format international, ex: +33612345678)</span>
          <input
            autoComplete="off"
            value={form.contact_whatsapp}
            onChange={(e) => setForm((f) => ({ ...f, contact_whatsapp: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <Button onClick={saveProfile} disabled={saving} className="w-full">
          {saving ? "Enregistrement…" : hasProfile === true ? "Enregistrer les modifications" : "Valider mon profil"}
        </Button>

        {hasProfile === true ? (
          <div className="mt-4 grid gap-2">
            <Button variant="secondary" className="w-full" onClick={() => router.push("/paiements")}>
              DrimPay (modifier)
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => router.push("/dashboard/services")}>
              Services (modifier)
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => router.push("/dashboard")}>
              Retourner au dashboard
            </Button>
          </div>
        ) : null}

        {hasProfile === false ? (
          <div style={{ fontSize: 14, opacity: 0.75 }}>Étape suivante : activer DrimPay.</div>
        ) : null}
    
      </section>
    </main>
  );
}
