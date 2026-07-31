"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import OnboardingForm from "./OnboardingForm";

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

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadOnboarding() {
      try {
        setLoading(true);
        setErrorMsg("");

        const { data, error: sessionError } =
          await supabase.auth.getSession();

        const token = data.session?.access_token;

        if (sessionError || !token) {
          if (!cancelled) {
            setErrorMsg("Tu dois être connecté pour configurer ta page.");
            setLoading(false);
          }
          return;
        }

        const response = await fetch("/api/onboarding/status", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        if (!response.ok) {
          const message = await response.text();

          if (!cancelled) {
            setErrorMsg("Erreur onboarding : " + message);
            setLoading(false);
          }

          return;
        }

        const status = (await response.json()) as Status;

        if (cancelled) return;

        // Redirection temporairement désactivée pendant la refonte de l’onboarding.
        // if (status.accountReady) {
        //   router.replace("/dashboard");
        //   return;
        // }

        setLoading(false);
      } catch (error: unknown) {
        if (cancelled) return;

        const message =
          error instanceof Error ? error.message : "Erreur inconnue";

        setErrorMsg("Erreur inattendue : " + message);
        setLoading(false);
      }
    }

    loadOnboarding();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return <main>Chargement…</main>;
  }

  if (errorMsg) {
    return (
      <main>
        <p>{errorMsg}</p>
      </main>
    );
  }

  return <OnboardingForm />;
}
