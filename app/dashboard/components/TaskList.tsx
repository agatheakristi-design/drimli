import {
  Camera,
  Check,
  ChevronRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import styles from "./dashboard.module.css";

export default function TaskList() {
  return (
    <section className={styles.tasksPanel}>
      <div className={styles.sectionHeading}>
        <h2>Complétez votre page</h2>
        <span>3 sur 8</span>
      </div>

      <div className={styles.tasksList}>

        <Link
          href="/dashboard/services"
          className={`${styles.taskRow} ${styles.taskRowDone}`}
        >
          <span className={styles.taskIcon}>
            <Check size={16} />
          </span>

          <span className={styles.taskCopy}>
            <strong>Premier service créé</strong>
            <span>Votre première offre est publiée.</span>
          </span>

          <ChevronRight className={styles.taskArrow} size={18} />
        </Link>

        <button type="button" className={styles.taskRow}>
          <span className={styles.taskIcon}>
            <Plus size={16} />
          </span>

          <span className={styles.taskCopy}>
            <strong>Ajouter un service</strong>
            <span>Proposez davantage de prestations.</span>
          </span>

          <ChevronRight className={styles.taskArrow} size={18} />
        </button>

        <button type="button" className={styles.taskRow}>
          <span className={styles.taskIcon}>
            <Camera size={16} />
          </span>

          <span className={styles.taskCopy}>
            <strong>Ajouter une photo</strong>
            <span>Rendez votre page plus personnelle.</span>
          </span>

          <ChevronRight className={styles.taskArrow} size={18} />
        </button>

      </div>
    </section>
  );
}
