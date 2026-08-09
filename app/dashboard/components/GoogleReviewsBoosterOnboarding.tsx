"use client";

import { useCallback, useEffect, useState } from "react";
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

function taskDescription(subscription: SubscriptionRow | null) {
  if (subscription?.cancel_at_period_end) return "Résiliation programmée.";
  if (subscription?.status === "trialing") return "60 jours offerts actifs.";
  if (subscription?.status === "active") return "Abonnement actif — 9 € par mois.";
  if (subscription?.status === "past_due") return "Paiement à régulariser.";
  if (subscription?.status === "incomplete") return "Activation à terminer.";
  return "Générez des avis clients après chaque session";
}

export default function GoogleReviewsBoosterOnboarding({
  googleProfileReady,
  onOpenGoogleReviews,
  onCompletionChange,
}: {
  googleProfileReady: boolean;
  onOpenGoogleReviews: () => void;
  onCompletionChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState("");

  const loadSubscription = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setLoading(false);
      return;
    }

    const response = await fetch("/api/stripe/subscriptions/status", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const result = (await response.json().catch(() => null)) as {
      subscription?: SubscriptionRow | null;
    } | null;

    if (!response.ok || !result || !("subscription" in result)) {
      setStatus("Impossible de charger l’état de l’abonnement.");
    } else {
      setSubscription(result.subscription ?? null);
      onCompletionChange(
        Boolean(
          result.subscription?.status &&
            ENABLED_STATUSES.has(result.subscription.status)
        )
      );
    }
    setLoading(false);
  }, [onCompletionChange]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  async function accessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
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
        "Supprimer Booster mes avis Google à la fin de la période en cours ?"
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
      await loadSubscription();
      setStatus("Résiliation programmée.");
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
    googleProfileReady &&
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
        {!open ? (
          <strong className={styles.googleBoosterTrialLabel}>
            60 jours offerts
          </strong>
        ) : null}
        <ChevronRight className={styles.taskArrow} size={18} />
      </button>

      {open ? (
        <div className={styles.inlineEditor}>
          <div className={styles.googleBoosterFlow}>
            {!googleProfileReady ? (
              <div className={styles.googleBoosterDependency}>
                <p>Vous devez afficher vos avis Google pour booster vos avis.</p>
                <button
                  type="button"
                  className={styles.googleBoosterTextLink}
                  onClick={onOpenGoogleReviews}
                >
                  Afficher mes avis Google
                </button>
              </div>
            ) : (
              <section className={styles.googleBoosterSection}>
                {showCheckout ? (
                  <>
                    <div className={styles.googleBoosterSectionHeading}>
                      <strong>Chaque séance. Un nouvel avis.</strong>
                      <p className={styles.googleReviewsHelp}>
                        Lancez vos 60 jours offerts. 0 € aujourd’hui. Dans 2
                        mois 9 €/mois. Annulable à tout moment en un clic.
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
            )}

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
