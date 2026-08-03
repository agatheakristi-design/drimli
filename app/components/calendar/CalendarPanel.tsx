"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import Settings from "./Settings";
import AppointmentDetails from "./AppointmentDetails";
import type {
  Availability,
  CalendarAppointment,
  CalendarPanelMode,
  CalendarSettingsSection,
} from "./types";
import styles from "./calendar.module.css";

type CalendarPanelProps = {
  open: boolean;
  mode: CalendarPanelMode;
  appointment: CalendarAppointment | null;
  onClose: () => void;
  onCalendarChanged?: () => void;
  availability: Availability | null;
  openSection: CalendarSettingsSection | null;
  onSectionChange: (section: CalendarSettingsSection | null) => void;
  selectedBlockId: string | null;
};

export default function CalendarPanel({
  open,
  mode,
  appointment,
  onClose,
  onCalendarChanged,
  availability,
  openSection,
  onSectionChange,
  selectedBlockId,
}: CalendarPanelProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <aside
      className={`${styles.calendarPanel} ${
        open ? styles.calendarPanelOpen : ""
      }`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className={styles.calendarPanelHeader}>
        <h2>
          {mode === "appointment"
            ? "Détail du rendez-vous"
            : "Configuration du calendrier"}
        </h2>

        <button
          type="button"
          className={styles.calendarPanelClose}
          onClick={onClose}
          aria-label="Fermer le panneau"
        >
          <X size={18} strokeWidth={1.5} />
        </button>
      </div>

      <div className={styles.calendarPanelBody}>
        {mode === "appointment" && appointment ? (
          <AppointmentDetails appointment={appointment} />
        ) : (
          <Settings
            onCalendarChanged={onCalendarChanged}
            availability={availability}
            openSection={openSection}
            onSectionChange={onSectionChange}
            selectedBlockId={selectedBlockId}
          />
        )}
      </div>
    </aside>
  );
}
