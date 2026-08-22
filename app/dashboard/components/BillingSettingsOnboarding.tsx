"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type Values = {
  first_name: string; last_name: string; full_name: string; business_name: string;
  address: string; postal_code: string; city: string; country: string; siret: string;
  vat_regime: string; vat_number: string; vat_rate: string; cancellation_policy: string;
};

const empty: Values = {
  first_name: "", last_name: "", full_name: "", business_name: "", address: "",
  postal_code: "", city: "", country: "FR", siret: "", vat_regime: "franchise_base",
  vat_number: "", vat_rate: "", cancellation_policy: "non_refundable",
};

const policies = [
  ["non_refundable", "Sans remboursement", "La réservation n’est pas remboursable après paiement."],
  ["moderate", "Remboursement possible jusqu’à 48 h avant le rendez-vous", "Les fonds sont versés après le rendez-vous."],
] as const;

export default function BillingSettingsOnboarding({ onCompletionChange }: { onCompletionChange?: (complete: boolean) => void }) {
  const [values, setValues] = useState<Values>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { if (!cancelled) { setStatus("Vous devez être connecté."); setLoading(false); } return; }
      const response = await fetch("/api/dashboard/billing-settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!cancelled) {
        if (response.ok) { setValues({ ...empty, ...payload.values }); onCompletionChange?.(Boolean(payload.validated)); }
        else setStatus(payload.error || "Impossible de charger les informations.");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [onCompletionChange]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setStatus("");
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/dashboard/billing-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify(values),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setStatus(payload.error || "Impossible d’enregistrer."); return; }
    setStatus("Informations enregistrées.");
    onCompletionChange?.(true);
  }

  if (loading) return <p className={styles.inlineEditorStatus}>Chargement…</p>;

  return (
    <form className={styles.billingSettings} onSubmit={save}>
      <section className={styles.billingSection}>
        <div><h3>Informations de facturation</h3><p>Ces informations seront utilisées pour vos futures factures clients.</p></div>
        <div className={styles.inlineFields}>
          <label className={styles.inlineField}>Prénom<input className={styles.inlineInput} value={values.first_name} onChange={(e) => update("first_name", e.target.value)} /></label>
          <label className={styles.inlineField}>Nom<input className={styles.inlineInput} value={values.last_name} onChange={(e) => update("last_name", e.target.value)} /></label>
          <label className={styles.inlineField}>Nom complet ou raison sociale<input className={styles.inlineInput} required value={values.full_name} onChange={(e) => update("full_name", e.target.value)} /></label>
          <label className={styles.inlineField}>Nom commercial <span>(facultatif)</span><input className={styles.inlineInput} value={values.business_name} onChange={(e) => update("business_name", e.target.value)} /></label>
          <label className={`${styles.inlineField} ${styles.billingWide}`}>Adresse<input className={styles.inlineInput} required value={values.address} onChange={(e) => update("address", e.target.value)} /></label>
          <label className={styles.inlineField}>Code postal<input className={styles.inlineInput} required value={values.postal_code} onChange={(e) => update("postal_code", e.target.value)} /></label>
          <label className={styles.inlineField}>Ville<input className={styles.inlineInput} required value={values.city} onChange={(e) => update("city", e.target.value)} /></label>
          <label className={styles.inlineField}>Pays<input className={styles.inlineInput} required value={values.country} onChange={(e) => update("country", e.target.value)} /></label>
          <label className={styles.inlineField}>SIRET<input className={styles.inlineInput} required value={values.siret} onChange={(e) => update("siret", e.target.value)} /></label>
          <label className={styles.inlineField}>Régime de TVA<select className={styles.inlineInput} value={values.vat_regime} onChange={(e) => update("vat_regime", e.target.value)}><option value="franchise_base">Franchise en base de TVA</option><option value="standard">Assujetti à la TVA</option></select></label>
          {values.vat_regime === "standard" && <><label className={styles.inlineField}>N° de TVA intracommunautaire<input className={styles.inlineInput} required value={values.vat_number} onChange={(e) => update("vat_number", e.target.value)} /></label><label className={styles.inlineField}>Taux de TVA (%)<input className={styles.inlineInput} type="number" min="0.01" max="100" step="0.01" required value={values.vat_rate} onChange={(e) => update("vat_rate", e.target.value)} /></label></>}
        </div>
      </section>

      <section className={styles.billingSection}>
        <div><h3>Politique d’annulation</h3><p>La politique choisie est figée pour chaque réservation au moment où elle est créée.</p></div>
        <div className={styles.policyChoices}>
          {policies.map(([value, title, description]) => <label key={value} className={styles.policyChoice}><input type="radio" name="cancellation_policy" value={value} checked={values.cancellation_policy === value} onChange={() => update("cancellation_policy", value)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}
        </div>
      </section>

      <div className={styles.inlineEditorFooter}><span className={styles.inlineEditorStatus} role="status">{status}</span><button className={styles.inlinePrimaryButton} type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button></div>
    </form>
  );
}
