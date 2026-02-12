"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function MediaPage() {
  const [userId, setUserId] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      setUserId(uid);

      if (!uid) {
        setStatus("❌ Tu dois être connectée pour ajouter une photo.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url, logo_url")
        .eq("provider_id", uid)
        .maybeSingle();

      if (error) setStatus("❌ Chargement profil : " + error.message);

      setAvatarUrl(data?.avatar_url ?? null);
      setLogoUrl(data?.logo_url ?? null);

      setLoading(false);
    }

    load();
  }, []);

  async function uploadAndSave(kind: "avatar" | "logo", file: File) {
    if (!userId) {
      setStatus("❌ Tu dois être connectée pour uploader.");
      return;
    }

    setStatus("⏳ Upload en cours...");

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const folder = kind === "avatar" ? "avatars" : "logos";
    const path = `${folder}/${userId}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("drimli-public")
      .upload(path, file, { upsert: true });

    if (upErr) {
      setStatus("❌ Upload : " + upErr.message);
      return;
    }

    const { data: pub } = supabase.storage.from("drimli-public").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const patch =
      kind === "avatar"
        ? { avatar_url: publicUrl, updated_at: new Date().toISOString() }
        : { logo_url: publicUrl, updated_at: new Date().toISOString() };

    const { error: dbErr } = await supabase
      .from("profiles")
      .update(patch)
      .eq("provider_id", userId);

    if (dbErr) {
      setStatus("❌ Sauvegarde : " + dbErr.message);
      return;
    }

    if (kind === "avatar") setAvatarUrl(publicUrl);
    if (kind === "logo") setLogoUrl(publicUrl);

    setStatus("✅ Enregistré !");
  }

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <a
        href="/dashboard/profile"
        style={{
          display: "inline-block",
          marginBottom: 16,
          textDecoration: "none",
          opacity: 0.7,
        }}
      >
        ← Revenir au profil
      </a>

      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Photo & logo</h1>
      <p style={{ marginTop: 10, opacity: 0.85 }}>
        Ajoute ta photo de profil et ton logo (optionnel).
      </p>

      {loading ? (
        <p style={{ marginTop: 18 }}>Chargement…</p>
      ) : (
        <>
          {/* PHOTO */}
          <div
            style={{
              marginTop: 18,
              border: "1px solid #eee",
              borderRadius: 16,
              padding: 18,
              background: "white",
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Photo de profil</h2>

            <input
              style={{ marginTop: 10 }}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAndSave("avatar", f);
              }}
            />

            {avatarUrl && (
              <img
                src={avatarUrl}
                alt="avatar"
                style={{
                  width: 150,
                  height: 150,
                  borderRadius: 999,
                  objectFit: "cover",
                  marginTop: 16,
                  border: "1px solid #eee",
                }}
              />
            )}
          </div>

          {/* LOGO */}
          <div
            style={{
              marginTop: 18,
              border: "1px solid #eee",
              borderRadius: 16,
              padding: 18,
              background: "white",
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Logo (optionnel)</h2>

            <input
              style={{ marginTop: 10 }}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAndSave("logo", f);
              }}
            />

            {logoUrl && (
              <img
                src={logoUrl}
                alt="logo"
                style={{
                  width: 180,
                  height: 180,
                  borderRadius: 20,
                  objectFit: "cover",
                  marginTop: 16,
                  border: "1px solid #eee",
                }}
              />
            )}
          </div>

          {status && <p style={{ marginTop: 14 }}>{status}</p>}
        </>
      )}
    </main>
  );
}
