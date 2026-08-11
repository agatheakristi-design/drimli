import Link from "next/link";
import styles from "./dashboard.module.css";

type TopBarProps = {
  slug?: string | null;
  published?: boolean;
};

export default function TopBar({ slug, published = false }: TopBarProps) {
  const publicPageAvailable = Boolean(slug && published);

  return (
    <header className={styles.topBar}>
      {publicPageAvailable ? (
        <Link
          href={`/${slug}`}
          className={styles.previewLink}
          target="_blank"
          rel="noreferrer"
        >
          Voir la page publique ↗
        </Link>
      ) : (
        <span className={styles.previewLink}>Page publique indisponible</span>
      )}

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
