"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import ConfigNav from "@/app/components/ui/ConfigNav";

import DrimpayOnboarding from "@/app/dashboard/profile/DrimpayOnboarding";

export default function PaiementsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);

  // vrai statut Stripe
  const [drimpayReady, setDrimpayReady] = useState<boolean | null>(null);
  const [drimpayInfo, setDrimpayInfo] = useState<string>("");

  // 1) Charger le stripe_account_id du profil
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setStatus("");

        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;

        if (!user) {
          setStatus("❌ Tu dois être connectée pour accéder à cette page.");
          setLoading(false);
          return;
        }

        const { data: prof, error } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("provider_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          setStatus("❌ Erreur chargement profil : " + error.message);
        } else {
          setStripeAccountId(prof?.stripe_account_id ?? null);
        }

        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setStatus("❌ Erreur inattendue : " + (e?.message || "unknown"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Lire l'état Stripe réel (charges/payouts/transfers)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!stripeAccountId) {
        setDrimpayReady(null);
        setDrimpayInfo("");
        return;
      }

      try {
        const res = await fetch(
          `/api/drimpay/status?account_id=${encodeURIComponent(stripeAccountId)}`
        );
        const json = await res.json();

        if (!res.ok) {
          if (!cancelled) {
            setDrimpayReady(false);
            setDrimpayInfo(
              json?.error ? String(json.error) : "Statut Stripe indisponible"
            );
          }
          return;
        }

        const charges = !!json?.charges_enabled;
        const payouts = !!json?.payouts_enabled;
        const transfers = String(json?.transfers ?? "").toLowerCase();
        const transfersOk = transfers === "active";

        const ready = charges && payouts && transfersOk;

        if (!cancelled) {
          setDrimpayReady(ready);
          setDrimpayInfo(
            ready
              ? ""
              : "Activation Stripe incomplète : ajoute les informations demandées."
          );
        }
      } catch {
        if (!cancelled) {
          setDrimpayReady(false);
          setDrimpayInfo("Statut Stripe indisponible");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stripeAccountId]);

  const drimpayLabel = !stripeAccountId
    ? "Activer DrimPay"
    : drimpayReady
    ? "Modifier DrimPay"
    : "Compléter DrimPay";

  if (loading) {
    return (
      <Container>
        <Card>Chargement…</Card>
      </Container>
    );
  }

  return (
    <Container>
      <Card>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-black">Recevoir des paiements</h1>
            <p className="text-muted-foreground">
              {!stripeAccountId
                ? "Activez DrimPay pour être payé(e) en ligne."
                : drimpayReady
                ? "DrimPay est activé sur votre compte."
                : "Activation DrimPay incomplète : cliquez pour compléter."}
            </p>
          </div>

          {status ? <p>{status}</p> : null}
          {drimpayInfo ? (
            <p className="text-sm text-muted-foreground">{drimpayInfo}</p>
          ) : null}

          {!showOnboarding ? (
            <Button onClick={() => setShowOnboarding(true)} className="w-full">
              {drimpayLabel}
            </Button>
          ) : (
            <DrimpayOnboarding
              onDone={() => {
                router.push("/dashboard/services");
              }}
            />
          )}

          <ConfigNav
            items={[
              { label: "Profil", href: "/dashboard/profile" },
              { label: "Services", href: "/dashboard/services" },
              { label: "Dashboard", href: "/dashboard" },
            ]}
          />
        </div>
      </Card>
    </Container>
  );
}
