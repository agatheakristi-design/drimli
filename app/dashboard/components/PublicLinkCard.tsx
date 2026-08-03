"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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

  const needsPublication = !loading && (!slug || !published);
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
              : !slug
                ? "Configurez votre lien public"
                : "Publiez votre page pour rendre le lien accessible"}
          </code>
        )}
      </div>

      <button
        type="button"
        className={styles.copyButton}
        disabled={pending}
        onClick={() => {
          if (needsPublication) {
            router.push("/dashboard/publish");
          } else {
            copy();
          }
        }}
      >
        {pending
          ? "Chargement…"
          : needsPublication
            ? "Gérer la publication"
            : "Copier le lien"}
      </button>
    </div>
  );
}
