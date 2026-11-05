"use client";

import { ArrowDown, ArrowLeft, ArrowRight, Settings } from "lucide-react";
import Button from "@/app/components/ui/Button";
import styles from "./calendar.module.css";
import dashboardStyles from "@/app/dashboard/components/dashboard.module.css";

type ToolbarProps = {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onSettings: () => void;
  onRefunds: () => void;
};

export default function Toolbar({
  label,
  onPrevious,
  onNext,
  onToday,
  onSettings,
}: ToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.toolbarNavigation}>
        <Button
          variant="secondary"
          className={styles.toolbarIconButton}
          onClick={onPrevious}
          aria-label="Semaine précédente"
          title="Semaine précédente"
        >
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>

        <Button
          variant="secondary"
          className={styles.toolbarIconButton}
          onClick={onNext}
          aria-label="Semaine suivante"
          title="Semaine suivante"
        >
          <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>

        <Button
          variant="secondary"
          className={styles.toolbarIconButton}
          onClick={onToday}
          aria-label="Revenir à la semaine actuelle"
          title="Aujourd’hui"
        >
          <ArrowDown size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </div>

      <div className={styles.toolbarTitle}>{label}</div>

      <div className={styles.toolbarActions}>
        <Button
          variant="primary"
          size="sm"
          className={`${dashboardStyles.taskIcon} ${styles.toolbarSettingsButton}`}
          onClick={onSettings}
          aria-label="Configurer le calendrier"
          title="Configurer"
        >
          <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
