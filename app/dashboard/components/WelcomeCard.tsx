"use client";

import { useState } from "react";
import styles from "./dashboard.module.css";

type WelcomeCardProps = {
  fullName: string;
  slug?: string | null;
  published?: boolean;
};

export default function WelcomeCard({ fullName, slug, published = false }: WelcomeCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const pageUrl = slug && published
    ? `https://www.drimli.io/${encodeURIComponent(slug)}`
    : "";

  const shareMessage =
    `Bonjour, vous pouvez consulter mes prestations et réserver directement un rendez-vous sur ma page DRIMLI : ${pageUrl}`;

  async function sharePage() {
    if (!pageUrl) return;

    if (typeof navigator.share === "function" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      try {
        await navigator.share({
          title: "Ma page DRIMLI",
          text: "Découvrez mes prestations et réservez un rendez-vous.",
          url: pageUrl,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    setShareOpen((current) => !current);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      window.prompt("Copiez le lien de votre page :", pageUrl);
    }
  }

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
        <button
          type="button"
          className={styles.primaryButton}
          onClick={sharePage}
          disabled={!pageUrl}
          aria-expanded={shareOpen}
          aria-controls="dashboard-share-options"
        >
          Partager ma page
        </button>

        {shareOpen && pageUrl && (
          <div
            id="dashboard-share-options"
            className={styles.shareMenu}
            role="group"
            aria-label="Options de partage"
          >
            <button type="button" className={styles.shareOption} onClick={copyLink}>
              <span className={styles.taskIcon} aria-hidden="true">
                <ShareIcon type="link" />
              </span>
              <span>{copied ? "Lien copié !" : "Copier le lien"}</span>
            </button>

            <a
              className={styles.shareOption}
              href={`mailto:?subject=${encodeURIComponent("Découvrez ma page DRIMLI")}&body=${encodeURIComponent(shareMessage)}`}
            >
              <span className={styles.taskIcon} aria-hidden="true">
                <ShareIcon type="mail" />
              </span>
              <span>Partager par email</span>
            </a>

            <a
              className={styles.shareOption}
              href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={styles.taskIcon} aria-hidden="true">
                <ShareIcon type="whatsapp" />
              </span>
              <span>Partager sur WhatsApp</span>
            </a>
          </div>
        )}

      </div>
    </section>
  );
}

function ShareIcon({ type }: { type: "link" | "mail" | "whatsapp" }) {
  const paths = {
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></>,
    mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 6 10 7 10-7" /></>,
    whatsapp: <><path d="M21 11.5a9 9 0 0 1-13.3 7.9L3 21l1.6-4.7A9 9 0 1 1 21 11.5Z" /><path d="M8.5 8.5c.5 3 3 5.5 6 6l1.5-1.5" /></>,
  };

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}
