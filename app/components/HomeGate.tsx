"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function HomeGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      // Pas connecté → on affiche la landing
      if (!token) {
        if (!cancelled) setChecked(true);
        return;
      }

      // Connecté → on vérifie onboarding
      const r = await fetch("/api/onboarding/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      // Si souci, on évite de bloquer → dashboard
      if (!r.ok) {
        router.replace("/dashboard");
        return;
      }

      const j = await r.json();

      if (j?.accountReady) router.replace("/dashboard");
      else router.replace("/onboarding");
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // évite un flash de la landing si connecté
  if (!checked) return null;

  return <>{children}</>;
}
