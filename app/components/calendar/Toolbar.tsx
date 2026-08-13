"use client";

import Button from "@/app/components/ui/Button";
import styles from "./calendar.module.css";

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
        <Button variant="secondary" onClick={onPrevious}>
          ←
        </Button>

        <Button variant="secondary" onClick={onNext}>
          →
        </Button>
      </div>

      <div className={styles.toolbarTitle}>{label}</div>

      <div className={styles.toolbarActions}>
        <Button variant="secondary" onClick={onToday}>
          Aujourd’hui
        </Button>

        <div className={styles.toolbarSecondaryActions}>
          <button
            type="button"
            className={styles.toolbarTextAction}
            onClick={onRefunds}
          >
            Remboursements
          </button>
          <Button variant="secondary" onClick={onSettings}>
            Configurer
          </Button>
        </div>
      </div>
    </header>
  );
}
