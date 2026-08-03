import type { CSSProperties } from "react";
import type { CalendarAppointment } from "./types";
import styles from "./calendar.module.css";

type EventCardProps = {
  appointment: CalendarAppointment;
  style: CSSProperties;
  onSelect: (appointment: CalendarAppointment) => void;
};

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function EventCard({
  appointment,
  style,
  onSelect,
}: EventCardProps) {
  const startTime = formatTime(appointment.start_datetime);
  const endTime = formatTime(appointment.end_datetime);

  return (
    <button
      type="button"
      className={styles.eventCard}
      style={style}
      onClick={() => onSelect(appointment)}
      aria-label={`${appointment.serviceName}, ${appointment.clientName}, de ${startTime} à ${endTime}. Afficher le rendez-vous`}
    >
      <strong className={styles.eventService}>{appointment.serviceName}</strong>
      <span className={styles.eventClient}>{appointment.clientName}</span>
      <time className={styles.eventTime}>
        {startTime} – {endTime}
      </time>
    </button>
  );
}
