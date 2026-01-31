"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function safeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function ProfileMediaPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setStatus("");
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setLoading(false);
        setStatus("❌ Tu dois être connectée.");
        return;
      }
      setUserId(userData.user.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url, logo_url")
        .eq("provider_id", userData.user.id)
        .maybeSingle();

      if (error) {
        setStatus("❌ Erreur chargement : " + error.message);
        setLoading(false);
        return;
      }

      setAvatarUrl(data?.avatar_url ?? null);
      setLogoUrl(data?.logo_url ?? null);
      setLoading(false);
    })();
  }, []);

  async function uploadAndSave(kind: "avatar" | "logo", file: File) {
    if (!userId) return;

    setStatus("⏳ Upload en cours...");

    const clean = safeFileName(file.name);
    const ext = clean.split(".").pop() || "jpg";
    const path =
      kind === "avatar"
        ? `avatars/${userId}.${ext}`
        : `logos/${userId}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("drimli-public")
      .upload(path, file, { upsert: true });

    if (upErr) {
      setStatus("❌ Upload : " + upErr.message);
      return;
    }

    const { data } = supabase.storage.from("drimli-public").getPublicUrl(path);
    const publicUrl = data.publicUrl;

    const payload =
      kind === "avatar"
        ? { avatar_url: publicUrl, updated_at: new Date().toISOString() }
        : { logo_url: publicUrl, updated_at: new Date().toISOString() };

    const { error: saveErr } = await supabase
      .from("profiles")
      .update(payload)
      .eq("provider_id", userId);

    if (saveErr) {
      setStatus("❌ Sauvegarde : " + saveErr.message);
      return;
    }

    if (kind === "avatar") setAvatarUrl(publicUrl);
    if (kind === "logo") setLogoUrl(publicUrl);

    setStatus("✅ Enregistré !");
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Photo & logo</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Ajoute ta photo de profil et ton logo (optionnel).
      </p>

      <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
        <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Photo de profil</h2>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAndSave("avatar", f);
            }}
          />
          {avatarUrl && (
            <div style={{ marginTop: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl}
                alt="avatar"
                style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 999 }}
              />
            </div>
          )}
        </section>

        <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Logo (optionnel)</h2>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAndSave("logo", f);
            }}
          />
          {logoUrl && (
            <div style={{ marginTop: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="logo"
                style={{ width: 160, height: 80, objectFit: "contain" }}
              />
            </div>
          )}
        </section>

        {status && <p>{status}</p>}
      </div>
    </main>
  );
}
