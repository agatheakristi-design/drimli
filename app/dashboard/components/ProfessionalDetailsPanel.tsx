"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type Details = {
  first_name: string;
  last_name: string;
  profession: string;
};

const EMPTY_DETAILS: Details = {
  first_name: "",
  last_name: "",
  profession: "",
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
        .select("first_name, last_name, profession")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const loaded = {
        first_name: data?.first_name ?? "",
        last_name: data?.last_name ?? "",
        profession: data?.profession ?? "",
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
            <p>Identité et activité.</p>
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
