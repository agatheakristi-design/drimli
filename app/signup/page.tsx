"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none";

export default function SignupPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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

    if (!firstName.trim()) return setStatus("Merci de renseigner votre prénom.");
    if (!lastName.trim()) return setStatus("Merci de renseigner votre nom.");
    if (!email.trim()) return setStatus("Merci de renseigner votre email.");
    if (password.length < 8) return setStatus("Mot de passe : 8 caractères minimum.");

    setLoading(true);

    try {
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
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: fullName,
        },
        { onConflict: "provider_id" }
      );

      if (profileError) {
        setStatus("Erreur profil : " + profileError.message);
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
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-black">Créer un compte</h1>
            <p className="text-muted-foreground text-lg">
              Ces informations nous permettent de créer et sécuriser votre compte.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Prénom</span>
              <input
                type="text"
                placeholder="Prénom"
                className={fieldClass}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Nom</span>
              <input
                type="text"
                placeholder="Nom"
                className={fieldClass}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </label>
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
              placeholder="Minimum 8 caractères"
              className={fieldClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <Button onClick={submit} disabled={loading} className="w-full h-14 text-lg">
            {loading ? "…" : "Créer mon compte"}
          </Button>

          {status ? <p className="text-sm">{status}</p> : null}
        </div>
      </Card>
    </Container>
  );
}
