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
  next: string | null;
};

function StepLine({
  ok,
  title,
  desc,
}: {
  ok: boolean;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="font-semibold">
        {ok ? "✅" : "•"} {title}
      </p>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
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

        const { data: sess, error: sessErr } = await supabase.auth.getSession();
        const token = sess.session?.access_token;

        if (sessErr || !token) {
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

  // ✅ La prochaine étape non remplie (sans choix)
  const next =
    !status?.profileComplete
      ? "/dashboard/profile"
      : !status?.paymentComplete
      ? "/paiements"
      : !status?.servicesComplete
      ? "/dashboard/services"
      : !status?.availabilityComplete
      ? "/dashboard/disponibilites"
      : "/dashboard";

  return (
    <Container>
      <Card>
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-black">Configurer ton compte</h1>
            <p className="text-muted-foreground">
              Suis ces étapes dans l’ordre pour activer ta page publique.
            </p>
          </div>

          {errorMsg ? <p>{errorMsg}</p> : null}

          {status ? (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="font-semibold">
                  {status.doneCount}/{status.total} étapes terminées
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  On te guide automatiquement vers la prochaine étape à compléter.
                </p>

                <div className="mt-4">
                  <Link
                    href={next}
                    className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
                  >
                    Continuer
                  </Link>
                </div>
              </div>

              <div className="space-y-3">
                <StepLine
                  ok={status.profileComplete}
                  title="Profil"
                  desc="Infos publiques (nom, profession, ville, description)."
                />
                <StepLine
                  ok={status.paymentComplete}
                  title="Paiement"
                  desc="Active DrimPay pour recevoir des paiements."
                />
                <StepLine
                  ok={status.servicesComplete}
                  title="Services"
                  desc="Crée au moins un service réservable."
                />
                <StepLine
                  ok={status.availabilityComplete}
                  title="Disponibilités"
                  desc="Définis tes créneaux et absences."
                />
              </div>
            </>
          ) : null}
        </div>
      </Card>
    </Container>
  );
}
