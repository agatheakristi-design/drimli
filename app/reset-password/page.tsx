"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import styles from "@/app/login/auth.module.css";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

export default function ResetPasswordPage() {
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const recoveryLink = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === "PASSWORD_RECOVERY") setState("ready");
    });

    const timer = window.setTimeout(async () => {
      if (!active) return;
      if (!recoveryLink) {
        setState("invalid");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (active) setState(data.session ? "ready" : "invalid");
    }, 1200);

    return () => {
      active = false;
      window.clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne sont pas identiques.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Ce lien est invalide ou a expiré. Demandez un nouveau lien de réinitialisation.");
      setLoading(false);
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    setState("success");
    setLoading(false);
  }

  return (
    <main className={styles.authShell}>
      <Card className={styles.authCard}>
        <div className={styles.authContent}>
          <div className={styles.heading}>
            <h1>Nouveau mot de passe</h1>
            <p>Choisissez un nouveau mot de passe pour votre compte DRIMLI.</p>
          </div>

          {state === "checking" ? <p className={styles.message}>Vérification du lien…</p> : null}

          {state === "invalid" ? (
            <div className={styles.actions}>
              <p className={`${styles.message} ${styles.error}`} role="alert">
                Ce lien est invalide ou a expiré.
              </p>
              <Link className={styles.secondaryLink} href="/forgot-password">
                Demander un nouveau lien
              </Link>
            </div>
          ) : null}

          {state === "ready" ? (
            <form className={styles.authContent} onSubmit={submit}>
              <label className={styles.field}>
                <span>Nouveau mot de passe</span>
                <input
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Confirmer le mot de passe</span>
                <input
                  className={styles.input}
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              {error ? (
                <p className={`${styles.message} ${styles.error}`} role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={loading} className={styles.primaryButton}>
                {loading ? "Enregistrement…" : "Enregistrer le nouveau mot de passe"}
              </Button>
            </form>
          ) : null}

          {state === "success" ? (
            <div className={styles.actions}>
              <p className={styles.message} role="status">
                Votre mot de passe a été modifié avec succès.
              </p>
              <Button href="/login" className={styles.primaryButton}>
                Revenir à la connexion
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
