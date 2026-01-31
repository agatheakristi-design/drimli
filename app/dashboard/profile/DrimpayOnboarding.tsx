"use client";

import { useEffect, useState } from "react";
import { ConnectComponentsProvider, ConnectAccountOnboarding } from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";

export default function DrimpayOnboarding({
  onDone,
  onBack,
}: {
  onDone?: () => void;
  onBack?: () => void;
}) {
  const [connectInstance, setConnectInstance] = useState<any>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError("");
        setConnectInstance(null);

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          setError("Session manquante. Reconnecte-toi puis réessaie.");
          return;
        }

        // 1) Dépose le token en cookie httpOnly côté serveur
        const r1 = await fetch("/api/auth/set-cookie", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!r1.ok) {
          const j = await r1.json().catch(() => null);
          setError(j?.error || `Impossible de préparer la session (${r1.status}).`);
          return;
        }

        // 2) Appelle account-session (il lira le cookie)
        const res = await fetch("/api/drimpay/account-session", { method: "POST" });
        const json = await res.json().catch(() => null);

        if (!res.ok) {
          setError(json?.error || json?.details || `Erreur serveur (${res.status})`);
          return;
        }

        // Cas: pas encore activé → on affiche un message clair + bouton retour
        if (json?.activated === false) {
          setError("Drimpay n'est pas encore activé sur ce compte.");
          return;
        }

        if (!json?.client_secret) {
          setError(json?.error || "Impossible de démarrer l’onboarding Drimpay.");
          return;
        }

        const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!publishableKey) {
          setError("Clé Stripe manquante : NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
          return;
        }

        const instance = await loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret: async () => json.client_secret,
        });

        if (!cancelled) setConnectInstance(instance);
      } catch (e: any) {
        setError(e?.message || "Erreur inattendue pendant l’onboarding.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // ✅ ERREUR : on donne toujours une sortie + retry
  if (error) {
    return (
      <div className="space-y-3">
        <p>❌ {error}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onBack?.()}>
            Revenir
          </Button>
          <Button onClick={() => setRetryKey((k) => k + 1)}>Réessayer</Button>
        </div>
      </div>
    );
  }

  if (!connectInstance) return <p>Chargement de Drimpay…</p>;

  return (
    <div className="mt-3">
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding onExit={() => onDone?.()} />
      </ConnectComponentsProvider>
    </div>
  );
}
