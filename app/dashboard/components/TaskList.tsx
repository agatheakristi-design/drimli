import {
  Check,
  ChevronRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import styles from "./dashboard.module.css";

const tasks = [
  {
    label: "Premier service créé",
    description: "Votre première offre est publiée.",
    href: "/dashboard/services",
    done: true,
  },
  {
    label: "Ajouter un service",
    description: "Proposez davantage de prestations.",
    href: "/dashboard/services",
    done: false,
  },
  {
    label: "Ajouter une photo",
    description: "Rendez votre page plus personnelle.",
    href: "/dashboard/profile/media",
    done: false,
  },
  {
    label: "Écrire une description",
    description: "Présentez votre activité et votre expertise.",
    href: "/dashboard/profile",
    done: false,
  },
  {
    label: "Définir vos disponibilités",
    description: "Indiquez quand vos clients peuvent réserver.",
    href: "/dashboard/disponibilites",
    done: false,
  },
  {
    label: "Connecter les paiements",
    description: "Activez la réception des paiements.",
    href: "/paiements",
    done: false,
  },
  {
    label: "Connecter Google Meet",
    description: "Ajoutez la visioconférence à vos rendez-vous.",
    href: "/dashboard/profile",
    done: false,
  },
  {
    label: "Avis Google",
    description: "Affichez les avis de votre fiche Google.",
    href: null,
    done: false,
  },
  {
    label: "Facturation automatique",
    description: "Générez automatiquement vos factures.",
    href: "/dashboard/factures",
    done: false,
  },
];

export default function TaskList() {
  return (
    <section className={styles.tasksPanel}>
      <div className={styles.sectionHeading}>
        <h2>Complétez votre page</h2>
        <span>1 sur 9</span>
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
