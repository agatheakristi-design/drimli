"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabaseClient";

function subscribeToOrigin() {
  return () => undefined;
}

export function usePublicUrl(slug: string | null) {
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => ""
  );

  return slug && origin ? `${origin}/${slug}` : null;
}

export async function copyPublicUrl(publicUrl: string) {
  await navigator.clipboard.writeText(publicUrl);
}

export default function PublicPageLink() {
  const [slug, setSlug] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const publicUrl = usePublicUrl(slug);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;

        if (!uid) {
          if (!cancelled) setStatus("Connecte-toi pour voir ta page publique.");
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("slug")
          .eq("provider_id", uid)
          .maybeSingle();

        if (error) {
          if (!cancelled) setStatus("Erreur: " + error.message);
          return;
        }

        if (!data?.slug) {
          if (!cancelled) setStatus("Ton URL publique sera disponible après avoir renseigné ton profil.");
          return;
        }

        if (!cancelled) {
          setSlug(data.slug);
          setStatus(null);
        }
      } catch {
        if (!cancelled) setStatus("Erreur inattendue.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!publicUrl) return;
    try {
      await copyPublicUrl(publicUrl);
      setStatus("✅ URL copiée !");
      setTimeout(() => setStatus(null), 1500);
    } catch {
      setStatus("❌ Impossible de copier (navigateur).");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
        padding: 12,
        border: "1px solid #eee",
        borderRadius: 14,
        background: "white",
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 700, opacity: 0.85 }}>Ma page publique</div>

      {publicUrl ? (
        <>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              textDecoration: "none",
            }}
          >
            👀 Voir ma page publique
          </a>

          <button
            onClick={copy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            📋 Copier l’URL
          </button>

          <span style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-all" }}>{publicUrl}</span>
        </>
      ) : (
        <span style={{ fontSize: 12, opacity: 0.7 }}>{status ?? "…"}</span>
      )}

      {publicUrl && status && <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>}
    </div>
  );
}
