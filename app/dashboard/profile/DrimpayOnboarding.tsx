"use client";

import { useEffect, useState } from "react";
import { ConnectComponentsProvider, ConnectAccountOnboarding } from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { supabase } from "@/lib/supabaseClient";

export default function DrimpayOnboarding({ onDone }: { onDone?: () => void }) {
  const [connectInstance, setConnectInstance] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError("");

        // ✅ On récupère la session Supabase côté navigateur
        const { data, error: sessErr } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (sessErr || !token) {
          setError("Session manquante : reconnecte-toi puis réessaie.");
          return;
        }

        // ✅ On appelle l’API avec Authorization Bearer (plus fiable qu’un cookie)
        const res = await fetch("/api/drimpay/account-session", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const json = await res.json().catch(() => null);

        if (!res.ok) {
          setError(json?.error || json?.details || `Erreur serveur (${res.status})`);
          return;
        }

        // Si pas activé, on affiche un message clair
        if (json?.activated === false) {
          setError("DrimPay n’est pas encore activé sur ce compte. Clique sur “Activer DrimPay”.");
          return;
        }

        if (!json?.client_secret) {
          setError(json?.error || "Impossible de démarrer DrimPay.");
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
        setError(e?.message || "Erreur inattendue pendant DrimPay.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ marginTop: 8 }}>❌ {error}</p>;
  if (!connectInstance) return <p style={{ marginTop: 8 }}>Chargement…</p>;

  return (
    <div style={{ marginTop: 12 }}>
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding onExit={() => onDone?.()} />
      </ConnectComponentsProvider>
    </div>
  );
}
