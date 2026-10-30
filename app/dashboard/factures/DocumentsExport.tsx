"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Card, { CardTitle } from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import styles from "./factures.module.css";

const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default function DocumentsExport() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("all");
  const [type, setType] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function download() {
    setExporting(true);
    setMessage("");
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expirée.");
      const params = new URLSearchParams({ year, month, type });
      const response = await fetch(`/api/dashboard/client-documents/export?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const missing = Array.isArray(payload?.missing) ? ` ${payload.missing.join(" ")}` : "";
        throw new Error((payload?.error || "Export impossible.") + missing);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "DRIMLI_documents.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const exported = Number(response.headers.get("X-Documents-Exported"));
      const missing = Number(response.headers.get("X-Documents-Missing"));
      setMessage(`${exported} PDF inclus dans le ZIP.${missing ? ` ${missing} PDF manquants : consultez Documents-manquants.txt dans l’archive.` : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export impossible.");
    } finally { setExporting(false); }
  }

  return (
    <Card>
      <div className={styles.content}>
        <CardTitle>Télécharger mes documents</CardTitle>
        <form className={`${styles.filters} ${styles.exportControls}`} onSubmit={event => { event.preventDefault(); void download(); }}>
          <label className={styles.field}>Année
            <input className="input" type="number" min="2000" max="9999" required value={year} disabled={exporting} onChange={event => setYear(event.target.value)} />
          </label>
          <label className={styles.field}>Mois
            <select className="select" value={month} disabled={exporting} onChange={event => setMonth(event.target.value)}>
              <option value="all">Toute l’année</option>
              {months.map((label, index) => <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>)}
            </select>
          </label>
          <label className={styles.field}>Documents
            <select className="select" value={type} disabled={exporting} onChange={event => setType(event.target.value)}>
              <option value="all">Factures et avoirs</option><option value="invoice">Factures uniquement</option><option value="credit_note">Avoirs uniquement</option>
            </select>
          </label>
          <Button type="submit" variant="secondary" disabled={exporting}>{exporting ? "Préparation du ZIP…" : "Télécharger"}</Button>
        </form>
        <p className={styles.muted}>PDF archivés uniquement · 200 documents et ZIP de 4 Mo maximum. Pour un export volumineux, sélectionnez un mois ou un seul type de document.</p>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </Card>
  );
}
