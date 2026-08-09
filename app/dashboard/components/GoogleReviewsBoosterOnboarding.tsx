"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "paused";

type SubscriptionRow = {
  status: SubscriptionStatus | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

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
};

const ENABLED_STATUSES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
]);

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

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

function taskDescription(subscription: SubscriptionRow | null) {
  if (subscription?.cancel_at_period_end) return "Résiliation programmée.";
  if (subscription?.status === "trialing") return "60 jours offerts actifs.";
  if (subscription?.status === "active") return "Abonnement actif — 9 € par mois.";
  if (subscription?.status === "past_due") return "Paiement à régulariser.";
  if (subscription?.status === "incomplete") return "Activation à terminer.";
  return "60 jours offerts, puis 9 € par mois.";
}

export default function GoogleReviewsBoosterOnboarding({
  onCompletionChange,
}: {
  googleProfileReady: boolean;
  onCompletionChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<GoogleBusiness | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GoogleBusiness[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState("");

  const loadData = useCallback(async () => {
    const [{ data: auth }, { data: sessionData }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
    const accessToken = sessionData.session?.access_token;
    if (!auth.user || !accessToken) {
      setLoading(false);
      return;
    }

    const [profileResult, subscriptionResponse] = await Promise.all([
      supabase
        .from("google_business_profiles")
        .select(
          "google_place_id, google_business_name, google_business_address, google_maps_url, google_rating, google_reviews_count"
        )
        .eq("provider_id", auth.user.id)
        .maybeSingle<StoredGoogleBusiness>(),
      fetch("/api/stripe/subscriptions/status", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }),
    ]);

    const subscriptionResult = (await subscriptionResponse
      .json()
      .catch(() => null)) as {
      subscription?: SubscriptionRow | null;
    } | null;

    if (
      profileResult.error ||
      !subscriptionResponse.ok ||
      !subscriptionResult ||
      !("subscription" in subscriptionResult)
    ) {
      setStatus("Impossible de charger les informations pour le moment.");
    } else {
      setProfile(
        profileResult.data ? storedBusiness(profileResult.data) : null
      );
      setSubscription(subscriptionResult.subscription ?? null);
      onCompletionChange(
        Boolean(
          subscriptionResult.subscription?.status &&
            ENABLED_STATUSES.has(subscriptionResult.subscription.status)
        )
      );
    }
    setLoading(false);
  }, [onCompletionChange]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      setResults([]);
      setQuery("");
      setEditingProfile(false);
      setStatus("Fiche Google enregistrée.");
    } catch {
      setStatus("Impossible d’enregistrer cette fiche pour le moment.");
    } finally {
      setSelecting(null);
    }
  }

  async function authenticatedPost(path: string) {
    const token = await accessToken();
    if (!token) throw new Error("auth");
    return fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function startCheckout() {
    setStartingCheckout(true);
    setStatus("");
    try {
      const response = await authenticatedPost(
        "/api/stripe/subscriptions/checkout"
      );
      const result = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !result?.url) {
        setStatus(result?.error || "Impossible de démarrer l’abonnement.");
        return;
      }
      const checkoutUrl = new URL(result.url);
      if (
        checkoutUrl.protocol !== "https:" ||
        checkoutUrl.hostname !== "checkout.stripe.com"
      ) {
        setStatus("La page de paiement reçue est invalide.");
        return;
      }
      window.location.assign(checkoutUrl.toString());
    } catch (error) {
      setStatus(
        error instanceof Error && error.message === "auth"
          ? "Vous devez être connecté."
          : "Impossible de démarrer l’abonnement pour le moment."
      );
    } finally {
      setStartingCheckout(false);
    }
  }

  async function openBillingPortal() {
    setOpeningPortal(true);
    setStatus("");
    try {
      const response = await authenticatedPost(
        "/api/stripe/subscriptions/portal"
      );
      const result = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !result?.url) {
        setStatus(result?.error || "Gestion du paiement indisponible.");
        return;
      }
      window.location.assign(result.url);
    } catch {
      setStatus("Gestion du paiement indisponible.");
    } finally {
      setOpeningPortal(false);
    }
  }

  async function cancelSubscription() {
    if (
      !window.confirm(
        "Supprimer Booster mes avis Google à la fin de la période en cours ? Votre fiche Google restera enregistrée."
      )
    ) {
      return;
    }

    setCancelling(true);
    setStatus("");
    try {
      const response = await authenticatedPost(
        "/api/stripe/subscriptions/cancel"
      );
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setStatus(result?.error || "Résiliation indisponible.");
        return;
      }
      await loadData();
      setStatus("Résiliation programmée. Votre fiche Google est conservée.");
    } catch {
      setStatus("Résiliation indisponible pour le moment.");
    } finally {
      setCancelling(false);
    }
  }

  const enabled = Boolean(
    subscription?.status && ENABLED_STATUSES.has(subscription.status)
  );
  const showCheckout =
    profile &&
    (!subscription?.status ||
      subscription.status === "canceled" ||
      subscription.status === "incomplete_expired" ||
      subscription.status === "incomplete");
  const endDate = formatDate(
    subscription?.trial_ends_at ?? subscription?.current_period_end ?? null
  );

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
          <strong>Booster mes avis Google</strong>
          <span>{taskDescription(subscription)}</span>
        </span>
        <ChevronRight className={styles.taskArrow} size={18} />
      </button>

      {open ? (
        <div className={styles.inlineEditor}>
          <div className={styles.googleBoosterFlow}>
            <section className={styles.googleBoosterSection}>
              <div className={styles.googleBoosterSectionHeading}>
                <strong>Trouvez votre fiche Google</strong>
                <p className={styles.googleReviewsHelp}>
                  Saisissez le nom ou l&apos;adresse de votre établissement.
                  DRIMLI retrouve automatiquement votre fiche Google.
                </p>
              </div>

              {profile && !editingProfile ? (
                <div className={styles.googleBusinessSelected}>
                  <div>
                    <strong>{profile.businessName}</strong>
                    {profile.address ? <span>{profile.address}</span> : null}
                    <span>
                      {profile.rating === null
                        ? "Note indisponible"
                        : `${profile.rating.toLocaleString("fr-FR", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })} / 5`}
                      {profile.reviewsCount === null
                        ? ""
                        : ` · ${profile.reviewsCount.toLocaleString("fr-FR")} avis`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.googleBoosterTextLink}
                    onClick={() => {
                      setEditingProfile(true);
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
                          setEditingProfile(false);
                          setResults([]);
                          setQuery("");
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
                      <strong>{place.businessName}</strong>
                      {place.address ? <span>{place.address}</span> : null}
                      <span>
                        {place.rating === null
                          ? "Note indisponible"
                          : `${place.rating.toLocaleString("fr-FR", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })} / 5`}
                        {place.reviewsCount === null
                          ? ""
                          : ` · ${place.reviewsCount.toLocaleString("fr-FR")} avis`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {profile ? (
              <section className={styles.googleBoosterSection}>
                {showCheckout ? (
                  <>
                    <div className={styles.googleBoosterSectionHeading}>
                      <strong>Lancez vos 60 jours offerts</strong>
                      <p className={styles.googleReviewsHelp}>
                        0 € aujourd’hui. Puis 9 €/mois. Annulable à tout moment
                        en un clic.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={styles.inlinePrimaryButton}
                      onClick={startCheckout}
                      disabled={loading || startingCheckout}
                    >
                      {startingCheckout
                        ? "Ouverture de Stripe…"
                        : subscription?.status === "incomplete"
                          ? "Terminer l’activation"
                          : "Activer mes 60 jours offerts"}
                    </button>
                  </>
                ) : null}

                {subscription?.status === "trialing" &&
                !subscription.cancel_at_period_end ? (
                  <div className={styles.googleBoosterSubscriptionState}>
                    <strong>60 jours offerts actifs</strong>
                    {endDate ? <span>Essai gratuit jusqu’au {endDate}</span> : null}
                  </div>
                ) : null}
                {subscription?.status === "active" &&
                !subscription.cancel_at_period_end ? (
                  <div className={styles.googleBoosterSubscriptionState}>
                    <strong>Abonnement actif — 9 € par mois</strong>
                  </div>
                ) : null}
                {subscription?.status === "past_due" &&
                !subscription.cancel_at_period_end ? (
                  <div className={styles.googleBoosterSubscriptionState}>
                    <strong>Paiement à régulariser</strong>
                    <span>L’option reste temporairement active.</span>
                  </div>
                ) : null}
                {subscription?.cancel_at_period_end ? (
                  <div className={styles.googleBoosterSubscriptionState}>
                    <strong>Résiliation programmée</strong>
                    {endDate ? <span>Accès maintenu jusqu’au {endDate}</span> : null}
                  </div>
                ) : null}

                {subscription?.status === "past_due" ||
                subscription?.status === "unpaid" ||
                subscription?.status === "paused" ? (
                  <button
                    type="button"
                    className={styles.googleBoosterTextLink}
                    onClick={openBillingPortal}
                    disabled={openingPortal}
                  >
                    {openingPortal ? "Ouverture…" : "Gérer mon paiement"}
                  </button>
                ) : null}

                {enabled && !subscription?.cancel_at_period_end ? (
                  <button
                    type="button"
                    className={styles.googleBoosterRemoveLink}
                    onClick={cancelSubscription}
                    disabled={cancelling}
                  >
                    {cancelling
                      ? "Résiliation…"
                      : "Supprimer Booster mes avis Google"}
                  </button>
                ) : null}
              </section>
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
