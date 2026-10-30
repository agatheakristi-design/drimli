"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Card, { CardTitle } from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import styles from "./factures.module.css";

type Delivery = { id: string; period_month: string; status: string; archive_expires_at: string };
async function authorization() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Session expirée.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}
export default function AccountantMonthlyLinks() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const response = await fetch("/api/dashboard/client-documents/accountant-links", { headers: await authorization(), cache: "no-store" });
        const body = await response.json();
        if (body.enabled === false) return;
        if (!response.ok) throw new Error(body.error || "Historique indisponible.");
        if (!canceled) setDeliveries(body.deliveries);
      } catch (cause) { if (!canceled) setError(cause instanceof Error ? cause.message : "Historique indisponible."); }
    })();
    return () => { canceled = true; };
  }, []);
  async function renew(id: string) {
    setBusy(true); setError(""); setLink(""); setMessage("");
    try {
      const response = await fetch("/api/dashboard/client-documents/accountant-links", { method: "POST", headers: { ...await authorization(), "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Renouvellement impossible.");
      setLink(body.url);
      setMessage("Transmettez ce nouveau lien à votre comptable. L’ancien lien est remplacé ; aucun e-mail n’a été envoyé.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Renouvellement impossible."); }
    finally { setBusy(false); }
  }
  if (!deliveries.length && !error) return null;
  return <Card><div className={styles.content}>
    <CardTitle>Liens du comptable</CardTitle>
    <p className={styles.muted}>Si un lien a expiré, renouvelez-le ici puis transmettez-le à votre comptable. Les copies ZIP sont disponibles pendant 30 jours ; les PDF d’origine restent accessibles dans Factures.</p>
    <ul className={styles.list}>{deliveries.map(delivery => <li key={delivery.id} className={styles.row}>
      <span>{new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${delivery.period_month}T12:00:00Z`))}</span>
      <Button variant="secondary" disabled={busy || delivery.status === "purged" || Date.parse(delivery.archive_expires_at) <= Date.now()} onClick={() => renew(delivery.id)}>Renouveler le lien</Button>
    </li>)}</ul>
    {link ? <label className={styles.field}>Nouveau lien sécurisé<input className="input" readOnly value={link} onFocus={event => event.target.select()} /></label> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div></Card>;
}
