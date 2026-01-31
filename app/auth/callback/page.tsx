"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Connexion en cours…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1) Première lecture session
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          if (!cancelled) setMsg("❌ Erreur de connexion : " + error.message);
          return;
        }

        // 2) Sur lien magique, la session peut arriver avec un léger délai → retry
        if (!data.session) {
          await new Promise((r) => setTimeout(r, 600));
          const { data: retry } = await supabase.auth.getSession();

          if (retry.session) {
            router.replace("/dashboard");
          } else {
            router.replace("/login");
          }
          return;
        }

        // 3) Session OK
        router.replace("/dashboard/profile");
      } catch (e: any) {
        if (!cancelled) setMsg("❌ Erreur inattendue : " + (e?.message || "unknown"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <p>{msg}</p>
    </main>
  );
}