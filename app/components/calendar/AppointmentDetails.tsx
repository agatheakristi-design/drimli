"use client";

import { useEffect, useState } from "react";
import Button from "@/app/components/ui/Button";
import { supabase } from "@/lib/supabaseClient";
import type { CalendarAppointment } from "./types";
import type { VideoRoomStatus } from "@/lib/video/types";
import styles from "./calendar.module.css";

type AppointmentDetailsProps = {
  appointment: CalendarAppointment;
  onAppointmentChanged?: () => void;
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function videoLabel(provider: string | null, joinUrl: string | null) {
  if (!joinUrl) return "Indisponible";
  if (provider === "google_meet") return "Google Meet prête";
  return "Visioconférence prête";
}

export default function AppointmentDetails({
  appointment,
  onAppointmentChanged,
}: AppointmentDetailsProps) {
  const [roomStatus, setRoomStatus] = useState(appointment.videoRoomStatus);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    setRoomStatus(appointment.videoRoomStatus);
    setMeetingStarted(false);
    setStatusMessage("");
  }, [appointment.id, appointment.videoRoomStatus]);

  function openProfessionalMeeting() {
    if (!appointment.videoJoinUrl) return;
    window.open(appointment.videoJoinUrl, "_blank", "noopener,noreferrer");
    setMeetingStarted(true);
  }

  async function updateRoomStatus(nextStatus: VideoRoomStatus) {
    setUpdating(true);
    setStatusMessage("");

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Session expirée.");

      const response = await fetch(
        `/api/appointments/${encodeURIComponent(appointment.id)}/video-room`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const payload = (await response.json()) as {
        status?: VideoRoomStatus;
        error?: string;
      };

      if (!response.ok || !payload.status) {
        throw new Error(payload.error || "Mise à jour impossible.");
      }

      setRoomStatus(payload.status);
      setStatusMessage(
        payload.status === "open"
          ? "La salle est ouverte aux clients."
          : "L’accès vidéo est verrouillé."
      );
      onAppointmentChanged?.();
    } catch (error: unknown) {
      setStatusMessage(
        error instanceof Error ? error.message : "Mise à jour impossible."
      );
    } finally {
      setUpdating(false);
    }
  }

  const roomLabel =
    roomStatus === "closed"
      ? "Salle fermée"
      : roomStatus === "open"
        ? "Salle ouverte"
        : "Accès vidéo verrouillé";

  return (
    <section className={styles.appointmentDetails}>
      <header className={styles.appointmentDetailsHeader}>
        <span className={styles.appointmentEyebrow}>Rendez-vous</span>
        <h3>{appointment.serviceName}</h3>
        <p>{appointment.clientName}</p>
      </header>

      <dl className={styles.appointmentDetailsList}>
        <div className={styles.appointmentDetailsRow}>
          <dt>Date</dt>
          <dd>{formatDate(appointment.start_datetime)}</dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Horaire</dt>
          <dd>
            {formatTime(appointment.start_datetime)} –{" "}
            {formatTime(appointment.end_datetime)}
          </dd>
        </div>
        {appointment.clientEmail ? (
          <div className={styles.appointmentDetailsRow}>
            <dt>Email</dt>
            <dd>{appointment.clientEmail}</dd>
          </div>
        ) : null}
        <div className={styles.appointmentDetailsRow}>
          <dt>Statut</dt>
          <dd>Confirmé</dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Paiement</dt>
          <dd>Payé</dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Visio</dt>
          <dd>
            {videoLabel(
              appointment.videoProvider,
              appointment.videoJoinUrl
            )}
          </dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Salle client</dt>
          <dd>{roomLabel}</dd>
        </div>
      </dl>

      {appointment.videoJoinUrl && roomStatus !== "locked" ? (
        <>
          <p className={styles.appointmentEmptyState}>
            {roomStatus === "closed"
              ? "Démarrez la visioconférence avant d’ouvrir la salle aux clients."
              : "Les clients peuvent désormais rejoindre la visioconférence."}
          </p>
          <div className={styles.appointmentActions}>
            <Button
              className={styles.appointmentPrimaryAction}
              onClick={openProfessionalMeeting}
            >
              {roomStatus === "closed"
                ? "Démarrer la visioconférence"
                : "Rejoindre la visioconférence"}
            </Button>

            {roomStatus === "closed" && meetingStarted ? (
              <Button
                variant="secondary"
                className={styles.appointmentPrimaryAction}
                disabled={updating}
                onClick={() => updateRoomStatus("open")}
              >
                Ouvrir la salle aux clients
              </Button>
            ) : null}

            {roomStatus === "open" ? (
              <Button
                variant="danger"
                className={styles.appointmentPrimaryAction}
                disabled={updating}
                onClick={() => updateRoomStatus("locked")}
              >
                Verrouiller l’accès vidéo
              </Button>
            ) : null}
          </div>
        </>
      ) : roomStatus === "locked" ? (
        <p className={styles.appointmentEmptyState}>
          L’accès à la visioconférence est verrouillé.
        </p>
      ) : (
        <p className={styles.appointmentEmptyState}>
          Lien de visioconférence indisponible
        </p>
      )}

      {statusMessage ? (
        <p className={styles.appointmentStatusMessage} role="status">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
