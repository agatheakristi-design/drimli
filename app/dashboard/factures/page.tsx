"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import styles from "./factures.module.css";
import DocumentsExport from "./DocumentsExport";
import AccountantMonthlyLinks from "./AccountantMonthlyLinks";

type Cursor = { invoiceOffset: number; noteOffset: number };
type DocumentRow = {
  id: string; type: "invoice" | "credit_note"; number: string; issuedAt: string;
  client: string; amount: number; currency: string; downloadable: boolean;
  refunds: { amount: number; currency: string; status: string }[];
};
const first: Cursor = { invoiceOffset: 0, noteOffset: 0 };
const money = (amount: number, currency: string) => new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount / 100);
const date = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short" }).format(new Date(value));
function refundLabel(status: string) {
  if (status === "succeeded") return "Remboursement réussi";
  if (status === "pending") return "Remboursement en attente";
  if (status === "failed") return "Remboursement échoué";
  if (status === "canceled") return "Remboursement annulé";
  if (status === "requires_action") return "Remboursement : action requise";
  return `Remboursement : ${status}`;
}
async function accessToken() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Session expirée.");
  return data.session.access_token;
}

export default function FacturesPage() {
  const [filters, setFilters] = useState({ search: "", type: "all", from: "", to: "" });
  const [history, setHistory] = useState<Cursor[]>([first]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const cursor = history[history.length - 1];

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setNext(null);
      try {
        const token = await accessToken();
        const params = new URLSearchParams({ ...filters, invoiceOffset: String(cursor.invoiceOffset), noteOffset: String(cursor.noteOffset) });
        const response = await fetch(`/api/dashboard/client-documents?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Chargement impossible.");
        if (!controller.signal.aborted) { setDocuments(payload.documents); setNext(payload.next); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Chargement impossible.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    const timer = setTimeout(load, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, cursor]);

  function filter(key: keyof typeof filters, value: string) {
    setFilters(previous => ({ ...previous, [key]: value }));
    setHistory([first]);
  }

  async function download(document: DocumentRow) {
    const key = `${document.type}:${document.id}`;
    setDownloading(key);
    setDownloadError("");
    try {
      const token = await accessToken();
      const params = new URLSearchParams({ id: document.id, type: document.type });
      const response = await fetch(`/api/dashboard/client-documents/download?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Téléchargement impossible.");
      window.location.assign(payload.url);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Téléchargement impossible.");
    } finally { setDownloading(null); }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Factures</h1>
      <DocumentsExport />
      <Card>
        <div className={styles.content}>
          <div className={styles.filters}>
            <label className={styles.field}>Rechercher par client ou numéro
              <input className="input" type="search" maxLength={120} value={filters.search} onChange={event => filter("search", event.target.value)} />
            </label>
            <label className={styles.field}>Type de document
              <select className="select" value={filters.type} onChange={event => filter("type", event.target.value)}>
                <option value="all">Tous</option><option value="invoice">Factures</option><option value="credit_note">Avoirs</option>
              </select>
            </label>
            <label className={styles.field}>Émis du
              <input className="input" type="date" value={filters.from} max={filters.to || undefined} onChange={event => filter("from", event.target.value)} />
            </label>
            <label className={styles.field}>Au
              <input className="input" type="date" value={filters.to} min={filters.from || undefined} onChange={event => filter("to", event.target.value)} />
            </label>
          </div>
          {downloadError ? <p role="alert">{downloadError}</p> : null}
          <div aria-live="polite" aria-busy={loading}>
            {loading ? <p>Chargement…</p> : error ? <p role="alert">{error}</p> : !documents.length ? <p>Aucun document pour cette sélection.</p> : (
              <ul className={styles.list}>
                {documents.map(document => (
                  <li key={`${document.type}:${document.id}`} className={styles.row}>
                    <div className={styles.details}>
                      <strong>{document.type === "invoice" ? "Facture" : "Avoir"} {document.number}</strong>
                      <span>{document.client}</span>
                      <span className={styles.muted}>{date(document.issuedAt)} · {money(document.amount, document.currency)} TTC</span>
                      {document.refunds.map((refund, index) => <span className={styles.muted} key={index}>{refundLabel(refund.status)} : {money(refund.amount, refund.currency)}</span>)}
                    </div>
                    <Button variant="secondary" disabled={!document.downloadable || downloading !== null} onClick={() => download(document)}>
                      {!document.downloadable ? "PDF indisponible" : downloading === `${document.type}:${document.id}` ? "Téléchargement…" : "Télécharger"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <nav className={styles.pagination} aria-label="Pagination des factures">
            <Button variant="secondary" disabled={loading || history.length === 1} onClick={() => setHistory(previous => previous.slice(0, -1))}>Précédent</Button>
            <span>Page {history.length}</span>
            <Button variant="secondary" disabled={loading || Boolean(error) || !next} onClick={() => { if (next) setHistory(previous => [...previous, next]); }}>Suivant</Button>
          </nav>
        </div>
      </Card>
      <AccountantMonthlyLinks />
    </div>
  );
}
