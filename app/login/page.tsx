"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) router.replace("/dashboard/profile");
    })();
  }, [router]);

  async function submit() {
    setStatus("");

    if (!email.trim()) return setStatus("Merci de renseigner votre email.");
    if (password.length < 8) return setStatus("Mot de passe : 8 caractères minimum.");

    setLoading(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `/auth/callback?next=/dashboard/profile` } });

        if (error) {
          setStatus("Erreur : " + error.message);
          setLoading(false);
          return;
        }

        // Si confirm email est activé, pas de session => ne pas rediriger
        if (!data.session) {
          setStatus(
            "Compte créé ✅ Vérifiez vos emails pour confirmer votre compte, puis revenez ici pour vous connecter."
          );
          setMode("signin");
          setLoading(false);
          return;
        }

        router.replace("/dashboard/profile");
        return;
      }

      // signin
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus("Erreur : " + error.message);
        setLoading(false);
        return;
      }

      router.replace("/dashboard/profile");
    } catch (e: any) {
      setStatus("Erreur inattendue : " + (e?.message || "unknown"));
      setLoading(false);
    }
  }

  return (
    <Container>
      <Card>
        <div className="space-y-4">
          <h1 className="text-2xl font-black">Espace professionnel</h1>
          <p className="text-muted-foreground">
            Connectez-vous pour gérer votre profil et vos rendez-vous.
          </p>

          <div className="flex gap-2">
            <Button
              variant={mode === "signin" ? "primary" : "secondary"}
              onClick={() => setMode("signin")}
              className="flex-1"
            >
              Se connecter
            </Button>
            <Button
              variant={mode === "signup" ? "primary" : "secondary"}
              onClick={() => setMode("signup")}
              className="flex-1"
            >
              Créer un compte
            </Button>
          </div>

          <div className="space-y-2">
            <input
              type="email"
              placeholder="Email"
              className="w-full rounded-xl border border-border bg-background px-4 py-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Mot de passe"
              className="w-full rounded-xl border border-border bg-background px-4 py-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? "…" : mode === "signup" ? "Créer mon compte" : "Se connecter"}
          </Button>

          {status ? <p className="text-sm">{status}</p> : null}
        </div>
      </Card>
    </Container>
  );
}
