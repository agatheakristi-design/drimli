"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) router.replace("/");
    })();
  }, [router]);

  async function submit() {
    setStatus("");

    if (!email.trim()) return setStatus("Merci de renseigner votre email.");
    if (!password.trim()) return setStatus("Merci de renseigner votre mot de passe.");

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setStatus("Erreur : " + error.message);
        setLoading(false);
        return;
      }

      router.replace("/");
    } catch (e: any) {
      setStatus("Erreur inattendue : " + (e?.message || "unknown"));
      setLoading(false);
    }
  }

  return (
    <Container>
      <Card>
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-black">Se connecter</h1>
            <p className="text-muted-foreground text-lg">
              Connectez-vous pour gérer votre activité.
            </p>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Adresse e-mail</span>
            <input
              type="email"
              placeholder="Adresse e-mail"
              className={fieldClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Mot de passe</span>
            <input
              type="password"
              placeholder="Votre mot de passe"
              className={fieldClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          <Button onClick={submit} disabled={loading} className="w-full h-14 text-lg">
            {loading ? "…" : "Se connecter"}
          </Button>

          {status ? <p className="text-sm">{status}</p> : null}
        </div>
      </Card>
    </Container>
  );
}
