"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function GoogleReviewRequestAdminTest() {
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const response = await fetch("/api/admin/google-review-requests/test", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!cancelled && response.ok) setVisible(true);
    }

    void checkAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendTestEmail() {
    setSending(true);
    setMessage("");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session administrateur introuvable.");

      const response = await fetch("/api/admin/google-review-requests/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "L’envoi du mail de test a échoué.");
      }

      setMessage("Mail de test envoyé");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "L’envoi du mail de test a échoué."
      );
    } finally {
      setSending(false);
    }
  }

  if (!visible) return null;

  return (
    <div style={{ marginTop: 18, textAlign: "center" }}>
      <button
        type="button"
        onClick={sendTestEmail}
        disabled={sending}
        style={{
          border: 0,
          borderRadius: 999,
          padding: "11px 18px",
          background: "#111",
          color: "#fff",
          fontWeight: 700,
          cursor: sending ? "wait" : "pointer",
          opacity: sending ? 0.65 : 1,
        }}
      >
        {sending ? "Envoi…" : "Envoyer le mail de test"}
      </button>
      {message && (
        <p role="status" style={{ margin: "10px 0 0", fontSize: 14 }}>
          {message}
        </p>
      )}
    </div>
  );
}
