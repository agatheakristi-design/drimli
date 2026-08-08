"use client";

import { useEffect, useState } from "react";
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

function subscriptionDescription(subscription: SubscriptionRow | null) {
  if (!subscription?.status) {
    return "60 jours offerts, puis 9 € par mois. Annulable à tout moment.";
  }

  if (subscription.cancel_at_period_end) {
    const endDate = formatDate(
      subscription.trial_ends_at ?? subscription.current_period_end
    );
    return endDate
      ? `Résiliation programmée pour le ${endDate}.`
      : "Résiliation programmée à la fin de la période.";
  }

  if (subscription.status === "trialing") {
    const trialEnd = formatDate(subscription.trial_ends_at);
    return trialEnd
      ? `Essai gratuit actif jusqu’au ${trialEnd}.`
      : "Votre essai gratuit est actif.";
  }
  if (subscription.status === "active") return "Votre abonnement est actif.";
  if (subscription.status === "past_due") {
    return "Un paiement doit être régularisé.";
  }
  if (subscription.status === "incomplete") {
    return "Terminez l’activation de votre abonnement.";
  }
  if (subscription.status === "paused") return "Votre abonnement est en pause.";
  if (subscription.status === "unpaid") {
    return "Votre abonnement est suspendu pour impayé.";
  }
  return "60 jours offerts, puis 9 € par mois. Annulable à tout moment.";
}

export default function GoogleReviewsBoosterOnboarding({
  googleProfileReady,
  onCompletionChange,
}: {
  googleProfileReady: boolean;
  onCompletionChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSubscription() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("professional_subscriptions")
        .select(
          "status, trial_ends_at, current_period_end, cancel_at_period_end"
        )
        .eq("provider_id", auth.user.id)
        .eq("product_key", "google_reviews_booster")
        .maybeSingle<SubscriptionRow>();

      if (cancelled) return;
      if (error) {
        setStatus("Impossible de charger l’état de l’abonnement.");
      } else {
        setSubscription(data ?? null);
        onCompletionChange(
          Boolean(data?.status && ENABLED_STATUSES.has(data.status))
        );
      }
      setLoading(false);
    }

    void loadSubscription();
    return () => {
      cancelled = true;
    };
  }, [onCompletionChange]);

  async function startCheckout() {
    setStartingCheckout(true);
    setStatus("");

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setStatus("Vous devez être connecté.");
        return;
      }

      const response = await fetch("/api/stripe/subscriptions/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
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
    } catch {
      setStatus("Impossible de démarrer l’abonnement pour le moment.");
    } finally {
      setStartingCheckout(false);
    }
  }

  const enabled = Boolean(
    subscription?.status && ENABLED_STATUSES.has(subscription.status)
  );
  const canStartCheckout =
    !loading &&
    !startingCheckout &&
    googleProfileReady &&
    !enabled &&
    subscription?.status !== "unpaid" &&
    subscription?.status !== "paused";

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
          <span>{subscriptionDescription(subscription)}</span>
        </span>
        <ChevronRight className={styles.taskArrow} size={18} />
      </button>

      {open ? (
        <div className={styles.inlineEditor}>
          <div className={styles.googleReviewsForm}>
            <strong>0 € aujourd’hui</strong>
            <p className={styles.googleReviewsHelp}>
              Profitez de 60 jours d’essai gratuit. Votre abonnement passera
              ensuite à 9 € par mois et restera annulable à tout moment.
            </p>

            {!googleProfileReady ? (
              <p className={styles.inlineEditorStatus}>
                Ajoutez d’abord votre fiche dans « Afficher mes avis Google ».
              </p>
            ) : null}

            {!enabled && subscription?.status !== "unpaid" &&
            subscription?.status !== "paused" ? (
              <div className={styles.googleReviewsActions}>
                <button
                  type="button"
                  className={styles.inlinePrimaryButton}
                  onClick={startCheckout}
                  disabled={!canStartCheckout}
                >
                  {startingCheckout
                    ? "Ouverture de Stripe…"
                    : "Activer mes 60 jours offerts"}
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
