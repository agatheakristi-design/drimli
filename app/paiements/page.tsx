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

        if (!cancelled) {
          if (error) {
            setStatus("❌ Erreur chargement profil : " + error.message);
          } else {
            setStripeAccountId(prof?.stripe_account_id ?? null);
          }
          setLoading(false);
        }
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

  const drimpayLabel = stripeAccountId ? "Modifier Drimpay" : "Activer Drimpay";

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
              {stripeAccountId
                ? "DrimPay est déjà activé sur votre compte."
                : "Activez DrimPay pour être payé(e) en ligne."}
            </p>
          </div>

          {status ? <p>{status}</p> : null}

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

          {/* Navigation — toujours visible */}
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
