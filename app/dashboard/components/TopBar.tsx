import Link from "next/link";
import styles from "./dashboard.module.css";

type TopBarProps = {
  slug?: string | null;
  published?: boolean;
};

export default function TopBar({ slug, published = false }: TopBarProps) {
  const publicPageAvailable = Boolean(slug && published);
  const href = publicPageAvailable ? `/${slug}` : "/dashboard/publish";

  return (
    <header className={styles.topBar}>
      <Link
        href={href}
        className={styles.previewLink}
        target={publicPageAvailable ? "_blank" : undefined}
        rel={publicPageAvailable ? "noreferrer" : undefined}
      >
        {publicPageAvailable
          ? "Voir la page publique ↗"
          : "Gérer la page publique ↗"}
      </Link>

      <div className={styles.languageSwitcher} aria-label="Dashboard language">
        <button
          type="button"
          className={`${styles.languageButton} ${styles.languageButtonActive}`}
        >
          EN
        </button>

        <button type="button" className={styles.languageButton}>
          FR
        </button>
      </div>
    </header>
  );
}
