import {
  Check,
  ChevronRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { tasks } from "./tasks";
import styles from "./dashboard.module.css";

export default function TaskList() {
  const completedTasks = tasks.filter((task) => task.done).length;

  return (
    <section className={styles.tasksPanel}>
      <div className={styles.sectionHeading}>
        <h2>Complétez votre page</h2>
        <span>{completedTasks} sur {tasks.length}</span>
      </div>

      <div className={styles.tasksList}>
        {tasks.map((task) => {
          const content = (
            <>
              <span className={styles.taskIcon}>
                {task.done ? <Check size={16} /> : <Plus size={16} />}
              </span>

              <span className={styles.taskCopy}>
                <strong>{task.label}</strong>
                <span>{task.description}</span>
              </span>

              <ChevronRight className={styles.taskArrow} size={18} />
            </>
          );

          const className = `${styles.taskRow} ${
            task.done ? styles.taskRowDone : ""
          }`;

          if (!task.href) {
            return (
              <div
                key={task.label}
                className={className}
                aria-disabled="true"
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={task.label}
              href={task.href}
              className={className}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
