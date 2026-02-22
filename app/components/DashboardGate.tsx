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

      if (!token) {
        router.replace("/login");
        return;
      }

      const r = await fetch("/api/onboarding/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!r.ok) {
        if (!cancelled) setOk(true);
        return;
      }

      const j = await r.json();
      const ready = !!j?.accountReady;

      // ✅ Pages autorisées pendant onboarding
      const allowedDuringOnboarding =
        pathname === "/dashboard/profile" ||
        pathname.startsWith("/dashboard/profile/") ||
        pathname === "/dashboard/services" ||
        pathname.startsWith("/dashboard/services/") ||
        pathname === "/dashboard/disponibilites" ||
        pathname.startsWith("/dashboard/disponibilites/") ||
        pathname === "/paiements";

      if (!ready) {
        if (pathname === "/dashboard" || !allowedDuringOnboarding) {
          router.replace("/onboarding");
          return;
        }
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
