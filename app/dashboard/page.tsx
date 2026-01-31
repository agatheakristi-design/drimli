"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import LogoutButton from "@/app/components/LogoutButton";

type ProfileRow = {
  provider_id: string;
  full_name: string | null;
  stripe_account_id: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setStatus("");

        const { data, error } = await supabase.auth.getSession();
        const user = data.session?.user;

        if (cancelled) return;

        if (error || !user) {
          setStatus("❌ Tu dois être connectée pour accéder au dashboard.");
          setLoading(false);
          return;
        }

        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("provider_id, full_name, stripe_account_id")
          .eq("provider_id", user.id)
          .maybeSingle<ProfileRow>();

        if (cancelled) return;

        if (profErr) {
          setStatus("❌ Erreur chargement profil : " + profErr.message);
        } else {
          setName(prof?.full_name ?? null);
          setStripeAccountId(prof?.stripe_account_id ?? null);
        }

        setLoading(false);
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

  if (loading) {
    return (
      <Container>
        <Card>Chargement…</Card>
      </Container>
    );
  }

  if (status.startsWith("❌")) {
    return (
      <Container>
        <Card>
          <div className="space-y-3">
            <h1 className="text-2xl font-black">Dashboard</h1>
            <p>{status}</p>
            <Button variant="secondary" onClick={() => router.push("/login")}>
              Aller à la connexion
            </Button>
          </div>
        </Card>
      </Container>
    );
  }

  return (
    <Container>
      <Card>
        <div className="flex justify-end">
          <LogoutButton />
        </div>

        <div className="mt-4 space-y-2">
          <h1 className="text-2xl font-black">Dashboard</h1>
          <p className="text-muted-foreground">
            {name ? `Bienvenue ${name}.` : "Bienvenue."}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3">
          <Button onClick={() => router.push("/dashboard/profile")}>Profil</Button>
          <Button onClick={() => router.push("/paiements")}>
            {stripeAccountId ? "Drimpay (modifier)" : "Drimpay (activer)"}
          </Button>
          <Button onClick={() => router.push("/dashboard/services")}>Services</Button>
          <Button variant="secondary" onClick={() => router.push("/dashboard/rendez-vous")}>
            Rendez-vous
          </Button>
        </div>
      </Card>
    </Container>
  );
}
