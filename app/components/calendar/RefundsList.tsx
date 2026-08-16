"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { RefundedAppointment } from "./types";
import styles from "./calendar.module.css";

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export default function RefundsList() {
  const [refunds, setRefunds] = useState<RefundedAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRefunds() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Session expirée.");

        const response = await fetch("/api/dashboard/refunds", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || "Chargement impossible.");
        }

        if (!cancelled) setRefunds(payload?.refunds ?? []);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Chargement impossible."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRefunds();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className={styles.refundsState}>Chargement…</p>;
  }

  if (error) {
    return <p className={styles.refundsState}>{error}</p>;
  }

  if (refunds.length === 0) {
    return <p className={styles.refundsState}>Aucun remboursement.</p>;
  }

  return (
    <div className={styles.refundsList}>
      {refunds.map((refund) => (
        <section
          key={refund.appointment.id}
          className={styles.refundRow}
        >
          <span className={styles.refundRowHeading}>
            {dateLabel(refund.appointment.start_datetime)} — {refund.appointment.clientName}
          </span>
          <span>{refund.appointment.serviceName}</span>
          <span>
            {refund.refundStatus === "total"
              ? `${money(refund.refundedAmount, refund.currency)} remboursés intégralement`
              : `${money(refund.refundedAmount, refund.currency)} remboursés sur ${money(refund.amountPaid, refund.currency)}`}
          </span>
          <div className={styles.refundDocuments}>
            {refund.invoice?.downloadUrl ? (
              <a
                className={styles.refundDocumentLink}
                href={refund.invoice.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Facture
              </a>
            ) : null}
            {refund.creditNotes.map((creditNote, index) =>
              creditNote.downloadUrl ? (
                <span key={creditNote.id} className={styles.refundDocumentItem}>
                  <span className={styles.refundDocumentSeparator}>|</span>
                  <a
                    className={styles.refundDocumentLink}
                    href={creditNote.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {refund.creditNotes.length > 1
                      ? `Avoir ${index + 1}`
                      : "Avoir"}
                  </a>
                </span>
              ) : null
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
