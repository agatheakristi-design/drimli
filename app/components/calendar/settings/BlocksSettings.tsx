"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import {
  addOneDayYMD,
  dayKeyFromYMD,
  parisDateTimeToIso,
} from "../utils";
import type { Availability } from "../types";
import styles from "../calendar.module.css";

function parisTodayYMD() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidYMD(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeRange(start: string, end: string) {
  return Boolean(start && end && start < end);
}

type BlocksSettingsProps = {
  providerId: string;
  availability: Availability | null;
  onCreated?: () => void;
};

export default function BlocksSettings({
  providerId,
  availability,
  onCreated,
}: BlocksSettingsProps) {
  const todayParis = useMemo(() => parisTodayYMD(), []);

  const [date, setDate] = useState(todayParis);
  const [start, setStart] = useState("12:30");
  const [end, setEnd] = useState("14:00");
  const [reason, setReason] = useState("Pause / Indisponible");
  const [allDays, setAllDays] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function createBlock(
    startTime: string,
    endTime: string,
    reasonOverride?: string,
    fullDay = false
  ) {
    setStatus("");

    if (!providerId) {
      setStatus("Vous devez être connecté.");
      return;
    }

    if (!isValidYMD(date)) {
      setStatus("Date invalide.");
      return;
    }

    if (date < todayParis) {
      setStatus("Impossible de bloquer une date passée.");
      return;
    }

    if (!fullDay && !isValidTimeRange(startTime, endTime)) {
      setStatus("L’heure de fin doit être après l’heure de début.");
      return;
    }

    setSaving(true);
    setStatus("Enregistrement…");

    const dates = allDays
      ? Array.from({ length: 7 }, (_, index) => {
          let result = date;
          for (let day = 0; day < index; day += 1) {
            result = addOneDayYMD(result);
          }
          return result;
        }).filter((candidateDate) =>
          Boolean(availability?.[dayKeyFromYMD(candidateDate)])
        )
      : [date];

    if (dates.length === 0) {
      setSaving(false);
      setStatus("Aucun jour concerné : les sept jours sont fermés.");
      return;
    }

    const requestedBlocks = dates.map((candidateDate) => ({
      provider_id: providerId,
      start_datetime: parisDateTimeToIso(candidateDate, startTime),
      end_datetime: parisDateTimeToIso(
        fullDay ? addOneDayYMD(candidateDate) : candidateDate,
        endTime
      ),
      reason: (reasonOverride ?? reason).trim() || null,
    }));
    const closedDayCount = allDays ? 7 - dates.length : 0;

    const { data: existing, error: lookupError } = await supabase
      .from("provider_blocks")
      .select("start_datetime, end_datetime")
      .eq("provider_id", providerId)
      .in(
        "start_datetime",
        requestedBlocks.map((block) => block.start_datetime)
      );

    if (lookupError) {
      setSaving(false);
      setStatus(`Erreur : ${lookupError.message}`);
      return;
    }

    const existingIntervals = new Set(
      (existing ?? []).map(
        (block) => `${block.start_datetime}|${block.end_datetime}`
      )
    );
    const blocksToInsert = requestedBlocks.filter(
      (block) =>
        !existingIntervals.has(
          `${block.start_datetime}|${block.end_datetime}`
        )
    );
    const duplicateCount = requestedBlocks.length - blocksToInsert.length;

    if (blocksToInsert.length === 0) {
      setSaving(false);
      setStatus("Aucun nouveau blocage : ces créneaux existent déjà.");
      return;
    }

    const { error } = await supabase
      .from("provider_blocks")
      .insert(blocksToInsert);

    setSaving(false);

    if (error) {
      setStatus(`Erreur : ${error.message}`);
      return;
    }

    const skippedDetails = [
      closedDayCount > 0 ? `${closedDayCount} jour(s) fermé(s) ignoré(s)` : "",
      duplicateCount > 0 ? `${duplicateCount} déjà existant(s)` : "",
    ].filter(Boolean);

    setStatus(
      skippedDetails.length > 0
        ? `Succès partiel : ${blocksToInsert.length} blocage(s) créé(s), ${skippedDetails.join(", ")}.`
        : `Succès : ${blocksToInsert.length} blocage(s) créé(s).`
    );
    onCreated?.();
  }

  return (
    <section className={styles.settingsSection}>
      <div>
        <h3 className={styles.settingsTitle}>Bloquer un créneau</h3>
        <p className={styles.settingsIntro}>
          Ajoutez une pause, une indisponibilité ou une journée fermée.
        </p>
      </div>

      <div className={styles.settingsField}>
        <label htmlFor="block-date">Date</label>

        <input
          id="block-date"
          type="date"
          value={date}
          min={todayParis}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <div className={styles.settingsField}>
        <label htmlFor="block-reason">Raison facultative</label>

        <input
          id="block-reason"
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Pause déjeuner, absence…"
        />
      </div>

      <div className={styles.settingsTimeRow}>
        <div className={styles.settingsField}>
          <label htmlFor="block-start">De</label>

          <input
            id="block-start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>

        <div className={styles.settingsField}>
          <label htmlFor="block-end">À</label>

          <input
            id="block-end"
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>

      <label className={styles.settingsCheckbox}>
        <input
          type="checkbox"
          checked={allDays}
          onChange={(event) => setAllDays(event.target.checked)}
        />
        <span>Tous les jours</span>
      </label>

      <div className={styles.settingsActions}>
        <Button
          onClick={() => createBlock(start, end)}
          disabled={saving}
        >
          {saving ? "Ajout…" : "Bloquer ce créneau"}
        </Button>

        <Button
          variant="secondary"
          onClick={() =>
            createBlock(
              "00:00",
              "00:00",
              "Indisponible toute la journée",
              true
            )
          }
          disabled={saving}
        >
          Bloquer la journée
        </Button>
      </div>

      {status ? (
        <p className={styles.settingsStatus}>{status}</p>
      ) : null}
    </section>
  );
}
