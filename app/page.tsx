"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function HomePage() {
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

  // évite le flash si connecté
  if (!checked) return null;

  return (
    <main style={{ padding: 40, textAlign: "center" }}>
      <h1>Everything you need. Nothing to manage.</h1>
      <p>
        The all-in-one platform to manage clients remotely, worldwide.
      </p>
      <p>
        Scheduling, online payments, video sessions, and invoicing are fully connected.
      </p>
      <p>
        Nothing to configure. Everything works together, automatically.
      </p>
      <p>
        Free. No subscription. No commitment.
      </p>
    </main>
  );
}
