"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import styles from "@/app/login/auth.module.css";

const confirmation =
  "Si un compte existe pour cette adresse, un e-mail de réinitialisation a été envoyé.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || loading) return;

    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <main className={styles.authShell}>
      <Card className={styles.authCard}>
        <form className={styles.authContent} onSubmit={submit}>
          <div className={styles.heading}>
            <h1>Mot de passe oublié</h1>
            <p>Indiquez l’adresse e-mail associée à votre compte.</p>
          </div>

          {sent ? (
            <p className={styles.message} role="status">
              {confirmation}
            </p>
          ) : (
            <label className={styles.field}>
              <span>Adresse e-mail</span>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
          )}

          <div className={styles.actions}>
            {!sent ? (
              <Button type="submit" disabled={loading} className={styles.primaryButton}>
                {loading ? "Envoi…" : "Envoyer le lien de réinitialisation"}
              </Button>
            ) : null}
            <Link className={styles.secondaryLink} href="/login">
              Revenir à la connexion
            </Link>
          </div>
        </form>
      </Card>
    </main>
  );
}
