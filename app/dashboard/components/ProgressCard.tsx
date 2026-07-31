import styles from "./dashboard.module.css";

export default function ProgressCard() {
  return (
    <aside className={styles.progressCard}>
      <div>
        <div className={styles.progressLabel}>Profil</div>

        <div className={styles.progressValue}>
          36%
        </div>

        <div className={styles.progressTrack}>
          <div className={styles.progressFill} />
        </div>
      </div>

      <div className={styles.progressNote}>
        3 essentiels sur 8 terminés.
      </div>
    </aside>
  );
}
