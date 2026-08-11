"use client";

import { useState } from "react";
import {
  copyPublicUrl,
  usePublicUrl,
} from "@/app/components/PublicPageLink";
import styles from "./dashboard.module.css";

type PublicLinkCardProps = {
  slug: string | null;
  published: boolean;
  loading: boolean;
};

export default function PublicLinkCard({
  slug,
  published,
  loading,
}: PublicLinkCardProps) {
  const publicUrl = usePublicUrl(slug);
  const [copyStatus, setCopyStatus] = useState("");

  async function copy() {
    if (!publicUrl || !published) return;

    try {
      await copyPublicUrl(publicUrl);
      setCopyStatus("Lien copié");
      window.setTimeout(() => setCopyStatus(""), 1500);
    } catch {
      setCopyStatus("Copie impossible");
    }
  }

  const urlLoading = Boolean(!loading && slug && published && !publicUrl);
  const pending = loading || urlLoading;

  return (
    <div className={styles.linkCard}>
      <div className={styles.linkCopy}>
        <span>
          {pending
            ? "Chargement"
            : !slug
              ? "Page publique"
              : !published
                ? "Page non publiée"
                : "Votre lien — ouvrir ↗"}
        </span>

        {published && publicUrl ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <code>{copyStatus || publicUrl}</code>
          </a>
        ) : (
          <code>
            {pending
              ? "Chargement…"
              : "Votre page publique sera disponible à la fin de l’onboarding"}
          </code>
        )}
      </div>

      <button
        type="button"
        className={styles.copyButton}
        disabled={pending || !published || !publicUrl}
        onClick={copy}
      >
        {pending ? "Chargement…" : "Copier le lien"}
      </button>
    </div>
  );
}
