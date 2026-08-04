"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CalendarDays, FileText } from "lucide-react";
import Button from "@/app/components/ui/Button";
import styles from "./page.module.css";

function VerificationState({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <p className={styles.status}>{children}</p>
    </main>
  );
}

function PaiementSuccesContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const sessionId = sp.get("session_id");

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [titleVisible, setTitleVisible] = useState(false);
  const [titleLeaving, setTitleLeaving] = useState(false);
  const [messageVisible, setMessageVisible] = useState(false);
  const [invoiceVisible, setInvoiceVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [signatureVisible, setSignatureVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorText("");
      setJoinToken(null);

      if (!sessionId) {
        setErrorText("Session Stripe manquante.");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`);
      const json = await res.json().catch(() => null);

      if (cancelled) return;

      if (!res.ok) {
        setErrorText(json?.error || "Erreur récupération session Stripe.");
        setLoading(false);
        return;
      }

      if (json?.payment_status !== "paid") {
        setErrorText("Paiement non confirmé (statut Stripe : " + (json?.payment_status || "unknown") + ").");
        setLoading(false);
        return;
      }

      const apptId = json?.appointment_id ?? null;
      if (apptId) {
        const tRes = await fetch("/api/appointments/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId: apptId }),
        });
        const tJson = await tRes.json().catch(() => null);
        if (tRes.ok && tJson?.join_token) setJoinToken(tJson.join_token);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (loading || errorText) return;

    const timers = [
      window.setTimeout(() => setTitleVisible(true), 520),
      window.setTimeout(() => setTitleLeaving(true), 2820),
      window.setTimeout(() => setMessageVisible(true), 4240),
      window.setTimeout(() => setInvoiceVisible(true), 6240),
      window.setTimeout(() => setCalendarVisible(true), 7040),
      window.setTimeout(() => setSignatureVisible(true), 8740),
    ];

    return () => timers.forEach(window.clearTimeout);
  }, [errorText, loading]);

  function addToCalendar() {
    if (joinToken) {
      window.location.href = `/api/appointments/ics?token=${encodeURIComponent(joinToken)}`;
    }
  }

  if (loading) {
    return <VerificationState>Vérification du paiement…</VerificationState>;
  }

  if (errorText) {
    return (
      <main className={styles.page}>
        <div className={styles.error}>
          <h1>Une erreur est survenue</h1>
          <p>{errorText}</p>
          <Button variant="secondary" onClick={() => router.replace("/")}>
            Revenir à l’accueil
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} aria-labelledby="success-title">
      <div className={styles.copy}>
        <h1
          id="success-title"
          className={`${styles.message} ${titleVisible ? styles.visible : ""} ${
            titleLeaving ? styles.leaving : ""
          }`}
        >
          Merci, votre séance est confirmée.
        </h1>
        <p
          className={`${styles.message} ${messageVisible ? styles.visible : ""}`}
        >
          Le lien de connexion vous sera envoyé par e-mail.
        </p>
      </div>

      <div
        className={`${styles.actions} ${invoiceVisible ? styles.actionsVisible : ""}`}
      >
        <a
          className={`${styles.action} ${styles.progressiveAction} ${
            invoiceVisible ? styles.progressiveActionVisible : ""
          }`}
          href={`/api/invoices/patient/download?session_id=${encodeURIComponent(sessionId ?? "")}`}
        >
          <FileText aria-hidden="true" />
          <span>Télécharger la facture</span>
        </a>

        <button
          type="button"
          className={`${styles.action} ${styles.progressiveAction} ${
            calendarVisible ? styles.progressiveActionVisible : ""
          }`}
          onClick={addToCalendar}
          disabled={!joinToken}
        >
          <CalendarDays aria-hidden="true" />
          <span>Ajouter au calendrier</span>
        </button>
      </div>

      <p
        className={`${styles.signature} ${
          signatureVisible ? styles.signatureVisible : ""
        }`}
      >
        Powered by <strong>drimli</strong>
      </p>
    </main>
  );
}

export default function PaiementSuccesPage() {
  return (
    <Suspense
      fallback={<VerificationState>Vérification du paiement…</VerificationState>}
    >
      <PaiementSuccesContent />
    </Suspense>
  );
}
