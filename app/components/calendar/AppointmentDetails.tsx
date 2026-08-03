"use client";

import Button from "@/app/components/ui/Button";
import type { CalendarAppointment } from "./types";
import styles from "./calendar.module.css";

type AppointmentDetailsProps = {
  appointment: CalendarAppointment;
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
}: AppointmentDetailsProps) {
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
      </dl>

      {appointment.videoJoinUrl ? (
        <Button
          className={styles.appointmentPrimaryAction}
          onClick={() =>
            window.open(
              appointment.videoJoinUrl ?? "",
              "_blank",
              "noopener,noreferrer"
            )
          }
        >
          Rejoindre la visio
        </Button>
      ) : (
        <p className={styles.appointmentEmptyState}>
          Lien de visioconférence indisponible
        </p>
      )}
    </section>
  );
}
