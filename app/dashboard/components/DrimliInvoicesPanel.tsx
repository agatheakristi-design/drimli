"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type Document = {
  id: string;
  periodMonth: string;
  totalIncludingTax: number;
  currency: string;
  downloadUrl: string | null;
  creditNotes: Array<{ id: string; downloadUrl: string | null }>;
};

function periodLabel(period: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period.slice(0, 10)}T00:00:00Z`));
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(
    cents / 100
  );
}

export default function DrimliInvoicesPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [status, setStatus] = useState("");

  const closePanel = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setStatus("Chargement…");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setStatus("Session expirée.");
        return;
      }
      const response = await fetch("/api/dashboard/drimli-invoices", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | { documents?: Document[]; error?: string }
        | null;
      if (cancelled) return;
      if (!response.ok) {
        setStatus(payload?.error || "Impossible de charger les factures.");
        return;
      }
      setDocuments(payload?.documents || []);
      setStatus("");
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [closePanel, open]);

  if (!open) return null;
  return (
    <div
      className={styles.professionalPanelBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePanel();
      }}
    >
      <section
        className={styles.professionalPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drimli-invoices-title"
      >
        <header className={styles.professionalPanelHeader}>
          <div>
            <h2 id="drimli-invoices-title">Factures Drimli</h2>
            <p>Commissions mensuelles prélevées sur vos transactions.</p>
          </div>
          <button
            type="button"
            className={styles.professionalPanelClose}
            onClick={closePanel}
            aria-label="Fermer le panneau"
            autoFocus
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className={styles.professionalPanelBody}>
          {status ? <p className={styles.drimliInvoicesEmpty}>{status}</p> : null}
          {!status && documents.length === 0 ? (
            <p className={styles.drimliInvoicesEmpty}>
              Vos factures mensuelles Drimli apparaîtront ici.
            </p>
          ) : null}
          <div className={styles.drimliInvoicesList}>
            {documents.map((document) => (
              <article key={document.id} className={styles.drimliInvoiceItem}>
                <strong>{periodLabel(document.periodMonth)}</strong>
                <span>{money(document.totalIncludingTax, document.currency)} TTC</span>
                <div className={styles.drimliInvoiceLinks}>
                  {document.downloadUrl ? (
                    <a href={document.downloadUrl} target="_blank" rel="noreferrer">
                      Facture
                    </a>
                  ) : (
                    <span>Facture en préparation</span>
                  )}
                  {document.creditNotes.map((note, index) =>
                    note.downloadUrl ? (
                      <a key={note.id} href={note.downloadUrl} target="_blank" rel="noreferrer">
                        Avoir{document.creditNotes.length > 1 ? ` ${index + 1}` : ""}
                      </a>
                    ) : (
                      <span key={note.id}>Avoir en préparation</span>
                    )
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
