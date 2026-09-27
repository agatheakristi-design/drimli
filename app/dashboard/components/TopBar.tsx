import styles from "./dashboard.module.css";

export default function TopBar() {
  return (
    <header className={styles.topBar}>
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
