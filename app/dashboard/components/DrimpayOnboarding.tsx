"use client";

import {
  Component,
  useCallback,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from "@stripe/connect-js/pure";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import styles from "./dashboard.module.css";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type ErrorBoundaryState = {
  failed: boolean;
};

class StripeOnboardingErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Stripe Connect onboarding failed to render", error, info);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function EmbeddedStripeOnboarding({
  paymentReady,
  onBack,
  onRetry,
}: {
  paymentReady: boolean;
  onBack?: () => void;
  onRetry: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchClientSecret = useCallback(async () => {
    setError("");

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      const message = "Session manquante. Reconnectez-vous puis réessayez.";
      setError(message);
      throw new Error(message);
    }

    const cookieResponse = await fetch("/api/auth/set-cookie", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!cookieResponse.ok) {
      const body = await cookieResponse.json().catch(() => null);
      const message =
        body?.error || `Impossible de préparer la session (${cookieResponse.status}).`;
      setError(message);
      throw new Error(message);
    }

    const sessionResponse = await fetch("/api/drimpay/account-session", {
      method: "POST",
    });
    const session = await sessionResponse.json().catch(() => null);

    if (!sessionResponse.ok || !session?.client_secret) {
      const message =
        session?.error ||
        session?.details ||
        `Impossible de charger Stripe Connect (${sessionResponse.status}).`;
      setError(message);
      throw new Error(message);
    }

    return session.client_secret as string;
  }, []);

  const [connectInstance] = useState<StripeConnectInstance>(() => {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new Error("Clé Stripe manquante : NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    }

    const primaryColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim();

    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret,
      appearance: {
        variables: {
          colorPrimary: primaryColor || "#4F6F52",
        },
      },
      locale: "fr-FR",
    });
  });

  return (
    <div className={styles.paymentOnboardingContent}>
      <p>
        {paymentReady
          ? "Votre compte Stripe est activé. Vous pouvez vérifier ou mettre à jour vos informations de paiement."
          : "Configurez votre compte Stripe sécurisé pour recevoir les paiements de vos clients."}
      </p>

      {loading && !error ? <p>Chargement des paiements…</p> : null}
      {error ? <p role="alert">❌ {error}</p> : null}

      {error ? (
        <div className={styles.inlineEditorActions}>
          <Button
            variant="secondary"
            className={styles.inlineSecondaryButton}
            onClick={() => onBack?.()}
          >
            Fermer
          </Button>
          <Button className={styles.inlinePrimaryButton} onClick={onRetry}>
            Réessayer
          </Button>
        </div>
      ) : null}

      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          onExit={() => onBack?.()}
          onLoaderStart={() => setLoading(false)}
          onLoadError={({ error: loadError }) => {
            setLoading(false);
            setError(
              loadError.message ||
                "Impossible d’afficher la configuration des paiements."
            );
          }}
        />
      </ConnectComponentsProvider>
    </div>
  );
}

export default function DrimpayOnboarding({
  paymentReady = false,
  onBack,
}: {
  paymentReady?: boolean;
  onBack?: () => void;
}) {
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((key) => key + 1), []);

  const fallback = (
    <div className={styles.paymentOnboardingContent}>
      <p role="alert">
        ❌ Impossible d’afficher la configuration des paiements.
      </p>
      <div className={styles.inlineEditorActions}>
        <Button
          variant="secondary"
          className={styles.inlineSecondaryButton}
          onClick={() => onBack?.()}
        >
          Fermer
        </Button>
        <Button className={styles.inlinePrimaryButton} onClick={retry}>
          Réessayer
        </Button>
      </div>
    </div>
  );

  return (
    <StripeOnboardingErrorBoundary key={retryKey} fallback={fallback}>
      <EmbeddedStripeOnboarding
        paymentReady={paymentReady}
        onBack={onBack}
        onRetry={retry}
      />
    </StripeOnboardingErrorBoundary>
  );
}
