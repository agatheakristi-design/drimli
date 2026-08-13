"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { CalendarAppointment, RefundedAppointment } from "./types";
import styles from "./calendar.module.css";

type RefundsListProps = {
  onAppointmentSelect: (appointment: CalendarAppointment) => void;
};

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

export default function RefundsList({
  onAppointmentSelect,
}: RefundsListProps) {
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
        <button
          key={refund.appointment.id}
          type="button"
          className={styles.refundRow}
          onClick={() => onAppointmentSelect(refund.appointment)}
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
        </button>
      ))}
    </div>
  );
}
