"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";

type ProfileForm = {
  full_name: string;
  profession: string;
  city: string;
  address: string;
  country: string;
  siret: string;
  description: string;
  contact_whatsapp: string;
};

type ProfileRow = ProfileForm & {
  provider_id: string;
  stripe_account_id: string | null;
  avatar_url?: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [form, setForm] = useState<ProfileForm>({
    full_name: "",
    profession: "",
    city: "",
    address: "",
    country: "",
    siret: "",
    description: "",
    contact_whatsapp: "",
  });

  useEffect(() => {
    (async () => {
      try {
        setStatus("");

        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          setLoading(false);
          return;
        }

        const uid = userData.user.id;
        setUserId(uid);

        const { data, error } = await supabase
          .from("profiles")
          .select(
            "provider_id, full_name, profession, city, address, country, siret, description, contact_whatsapp, stripe_account_id, avatar_url"
          )
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
          setAvatarUrl(data.avatar_url ?? null);
          setForm({
            full_name: data.full_name ?? "",
            profession: data.profession ?? "",
            city: data.city ?? "",
            address: data.address ?? "",
            country: data.country ?? "",
            siret: data.siret ?? "",
            description: data.description ?? "",
            contact_whatsapp: data.contact_whatsapp ?? "",
          });
        }

        setLoading(false);
      } catch (e: any) {
        setLoading(false);
        setStatus("❌ Erreur inattendue : " + (e?.message || "unknown"));
      }
    })();
  }, []);

  async function uploadAvatar(file: File) {
    if (!userId) return;

    setUploadingPhoto(true);
    setStatus("");

    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `avatars/${userId}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("drimli-public")
        .upload(path, file, { upsert: true });

      if (upErr) {
        setStatus("❌ Upload photo : " + upErr.message);
        setUploadingPhoto(false);
        return;
      }

      const { data } = supabase.storage.from("drimli-public").getPublicUrl(path);
      const publicUrl = data.publicUrl;

      const { error: saveErr } = await supabase
        .from("profiles")
        .upsert(
          {
            provider_id: userId,
            avatar_url: publicUrl,
          },
          { onConflict: "provider_id" }
        );

      if (saveErr) {
        setStatus("❌ Enregistrement photo : " + saveErr.message);
        setUploadingPhoto(false);
        return;
      }

      setAvatarUrl(publicUrl);
      setStatus("✅ Photo enregistrée.");
      setUploadingPhoto(false);
    } catch (e: any) {
      setUploadingPhoto(false);
      setStatus("❌ Erreur photo : " + (e?.message || "unknown"));
    }
  }

  async function saveProfile() {
    setStatus("");

    if (
      !form.full_name.trim() ||
      !form.profession.trim() ||
      !form.city.trim() ||
      !form.description.trim() ||
      !form.contact_whatsapp.trim()
    ) {
      setStatus("Merci de compléter tous les champs obligatoires.");
      return;
    }

    if (!userId) return;

    setSaving(true);

    try {
      const payload = {
        provider_id: userId,
        slug: form.full_name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
        full_name: form.full_name,
        profession: form.profession,
        city: form.city,
        address: form.address,
        country: form.country,
        siret: form.siret,
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

      if (!stripeAccountId) {
        router.push("/paiements");
      } else {
        router.push("/dashboard");
      }
    } catch (e: any) {
      setSaving(false);
      setStatus("❌ Erreur inattendue : " + (e?.message || "unknown"));
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Chargement…</p>;

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>
        {hasProfile === true ? "Modifier mon profil" : "Créer mon profil"}
      </h1>

      <div style={{ marginTop: 16, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Ajouter ou modifier ma photo"
          style={{
            width: 96,
            height: 96,
            borderRadius: "999px",
            border: "1px solid #ddd",
            background: "#f6f6f3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Photo de profil"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span style={{ fontSize: 38, lineHeight: 1, opacity: 0.45 }}>👤</span>
          )}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await uploadAvatar(f);
            e.currentTarget.value = "";
          }}
        />

        <p style={{ marginTop: 8, opacity: 0.75, fontSize: 14 }}>
          {uploadingPhoto
            ? "Upload en cours..."
            : "Ajoute ta photo. Tu pourras la modifier plus tard."}
        </p>
      </div>

      <p style={{ marginTop: 8, opacity: 0.85 }}>Ces infos créent ta page publique.</p>

      {status && <p style={{ marginTop: 10 }}>{status}</p>}

      <section style={{ marginTop: 18, display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Nom complet *</span>
          <input
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Profession *</span>
          <input
            value={form.profession}
            onChange={(e) => setForm((f) => ({ ...f, profession: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Ville *</span>
          <input
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Adresse</span>
          <input
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Pays</span>
          <input
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Siret</span>
          <input
            value={form.siret}
            onChange={(e) => setForm((f) => ({ ...f, siret: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Description *</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={4}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Numéro WhatsApp (format international, ex: +33612345678) *</span>
          <input
            value={form.contact_whatsapp}
            onChange={(e) => setForm((f) => ({ ...f, contact_whatsapp: e.target.value }))}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <Button onClick={saveProfile} disabled={saving} className="w-full">
          {saving
            ? "Enregistrement…"
            : hasProfile === true
            ? "Enregistrer les modifications"
            : "Valider mon profil"}
        </Button>
      </section>
    </main>
  );
}
