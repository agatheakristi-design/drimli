import styles from "./dashboard.module.css";

type WelcomeCardProps = {
  fullName: string;
  slug?: string | null;
  published?: boolean;
};

export default function WelcomeCard({ fullName, slug, published = false }: WelcomeCardProps) {
  const firstName =
    !fullName || fullName === "Professionnel"
      ? ""
      : fullName.split(" ")[0];

  return (
    <section className={styles.welcomeCard}>
      <div className={styles.welcomeCopy}>
        <p className={styles.eyebrow}>Hello</p>

        <h1 className={styles.welcomeTitle}>
          {firstName ? `${firstName}.` : ""}
        </h1>

        <p className={styles.welcomeText}>
          {slug && published ? (
            <a href={`/${slug}`} target="_blank" rel="noreferrer">
              Voir ma <strong>page Drimli</strong> en ligne
            </a>
          ) : (
            <>Voir ma <strong>page Drimli</strong> en ligne</>
          )}
        </p>
      </div>

      <div className={styles.heroActions}>
        <button className={styles.primaryButton}>
          Partager ma page
        </button>

      </div>
    </section>
  );
}