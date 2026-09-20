"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type GoogleStatus = {
  connected: boolean;
  reason:
    | "not_connected"
    | "refresh_token_missing"
    | "calendar_scope_missing"
    | null;
  email: string | null;
};

export default function GoogleMeetOnboarding({
  onCompletionChange,
}: {
  onCompletionChange: (connected: boolean) => void;
}) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        if (!cancelled) {
          setError("Vous devez être connecté.");
          setLoading(false);
        }
        return;
      }

      const response = await fetch("/api/google/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (cancelled) return;

      if (!response.ok) {
        setError("Impossible de vérifier la connexion Google.");
        setLoading(false);
        return;
      }

      const result = (await response.json()) as GoogleStatus;
      setStatus(result);
      onCompletionChange(result.connected);
      setLoading(false);
    }

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [onCompletionChange]);

  async function connectGoogle() {
    setConnecting(true);
    setError("");
    setNotice("");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setError("Vous devez être connecté.");
        return;
      }

      const response = await fetch("/api/google/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();

      if (!response.ok || !result.url) {
        setError(result.error || "Impossible de lancer la connexion Google.");
        return;
      }

      window.location.assign(result.url);
    } catch {
      setError("Impossible de lancer la connexion Google.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectGoogle() {
    if (disconnecting) return;
    setDisconnecting(true);
    setError("");
    setNotice("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("Vous devez être connecté.");
        return;
      }
      const response = await fetch("/api/google/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "Impossible de déconnecter Google.");
        return;
      }
      setStatus({ connected: false, reason: "not_connected", email: null });
      onCompletionChange(false);
      if (result.remoteRevocation === "unconfirmed") {
        setNotice("Connexion supprimée de DRIMLI. La révocation Google n’a pas pu être confirmée ; vous pouvez retirer l’accès dans votre compte Google.");
      }
    } catch {
      setError("Impossible de déconnecter Google. Réessayez.");
    } finally {
      setDisconnecting(false);
    }
  }

  const connected = Boolean(status?.connected);
  const reconnect =
    status?.reason === "calendar_scope_missing" ||
    status?.reason === "refresh_token_missing";
  const label = connected
    ? "Google Meet connecté"
    : reconnect
      ? "Reconnecter Google Calendar"
      : "Connecter Google Meet";
  const description = connected
    ? status?.email || "La visioconférence est opérationnelle."
    : reconnect
      ? "Une nouvelle autorisation Google Calendar est nécessaire."
      : "Ajoutez la visioconférence à vos rendez-vous.";

  return (
    <div
      className={`${styles.taskRow} ${styles.taskRowExpanded} ${
        connected ? styles.taskRowDone : ""
      } ${open ? styles.taskRowExpandedOpen : ""}`}
    >
      <button
        type="button"
        className={styles.taskRowHeader}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={styles.taskIcon}>
          {connected ? <Check size={16} /> : <Plus size={16} />}
        </span>
        <span className={styles.taskCopy}>
          <strong>{loading ? "Vérification de Google Meet…" : label}</strong>
          <span>{error || notice || description}</span>
        </span>
        <ChevronRight className={styles.taskArrow} size={18} />
      </button>

      {open ? (
        <div className={styles.inlineEditor}>
          <div className={styles.inlineEditorFooter}>
            <span className={styles.inlineEditorStatus}>{description}</span>
            {connected ? (
              <button
                type="button"
                className={styles.googleBoosterTextLink}
                onClick={disconnectGoogle}
                disabled={disconnecting}
              >
                {disconnecting ? "Déconnexion…" : "Déconnecter"}
              </button>
            ) : (
            <button
              type="button"
              className={styles.inlinePrimaryButton}
              onClick={connectGoogle}
              disabled={connecting}
            >
              {connecting
                ? "Connexion…"
                : connected
                  ? "Reconnecter"
                  : label}
            </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
