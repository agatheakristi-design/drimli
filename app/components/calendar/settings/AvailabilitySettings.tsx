"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import type { Availability, DayAvailability, DayKey } from "../types";
import styles from "../calendar.module.css";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Lundi" },
  { key: "tue", label: "Mardi" },
  { key: "wed", label: "Mercredi" },
  { key: "thu", label: "Jeudi" },
  { key: "fri", label: "Vendredi" },
  { key: "sat", label: "Samedi" },
  { key: "sun", label: "Dimanche" },
];

const DEFAULT_DAY = { start: "09:00", end: "18:00" };

const DEFAULT_AVAILABILITY: Availability = {
  mon: { ...DEFAULT_DAY },
  tue: { ...DEFAULT_DAY },
  wed: { ...DEFAULT_DAY },
  thu: { ...DEFAULT_DAY },
  fri: { ...DEFAULT_DAY },
  sat: null,
  sun: null,
};

type AvailabilitySettingsProps = {
  providerId: string;
  onSaved?: () => void;
};

export default function AvailabilitySettings({
  providerId,
  onSaved,
}: AvailabilitySettingsProps) {
  const [availability, setAvailability] =
    useState<Availability>(DEFAULT_AVAILABILITY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      setLoading(true);
      setStatus("");

      const { data, error } = await supabase
        .from("profiles")
        .select("availability")
        .eq("provider_id", providerId)
        .maybeSingle<{ availability: Availability | null }>();

      if (cancelled) return;

      if (error) {
        setStatus(`Erreur : ${error.message}`);
      } else if (data?.availability) {
        setAvailability(data.availability);
      }

      setLoading(false);
    }

    loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [providerId]);

  function updateDay(day: DayKey, value: DayAvailability) {
    setAvailability((current) => ({ ...current, [day]: value }));
    setStatus("");
  }

  async function save() {
    const invalidDay = DAYS.find(({ key }) => {
      const slot = availability[key];
      return slot && (!slot.start || !slot.end || slot.end <= slot.start);
    });

    if (invalidDay) {
      setStatus(
        `Erreur : l’heure de fin doit être après l’heure de début pour ${invalidDay.label}.`
      );
      return;
    }

    setSaving(true);
    setStatus("Enregistrement…");

    const { error } = await supabase
      .from("profiles")
      .update({ availability })
      .eq("provider_id", providerId);

    setSaving(false);

    if (error) {
      setStatus(`Erreur : ${error.message}`);
      return;
    }

    setStatus("Horaires enregistrés.");
    onSaved?.();
  }

  if (loading) {
    return <p className={styles.settingsStatus}>Chargement des horaires…</p>;
  }

  return (
    <section className={styles.settingsSection}>
      <div>
        <h3 className={styles.settingsTitle}>Horaires habituels</h3>
        <p className={styles.settingsIntro}>
          Définissez les heures pendant lesquelles vos clients peuvent réserver.
        </p>
      </div>

      <div className={styles.settingsDays}>
        {DAYS.map((day) => {
          const slot = availability[day.key];

          return (
            <div key={day.key} className={styles.settingsDay}>
              <div className={styles.settingsDayHeader}>
                <strong>{day.label}</strong>
                <button
                  type="button"
                  className={styles.settingsToggle}
                  onClick={() =>
                    updateDay(day.key, slot ? null : { ...DEFAULT_DAY })
                  }
                >
                  {slot ? "Fermer" : "Ouvrir"}
                </button>
              </div>

              {slot ? (
                <div className={styles.settingsTimes}>
                  <input
                    type="time"
                    aria-label={`Heure de début pour ${day.label}`}
                    value={slot.start}
                    onChange={(event) =>
                      updateDay(day.key, {
                        ...slot,
                        start: event.target.value,
                      })
                    }
                  />
                  <span>à</span>
                  <input
                    type="time"
                    aria-label={`Heure de fin pour ${day.label}`}
                    value={slot.end}
                    onChange={(event) =>
                      updateDay(day.key, {
                        ...slot,
                        end: event.target.value,
                      })
                    }
                  />
                </div>
              ) : (
                <span className={styles.settingsClosed}>Fermé</span>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.settingsFooter}>
        <Button onClick={save} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {status ? (
          <span className={styles.settingsStatus} role="status">
            {status}
          </span>
        ) : null}
      </div>
    </section>
  );
}
