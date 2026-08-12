"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";

export default function DrimpayOnboarding({
  paymentReady = false,
  onBack,
}: {
  paymentReady?: boolean;
  onBack?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openStripeOnboarding() {
    setLoading(true);
    setError("");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session manquante. Reconnectez-vous puis réessayez.");

      const activationResponse = await fetch("/api/drimpay/activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const activation = await activationResponse.json().catch(() => null);
      if (!activationResponse.ok) {
        throw new Error(activation?.details || activation?.error || "Impossible de préparer Stripe Connect.");
      }

      const linkResponse = await fetch("/api/drimpay/onboarding-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const link = await linkResponse.json().catch(() => null);
      if (!linkResponse.ok || !link?.url) {
        throw new Error(link?.error || "Impossible d’ouvrir la configuration Stripe.");
      }

      window.location.assign(link.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’ouvrir Stripe Connect.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p>
        {paymentReady
          ? "Votre compte Stripe est activé. Vous pouvez vérifier ou mettre à jour vos informations de paiement."
          : "Configurez votre compte Stripe sécurisé pour recevoir les paiements de vos clients."}
      </p>

      {error ? <p role="alert">❌ {error}</p> : null}

      <div className="flex gap-2">
        <Button variant="secondary" disabled={loading} onClick={() => onBack?.()}>
          Fermer
        </Button>
        <Button disabled={loading} onClick={openStripeOnboarding}>
          {loading ? "Ouverture de Stripe…" : "Configurer mes paiements"}
        </Button>
      </div>
    </div>
  );
}
