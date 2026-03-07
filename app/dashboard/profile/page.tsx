"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";

type ProfileForm = {
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  country: string;
  siret: string;
  vat_number: string;
  phone: string;
};

type ProfileRow = ProfileForm & {
  provider_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type OnboardingStatus = {
  accountReady: boolean;
};

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isOnboardingMode, setIsOnboardingMode] = useState(true);

  const [form, setForm] = useState<ProfileForm>({
    first_name: "",
    last_name: "",
    address: "",
    city: "",
    country: "",
    siret: "",
    vat_number: "",
    phone: "",
  });

  useEffect(() => {
    (async () => {
      try {
        setStatus("");

        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;

        if (!user) {
          setLoading(false);
          return;
        }

        setUserId(user.id);

        const { data, error } = await supabase
          .from("profiles")
          .select(
            "provider_id, full_name, first_name, last_name, address, city, country, siret, vat_number, phone, avatar_url"
          )
          .eq("provider_id", user.id)
          .maybeSingle<ProfileRow>();

        if (error) {
          setStatus("❌ Erreur chargement profil : " + error.message);
          setLoading(false);
          return;
        }

        if (data) {
          setAvatarUrl(data.avatar_url ?? null);
          setForm({
            first_name: data.first_name ?? "",
            last_name: data.last_name ?? "",
            address: data.address ?? "",
            city: data.city ?? "",
            country: data.country ?? "",
            siret: data.siret ?? "",
            vat_number: data.vat_number ?? "",
            phone: data.phone ?? "",
          });
        }

        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;

        if (token) {
          const r = await fetch("/api/onboarding/status", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });

          if (r.ok) {
            const j = (await r.json()) as OnboardingStatus;
            setIsOnboardingMode(!j.accountReady);
          }
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

      const fullName = `${form.first_name} ${form.last_name}`.trim();

      const { error: saveErr } = await supabase
        .from("profiles")
        .upsert(
          {
            provider_id: userId,
            avatar_url: publicUrl,
            first_name: form.first_name,
            last_name: form.last_name,
            full_name: fullName,
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

    if (!userId) return;
    if (!form.first_name.trim()) return setStatus("Merci de renseigner votre prénom.");
    if (!form.last_name.trim()) return setStatus("Merci de renseigner votre nom.");

    setSaving(true);

    try {
      const fullName = `${form.first_name} ${form.last_name}`.trim();

      const payload = {
        provider_id: userId,
        slug: fullName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
        first_name: form.first_name,
        last_name: form.last_name,
        full_name: fullName,
        address: form.address,
        city: form.city,
        country: form.country,
        siret: form.siret,
        vat_number: form.vat_number,
        phone: form.phone,
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

      if (isOnboardingMode) {
        router.push("/dashboard/services");
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
        {isOnboardingMode ? "Compléter mes informations" : "Mes informations"}
      </h1>

      {isOnboardingMode ? (
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Vous pourrez compléter plus tard.
        </p>
      ) : null}

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
          {uploadingPhoto ? "Upload en cours..." : "Ajoutez votre photo si vous le souhaitez."}
        </p>
      </div>

      {status ? <p style={{ marginTop: 10 }}>{status}</p> : null}

      <section style={{ marginTop: 18, display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Prénom</span>
          <input
            className="input"
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Nom</span>
          <input
            className="input"
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Adresse</span>
          <input
            className="input"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Ville</span>
          <input
            className="input"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Pays</span>
          <input
            className="input"
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Siret</span>
          <input
            className="input"
            value={form.siret}
            onChange={(e) => setForm((f) => ({ ...f, siret: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>TVA intracommunautaire</span>
          <input
            className="input"
            value={form.vat_number}
            onChange={(e) => setForm((f) => ({ ...f, vat_number: e.target.value }))}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Téléphone</span>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </label>

        <Button onClick={saveProfile} disabled={saving} className="w-full">
          {saving ? "Enregistrement…" : isOnboardingMode ? "Continuer" : "Enregistrer les modifications"}
        </Button>
      </section>
    </main>
  );
}
