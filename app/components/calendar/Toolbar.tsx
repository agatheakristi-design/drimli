"use client";

import { ArrowDown, ArrowLeft, ArrowRight, Settings } from "lucide-react";
import Button from "@/app/components/ui/Button";
import styles from "./calendar.module.css";

function RefundsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 5.5H3.5v-4" />
      <path d="M3.8 5.2A9 9 0 1 1 3 14" />
      <path d="m9.5 9.5 5 5" />
      <path d="m14.5 9.5-5 5" />
    </svg>
  );
}

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
  onRefunds,
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
          variant="secondary"
          className={styles.toolbarIconButton}
          onClick={onRefunds}
          aria-label="Ouvrir les remboursements"
          title="Remboursements"
        >
          <RefundsIcon />
        </Button>
        <Button
          variant="secondary"
          className={styles.toolbarIconButton}
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
