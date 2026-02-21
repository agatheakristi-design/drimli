"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";

type Status = {
  profileComplete: boolean;
  paymentComplete: boolean;
  servicesComplete: boolean;
  availabilityComplete: boolean;
  doneCount: number;
  total: number;
  accountReady: boolean;
  next: string;
};

function StepPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="rounded-full border border-border px-3 py-1 text-xs">
      {ok ? "✅" : "⏳"} {label}
    </span>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErrorMsg("");

        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;

        if (!token) {
          setErrorMsg("❌ Tu dois être connectée.");
          setLoading(false);
          return;
        }

        const r = await fetch("/api/onboarding/status", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!r.ok) {
          const t = await r.text();
          setErrorMsg("❌ Erreur onboarding : " + t);
          setLoading(false);
          return;
        }

        const j = (await r.json()) as Status;

        if (!cancelled) {
          setStatus(j);
          setLoading(false);

          // Si déjà prêt → dashboard
          if (j.accountReady) router.replace("/dashboard");
        }
      } catch (e: any) {
        if (!cancelled) {
          setErrorMsg("❌ Erreur inattendue : " + (e?.message || "unknown"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

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
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-black">Configurer ton compte</h1>
            <p className="text-muted-foreground">
              Termine ces étapes pour que tes clients puissent réserver.
            </p>
          </div>

          {errorMsg ? <p>{errorMsg}</p> : null}

          {status ? (
            <>
              <div className="flex flex-wrap gap-2">
                <StepPill ok={status.profileComplete} label="Profil" />
                <StepPill ok={status.paymentComplete} label="Paiement" />
                <StepPill ok={status.servicesComplete} label="Services" />
                <StepPill ok={status.availabilityComplete} label="Disponibilités" />
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <p className="font-semibold">
                  {status.doneCount}/{status.total} étapes terminées
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Continue là où tu t’es arrêtée.
                </p>

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                  <Link
                    href={status.next}
                    className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
                  >
                    Continuer
                  </Link>

                  <Link
                    href="/logout"
                    className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition"
                  >
                    Se déconnecter
                  </Link>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Tu pourras modifier ton profil, tes services, ton agenda et tes paiements à tout moment une fois activé(e).
              </p>
            </>
          ) : null}
        </div>
      </Card>
    </Container>
  );
}
