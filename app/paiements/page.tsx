"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";

import DrimpayOnboarding from "@/app/dashboard/components/DrimpayOnboarding";

export default function PaiementsPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

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

        if (cancelled) return;
        setLoading(false);
      } catch (error: unknown) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "unknown";
          setStatus("❌ Erreur inattendue : " + message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
          </div>

          {status ? <p>{status}</p> : null}

          <DrimpayOnboarding />
        </div>
      </Card>
    </Container>
  );
}
