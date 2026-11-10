"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientAppointmentPermissions } from "@/lib/clientAppointmentPolicy";
import styles from "./page.module.css";

type Slot = { start: string; end: string };

function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(iso));
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function todayInParis() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function appointmentDateInParis(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export default function AppointmentManagement(props: {
  token: string;
  serviceTitle: string;
  initialStart: string;
  initialEnd: string;
  initialPermissions: ClientAppointmentPermissions;
  initiallyRescheduling?: boolean;
  initialSyncPending?: boolean;
}) {
  const [start, setStart] = useState(props.initialStart);
  const [end, setEnd] = useState(props.initialEnd);
  const [permissions, setPermissions] = useState(props.initialPermissions);
  const [syncPending, setSyncPending] = useState(Boolean(props.initialSyncPending));
  const [syncing, setSyncing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(() => Boolean(props.initiallyRescheduling && props.initialPermissions.canReschedule && !props.initialSyncPending));
  const [date, setDate] = useState(() => appointmentDateInParis(props.initialStart));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const busy = moving || cancelling || syncing;
  const slotsParams = useMemo(() => new URLSearchParams({ date }).toString(), [date]);

  useEffect(() => {
    if (!pickerOpen || !permissions.canReschedule || syncPending) return;
    const controller = new AbortController();
    setLoadingSlots(true);
    setSelected(null);
    setError("");
    fetch(`/api/rendez-vous/${encodeURIComponent(props.token)}/reschedule?${slotsParams}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Impossible de charger les créneaux.");
        const payload = await response.json();
        setSlots(Array.isArray(payload) ? payload : []);
      })
      .catch((failure) => {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setSlots([]);
        setError(failure instanceof Error ? failure.message : "Impossible de charger les créneaux.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [permissions.canReschedule, pickerOpen, props.token, slotsParams, syncPending]);

  async function reschedule() {
    if (!selected) return;
    setMoving(true);
    setError("");
    try {
      const response = await fetch(`/api/rendez-vous/${encodeURIComponent(props.token)}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: selected.start }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === "CALENDAR_SYNC_PENDING") { setSyncPending(true); setPickerOpen(false); }
        throw new Error(payload.error || "Déplacement impossible.");
      }
      setStart(payload.appointment.start_datetime);
      setEnd(payload.appointment.end_datetime);
      setPermissions(payload.permissions);
      setPickerOpen(false);
      setSelected(null);
      // Reload server-side access windows and sync status for the new dates.
      window.location.replace(window.location.pathname);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Déplacement impossible.");
    } finally {
      setMoving(false);
    }
  }

  async function retrySynchronization() {
    setSyncing(true); setError("");
    try {
      const response = await fetch(`/api/rendez-vous/${encodeURIComponent(props.token)}/calendar-sync`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Synchronisation non confirmée.");
      setStart(payload.appointment.start_datetime); setEnd(payload.appointment.end_datetime);
      setPermissions(payload.permissions); setDate(appointmentDateInParis(payload.appointment.start_datetime));
      setSyncPending(false);
      window.location.replace(window.location.pathname);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Synchronisation non confirmée."); }
    finally { setSyncing(false); }
  }

  async function cancel() {
    setCancelling(true);
    setError("");
    try {
      const response = await fetch(`/api/rendez-vous/${encodeURIComponent(props.token)}/cancel`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Annulation impossible.");
      if (payload.refunded !== true) throw new Error("Le remboursement n’a pas été confirmé.");
      setCancelled(true);
      setPickerOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Annulation impossible.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <dl className={styles.details}>
        <div><dt>Prestation</dt><dd>{props.serviceTitle}</dd></div>
        <div><dt>Date</dt><dd>{dateLabel(start)}</dd></div>
        <div><dt>Horaire</dt><dd>{timeLabel(start)} – {timeLabel(end)}</dd></div>
      </dl>
      <section className={styles.management}>
        {syncPending && !cancelled ? <div role="status"><p>Le déplacement n’est pas confirmé : la synchronisation du calendrier reste à vérifier.</p><button type="button" className={styles.textAction} disabled={busy} onClick={retrySynchronization}>{syncing ? "Vérification en cours…" : "Réessayer la synchronisation"}</button></div> : null}
        {cancelled ? (
          <div className={styles.actionResult} role="status">
            <strong>Rendez-vous annulé</strong>
            <span>Vous avez été remboursé intégralement.</span>
          </div>
        ) : (
          <>
            {(permissions.canReschedule && !syncPending) || permissions.canCancel ? (
              <div className={styles.managementActions}>
                {permissions.canReschedule && !syncPending ? (
                  <button className={styles.textAction} type="button" disabled={busy} onClick={() => {
                    if (!pickerOpen) setDate(appointmentDateInParis(start));
                    setPickerOpen((open) => !open);
                  }}>
                    Déplacer mon rendez-vous
                  </button>
                ) : null}
                {permissions.canReschedule && !syncPending && permissions.canCancel ? <span aria-hidden="true">|</span> : null}
                {permissions.canCancel ? (
                  <button type="button" className={styles.textAction} disabled={busy} onClick={cancel}>
                    {cancelling ? "Annulation en cours…" : "Annuler mon rendez-vous"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {pickerOpen ? (
              <div className={styles.slotPicker}>
                <label>Choisir une date<input type="date" min={todayInParis()} value={date} onChange={(event) => setDate(event.target.value)} /></label>
                <div className={styles.slotList} aria-busy={loadingSlots}>
                  {loadingSlots ? <span>Chargement des créneaux…</span> : null}
                  {!loadingSlots && !slots.length ? <span>Aucun créneau disponible ce jour.</span> : null}
                  {slots.map((slot) => (
                    <button key={slot.start} type="button" disabled={busy} aria-pressed={selected?.start === slot.start} onClick={() => setSelected(slot)}>
                      {timeLabel(slot.start)}
                    </button>
                  ))}
                </div>
                <button type="button" disabled={busy || !selected} onClick={reschedule}>
                  {moving ? "Déplacement en cours…" : "Confirmer le déplacement"}
                </button>
              </div>
            ) : null}
          </>
        )}
        {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
      </section>
    </>
  );
}
