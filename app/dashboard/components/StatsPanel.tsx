import { ArrowUpRight } from "lucide-react";
import styles from "./dashboard.module.css";

export default function StatsPanel() {
  return (
    <aside className={styles.statsPanel}>
      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Visites</span>
        <strong className={styles.statsValue}>0</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          Ce mois-ci
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Réservations</span>
        <strong className={styles.statsValue}>0</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          À venir
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Revenus</span>
        <strong className={styles.statsValue}>0 €</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          Ce mois-ci
        </span>
      </div>
    </aside>
  );
}
