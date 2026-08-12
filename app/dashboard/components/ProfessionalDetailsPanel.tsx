"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type Details = {
  first_name: string;
  last_name: string;
  profession: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  siret: string;
  vat_number: string;
  vat_regime: string;
  vat_rate: string;
};

const EMPTY_DETAILS: Details = {
  first_name: "",
  last_name: "",
  profession: "",
  address: "",
  postal_code: "",
  city: "",
  country: "",
  siret: "",
  vat_number: "",
  vat_regime: "",
  vat_rate: "",
};

export default function ProfessionalDetailsPanel({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (fullName: string) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [draft, setDraft] = useState(EMPTY_DETAILS);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const closePanel = useCallback(() => {
    setDraft(details);
    setStatus("");
    onClose();
  }, [details, onClose]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetails() {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user || cancelled) return;

      const { data } = await supabase
        .from("profiles")
        .select(
          "first_name, last_name, profession, address, postal_code, city, country, siret, vat_number, vat_regime, vat_rate"
        )
        .eq("provider_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const loaded = {
        first_name: data?.first_name ?? "",
        last_name: data?.last_name ?? "",
        profession: data?.profession ?? "",
        address: data?.address ?? "",
        postal_code: data?.postal_code ?? "",
        city: data?.city ?? "",
        country: data?.country ?? "",
        siret: data?.siret ?? "",
        vat_number: data?.vat_number ?? "",
        vat_regime: data?.vat_regime ?? "",
        vat_rate:
          data?.vat_rate === null || data?.vat_rate === undefined
            ? ""
            : String(Number(data.vat_rate) * 100),
      };

      setUserId(user.id);
      setDetails(loaded);
      setDraft(loaded);
    }

    loadDetails();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePanel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePanel, open]);

  async function save() {
    if (!userId) return;

    const firstName = draft.first_name.trim();
    const lastName = draft.last_name.trim();

    if (!firstName || !lastName) {
      setStatus("Le prénom et le nom sont obligatoires.");
      return;
    }

    setSaving(true);
    setStatus("Enregistrement…");

    const normalized = Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [key, value.trim()])
    ) as Details;
    const vatRate = normalized.vat_rate
      ? Number(normalized.vat_rate.replace(",", ".")) / 100
      : null;
    if (
      normalized.vat_regime === "standard" &&
      (!Number.isFinite(vatRate) || !vatRate || vatRate <= 0)
    ) {
      setSaving(false);
      setStatus("Indiquez un taux de TVA valide.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        ...normalized,
        vat_rate: normalized.vat_regime === "franchise_base" ? 0 : vatRate,
        full_name: `${firstName} ${lastName}`,
        updated_at: new Date().toISOString(),
      })
      .eq("provider_id", userId);

    setSaving(false);

    if (error) {
      setStatus(`Erreur : ${error.message}`);
      return;
    }

    setDetails(normalized);
    setDraft(normalized);
    onSaved(`${firstName} ${lastName}`);
    setStatus("");
    onClose();
  }

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
        aria-labelledby="professional-details-title"
      >
        <header className={styles.professionalPanelHeader}>
          <div>
            <h2 id="professional-details-title">
              Informations professionnelles
            </h2>
            <p>Identité, activité, adresse et informations légales.</p>
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
          <div className={styles.inlineFields}>
            {(
              [
                ["first_name", "Prénom"],
                ["last_name", "Nom"],
                ["profession", "Métier"],
                ["address", "Adresse"],
                ["postal_code", "Code postal"],
                ["city", "Ville"],
                ["country", "Pays"],
                ["siret", "SIRET"],
                ["vat_number", "TVA intracommunautaire"],
              ] as Array<[keyof Details, string]>
            ).map(([key, label]) => (
              <label key={key} className={styles.inlineField}>
                <span>{label}</span>
                <input
                  className={styles.inlineInput}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  required={key === "first_name" || key === "last_name"}
                />
              </label>
            ))}
            <label className={styles.inlineField}>
              <span>Régime de TVA</span>
              <select
                className={styles.inlineInput}
                value={draft.vat_regime}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, vat_regime: event.target.value }))
                }
              >
                <option value="">À renseigner</option>
                <option value="franchise_base">Franchise en base</option>
                <option value="standard">TVA applicable</option>
              </select>
            </label>
            {draft.vat_regime === "standard" && (
              <label className={styles.inlineField}>
                <span>Taux de TVA (%)</span>
                <input
                  className={styles.inlineInput}
                  inputMode="decimal"
                  value={draft.vat_rate}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, vat_rate: event.target.value }))
                  }
                />
              </label>
            )}
          </div>
        </div>

        <footer className={styles.professionalPanelFooter}>
          <span className={styles.inlineEditorStatus}>{status}</span>
          <div className={styles.inlineEditorActions}>
            <button
              type="button"
              className={styles.inlineSecondaryButton}
              onClick={closePanel}
              disabled={saving}
            >
              Annuler
            </button>
            <button
              type="button"
              className={styles.inlinePrimaryButton}
              onClick={save}
              disabled={saving}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
