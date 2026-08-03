"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type Details = {
  first_name: string;
  last_name: string;
  profession: string;
  address: string;
  city: string;
  country: string;
  siret: string;
  vat_number: string;
};

const EMPTY_DETAILS: Details = {
  first_name: "",
  last_name: "",
  profession: "",
  address: "",
  city: "",
  country: "",
  siret: "",
  vat_number: "",
};

export default function ProfessionalDetailsTask({
  onCompletionChange,
}: {
  onCompletionChange: (complete: boolean) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [draft, setDraft] = useState(EMPTY_DETAILS);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const complete = Boolean(details.first_name && details.last_name);

  useEffect(() => {
    let cancelled = false;

    async function loadDetails() {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user || cancelled) return;

      const { data } = await supabase
        .from("profiles")
        .select(
          "first_name, last_name, profession, address, city, country, siret, vat_number"
        )
        .eq("provider_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const loaded = {
        first_name: data?.first_name ?? "",
        last_name: data?.last_name ?? "",
        profession: data?.profession ?? "",
        address: data?.address ?? "",
        city: data?.city ?? "",
        country: data?.country ?? "",
        siret: data?.siret ?? "",
        vat_number: data?.vat_number ?? "",
      };

      setUserId(user.id);
      setDetails(loaded);
      setDraft(loaded);
      onCompletionChange(Boolean(loaded.first_name && loaded.last_name));
    }

    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [onCompletionChange]);

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
    const { error } = await supabase
      .from("profiles")
      .update({
        ...normalized,
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
    onCompletionChange(true);
    setStatus("");
    setOpen(false);
  }

  return (
    <div
      className={`${styles.taskRow} ${styles.taskRowExpanded} ${
        complete ? styles.taskRowDone : ""
      } ${open ? styles.taskRowExpandedOpen : ""}`}
    >
      <button
        type="button"
        className={styles.taskRowHeader}
        onClick={() => {
          setDraft(details);
          setStatus("");
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span className={styles.taskIcon}>
          {complete ? <Check size={16} /> : <Plus size={16} />}
        </span>
        <span className={styles.taskCopy}>
          <strong>Informations professionnelles</strong>
          <span>Identité, activité, adresse et informations légales.</span>
        </span>
        <ChevronRight className={styles.taskArrow} size={18} />
      </button>

      {open ? (
        <div className={styles.inlineEditor}>
          <div className={styles.inlineFields}>
            {(
              [
                ["first_name", "Prénom"],
                ["last_name", "Nom"],
                ["profession", "Métier"],
                ["address", "Adresse"],
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
          </div>
          <div className={styles.inlineEditorFooter}>
            <span className={styles.inlineEditorStatus}>{status}</span>
            <div className={styles.inlineEditorActions}>
              <button
                type="button"
                className={styles.inlineSecondaryButton}
                onClick={() => setOpen(false)}
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
