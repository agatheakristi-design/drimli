import styles from "./dashboard.module.css";

type PublicLinkCardProps = {
  slug: string;
};

export default function PublicLinkCard({ slug }: PublicLinkCardProps) {
  return (
    <div className={styles.linkCard}>
      <div className={styles.linkCopy}>
        <span>Votre lien</span>

        <code>
          drimli.app/{slug}
        </code>
      </div>

      <button className={styles.copyButton}>
        Copier le lien
      </button>
    </div>
  );
}
