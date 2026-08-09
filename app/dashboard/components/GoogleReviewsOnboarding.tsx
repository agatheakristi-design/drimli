"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type GoogleBusiness = {
  placeId: string;
  businessName: string;
  address: string | null;
  mapsUrl: string;
  rating: number | null;
  reviewsCount: number | null;
};

type StoredGoogleBusiness = {
  google_place_id: string;
  google_business_name: string;
  google_business_address: string | null;
  google_maps_url: string;
  google_rating: number | null;
  google_reviews_count: number | null;
  google_reviews_enabled: boolean;
};

function storedBusiness(profile: StoredGoogleBusiness): GoogleBusiness {
  return {
    placeId: profile.google_place_id,
    businessName: profile.google_business_name,
    address: profile.google_business_address,
    mapsUrl: profile.google_maps_url,
    rating: profile.google_rating,
    reviewsCount: profile.google_reviews_count,
  };
}

function BusinessSummary({ business }: { business: GoogleBusiness }) {
  return (
    <div>
      <strong>{business.businessName}</strong>
      {business.address ? <span>{business.address}</span> : null}
      <span>
        {business.rating === null
          ? "Note indisponible"
          : `${business.rating.toLocaleString("fr-FR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })} / 5`}
        {business.reviewsCount === null
          ? ""
          : ` · ${business.reviewsCount.toLocaleString("fr-FR")} avis`}
      </span>
    </div>
  );
}

export default function GoogleReviewsOnboarding({
  open,
  onOpenChange,
  onCompletionChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompletionChange: (enabled: boolean) => void;
}) {
  const [profile, setProfile] = useState<GoogleBusiness | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GoogleBusiness[]>([]);
  const [searching, setSearching] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadStoredProfile() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || cancelled) return;

      const { data, error } = await supabase
        .from("google_business_profiles")
        .select(
          "google_place_id, google_business_name, google_business_address, google_maps_url, google_rating, google_reviews_count, google_reviews_enabled"
        )
        .eq("provider_id", auth.user.id)
        .maybeSingle<StoredGoogleBusiness>();

      if (cancelled) return;
      if (error) {
        setStatus("Impossible de charger votre fiche Google.");
        return;
      }

      const enabled = Boolean(data?.google_reviews_enabled);
      setProfile(data && enabled ? storedBusiness(data) : null);
      onCompletionChange(enabled);
    }

    void loadStoredProfile();
    return () => {
      cancelled = true;
    };
  }, [onCompletionChange]);

  async function accessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setStatus("");
    setResults([]);
    try {
      const token = await accessToken();
      if (!token) {
        setStatus("Vous devez être connecté.");
        return;
      }
      const response = await fetch("/api/google/reviews/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      const result = (await response.json().catch(() => null)) as {
        places?: GoogleBusiness[];
        error?: string;
      } | null;
      if (!response.ok || !result?.places) {
        setStatus(result?.error || "Impossible de rechercher cette fiche.");
        return;
      }
      setResults(result.places);
      if (result.places.length === 0) {
        setStatus("Aucune fiche Google n’a été trouvée.");
      }
    } catch {
      setStatus("La recherche Google est indisponible pour le moment.");
    } finally {
      setSearching(false);
    }
  }

  async function selectBusiness(place: GoogleBusiness) {
    setSelecting(place.placeId);
    setStatus("");
    try {
      const token = await accessToken();
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
        body: JSON.stringify({ placeId: place.placeId }),
      });
      const result = (await response.json().catch(() => null)) as
        | (GoogleBusiness & { error?: never })
        | { error?: string }
        | null;
      if (!response.ok || !result || !("placeId" in result)) {
        setStatus(result?.error || "Impossible d’enregistrer cette fiche.");
        return;
      }
      setProfile(result);
      setEditing(false);
      setQuery("");
      setResults([]);
      setStatus("Vos avis Google sont affichés sur votre page.");
      onCompletionChange(true);
    } catch {
      setStatus("Impossible d’enregistrer cette fiche pour le moment.");
    } finally {
      setSelecting(null);
    }
  }

  const enabled = profile !== null;
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
        onClick={() => onOpenChange(!open)}
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
          <div className={styles.googleBoosterFlow}>
            <div className={styles.googleBoosterSectionHeading}>
              <strong>Trouvez votre fiche Google</strong>
              <p className={styles.googleReviewsHelp}>
                Saisissez le nom ou l&apos;adresse de votre établissement.
                DRIMLI retrouve votre fiche Google.
              </p>
            </div>

            {profile && !editing ? (
              <div className={styles.googleBusinessSelected}>
                <BusinessSummary business={profile} />
                <button
                  type="button"
                  className={styles.googleBoosterTextLink}
                  onClick={() => {
                    setEditing(true);
                    setStatus("");
                  }}
                >
                  Modifier
                </button>
              </div>
            ) : (
              <form className={styles.googleBusinessSearch} onSubmit={search}>
                <label className={styles.inlineField} htmlFor="google-business-query">
                  <span>Nom ou adresse de votre établissement</span>
                  <input
                    id="google-business-query"
                    className={styles.inlineInput}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    autoComplete="organization"
                  />
                </label>
                <div className={styles.googleReviewsActions}>
                  <button
                    type="submit"
                    className={styles.inlinePrimaryButton}
                    disabled={searching || query.trim().length < 2}
                  >
                    {searching ? "Recherche…" : "Rechercher"}
                  </button>
                  {profile ? (
                    <button
                      type="button"
                      className={styles.inlineSecondaryButton}
                      onClick={() => {
                        setEditing(false);
                        setQuery("");
                        setResults([]);
                      }}
                    >
                      Annuler
                    </button>
                  ) : null}
                </div>
              </form>
            )}

            {results.length > 0 ? (
              <div className={styles.googleBusinessResults} aria-live="polite">
                {results.map((place) => (
                  <button
                    type="button"
                    key={place.placeId}
                    className={styles.googleBusinessResult}
                    onClick={() => void selectBusiness(place)}
                    disabled={selecting !== null}
                  >
                    <BusinessSummary business={place} />
                  </button>
                ))}
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
