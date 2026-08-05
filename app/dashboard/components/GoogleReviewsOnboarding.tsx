"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type GoogleBusiness = {
  placeId: string;
  businessName: string;
  mapsUrl: string;
  rating: number | null;
  reviewsCount: number | null;
};

type StoredGoogleBusiness = {
  google_place_id: string;
  google_business_name: string;
  google_maps_url: string;
  google_rating: number | null;
  google_reviews_count: number | null;
  google_reviews_enabled: boolean;
};

export default function GoogleReviewsOnboarding({
  onCompletionChange,
}: {
  onCompletionChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mapsUrl, setMapsUrl] = useState("");
  const [preview, setPreview] = useState<GoogleBusiness | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadStoredProfile() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || cancelled) return;

      const { data, error } = await supabase
        .from("google_business_profiles")
        .select(
          "google_place_id, google_business_name, google_maps_url, google_rating, google_reviews_count, google_reviews_enabled"
        )
        .eq("provider_id", auth.user.id)
        .maybeSingle<StoredGoogleBusiness>();

      if (cancelled) return;
      if (error) {
        setStatus("Impossible de charger votre fiche Google.");
        return;
      }

      const isEnabled = Boolean(data?.google_reviews_enabled);
      setEnabled(isEnabled);
      setMapsUrl(data?.google_maps_url ?? "");
      onCompletionChange(isEnabled);
    }

    loadStoredProfile();
    return () => {
      cancelled = true;
    };
  }, [onCompletionChange]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function verifyBusiness() {
    setChecking(true);
    setStatus("");
    setPreview(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setStatus("Vous devez être connecté.");
        return;
      }

      const response = await fetch("/api/google/reviews/resolve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mapsUrl }),
      });
      const result = (await response.json().catch(() => null)) as
        | (GoogleBusiness & { error?: never })
        | { error?: string }
        | null;

      if (!response.ok || !result || !("placeId" in result)) {
        setStatus(result?.error || "Impossible de vérifier cette fiche.");
        return;
      }

      setPreview(result);
    } catch {
      setStatus("Impossible de vérifier cette fiche pour le moment.");
    } finally {
      setChecking(false);
    }
  }

  async function confirmBusiness() {
    setConfirming(true);
    setStatus("");

    try {
      const token = await getAccessToken();
      if (!token) {
        setStatus("Vous devez être connecté.");
        return;
      }

      const response = await fetch("/api/google/reviews/confirm", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        // The server resolves the original URL again and ignores preview values.
        body: JSON.stringify({ mapsUrl }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setStatus(result?.error || "Impossible d’activer cette fiche.");
        return;
      }

      setEnabled(true);
      setPreview(null);
      setStatus("Vos avis Google sont affichés sur votre page.");
      onCompletionChange(true);
    } catch {
      setStatus("Impossible d’activer cette fiche pour le moment.");
    } finally {
      setConfirming(false);
    }
  }

  const description = enabled
    ? "Vos avis Google sont affichés sur votre page."
    : "Ajoutez votre fiche Google pour afficher votre note et vos avis sur votre page DRIMLI.";

  return (
    <div
      className={`${styles.taskRow} ${styles.taskRowExpanded} ${
        enabled ? styles.taskRowDone : ""
      } ${open ? styles.taskRowExpandedOpen : ""}`}
    >
      <button
        type="button"
        className={styles.taskRowHeader}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={styles.taskIcon}>
          {enabled ? <Check size={16} /> : <Plus size={16} />}
        </span>
        <span className={styles.taskCopy}>
          <strong>Afficher mes avis Google</strong>
          <span>{description}</span>
        </span>
        <ChevronRight className={styles.taskArrow} size={18} />
      </button>

      {open ? (
        <div className={styles.inlineEditor}>
          <div className={styles.googleReviewsForm}>
            <label className={styles.inlineField} htmlFor="google-maps-url">
              <span>Lien de votre fiche Google Maps</span>
              <input
                id="google-maps-url"
                className={styles.inlineInput}
                type="url"
                inputMode="url"
                value={mapsUrl}
                onChange={(event) => {
                  setMapsUrl(event.target.value);
                  setPreview(null);
                  setStatus("");
                }}
                placeholder="https://maps.app.goo.gl/…"
                autoComplete="url"
              />
            </label>
            <p className={styles.googleReviewsHelp}>
              Ouvrez votre fiche dans Google Maps, cliquez sur Partager, puis
              collez le lien ici.
            </p>

            <div className={styles.googleReviewsActions}>
              <button
                type="button"
                className={styles.inlinePrimaryButton}
                onClick={verifyBusiness}
                disabled={checking || confirming || !mapsUrl.trim()}
              >
                {checking ? "Vérification…" : "Vérifier ma fiche"}
              </button>
            </div>

            {preview ? (
              <div className={styles.googleReviewsPreview} aria-live="polite">
                <strong>{preview.businessName}</strong>
                <span>
                  {preview.rating === null
                    ? "Note indisponible"
                    : `${preview.rating.toLocaleString("fr-FR", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })} / 5`}
                </span>
                <span>
                  {preview.reviewsCount === null
                    ? "Nombre d’avis indisponible"
                    : `${preview.reviewsCount.toLocaleString("fr-FR")} avis`}
                </span>
                <a href={preview.mapsUrl} target="_blank" rel="noopener noreferrer">
                  Voir la fiche Google Maps
                </a>
                <button
                  type="button"
                  className={styles.inlinePrimaryButton}
                  onClick={confirmBusiness}
                  disabled={confirming}
                >
                  {confirming ? "Activation…" : "Afficher sur ma page"}
                </button>
              </div>
            ) : null}

            {status ? (
              <p className={styles.inlineEditorStatus} role="status">
                {status}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
