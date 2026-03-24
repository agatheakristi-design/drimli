"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialMode = useMemo<"signin" | "signup">(() => {
    return searchParams.get("mode") === "signup" ? "signup" : "signin";
  }, [searchParams]);

  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) router.replace("/");
    })();
  }, [router]);

  async function submit() {
    setStatus("");

    if (mode === "signup") {
      if (!firstName.trim()) return setStatus("Merci de renseigner votre prénom.");
      if (!lastName.trim()) return setStatus("Merci de renseigner votre nom.");
    }

    if (!email.trim()) return setStatus("Merci de renseigner votre email.");
    if (password.length < 8) return setStatus("Mot de passe : 8 caractères minimum.");

    setLoading(true);

    try {
      if (mode === "signup") {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: fullName,
            },
          },
        });

        if (error) {
          setStatus("Erreur : " + error.message);
          setLoading(false);
          return;
        }

        const uid = data.user?.id;
        if (!uid) {
          setStatus("Erreur : compte créé sans identifiant utilisateur.");
          setLoading(false);
          return;
        }

        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            provider_id: uid,
            slug: slugify(fullName),
            full_name: fullName,
          },
          { onConflict: "provider_id" }
        );

        if (profileError) {
          setStatus("Erreur profil : " + profileError.message);
          setLoading(false);
          return;
        }

        router.replace("/dashboard/services");
        return;
      }

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
        <div className="space-y-4">
          <h1 className="text-2xl font-black">
            {mode === "signup" ? "Créer un compte" : "Se connecter"}
          </h1>

          <p className="text-muted-foreground">
            {mode === "signup"
              ? "Ces informations nous permettent de créer et sécuriser votre compte."
              : "Connectez-vous pour gérer votre activité."}
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
            {mode === "signup" ? (
              <>
                <input
                  type="text"
                  placeholder="Prénom"
                  className="input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                />
                <input
                  type="text"
                  placeholder="Nom"
                  className="input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </>
            ) : null}

            <input
              type="email"
              placeholder="Adresse e-mail"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            <input
              type="password"
              placeholder="Mot de passe"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? "…" : mode === "signup" ? "Continuer" : "Se connecter"}
          </Button>

          {status ? <p className="text-sm">{status}</p> : null}
        </div>
      </Card>
    </Container>
  );
}
