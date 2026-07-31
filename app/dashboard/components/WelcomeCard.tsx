import styles from "./dashboard.module.css";

type WelcomeCardProps = {
  fullName: string;
};

export default function WelcomeCard({ fullName }: WelcomeCardProps) {
  return (
    <section className={styles.welcomeCard}>
      <div className={styles.welcomeCopy}>
        <p className={styles.eyebrow}>Bonjour</p>

        <h1 className={styles.welcomeTitle}>{fullName}.</h1>

        <p className={styles.welcomeText}>
          Votre <strong>page Drimli</strong> est en ligne.
        </p>
      </div>

      <div className={styles.heroActions}>
        <button className={styles.primaryButton}>
          Partager ma page
        </button>

        <button className={styles.textButton}>
          Aperçu
        </button>
      </div>
    </section>
  );
}
