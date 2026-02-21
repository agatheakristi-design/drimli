"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      // Pas connecté → login
      if (!token) {
        router.replace("/login");
        return;
      }

      const r = await fetch("/api/onboarding/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      // Si l’API ne répond pas, on ne bloque pas (évite de casser tout le dashboard)
      if (!r.ok) {
        if (!cancelled) setOk(true);
        return;
      }

      const j = await r.json();

      // Tant que pas prêt → onboarding (sauf si on y est déjà)
      if (!j?.accountReady && pathname !== "/onboarding") {
        router.replace("/onboarding");
        return;
      }

      if (!cancelled) setOk(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (!ok) return <main style={{ padding: 24 }}>Chargement…</main>;

  return <>{children}</>;
}
