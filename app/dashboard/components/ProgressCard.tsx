import { tasks } from "./tasks";
import styles from "./dashboard.module.css";

export default function ProgressCard() {
  const completedTasks = tasks.filter((task) => task.done).length;
  const progress = Math.round((completedTasks / tasks.length) * 100);

  return (
    <aside className={styles.progressCard}>
      <div>
        <div className={styles.progressLabel}>Profil</div>

        <div className={styles.progressValue}>
          {progress}%
        </div>

        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className={styles.progressNote}>
        {completedTasks} tâches sur {tasks.length} terminées.
      </div>
    </aside>
  );
}
