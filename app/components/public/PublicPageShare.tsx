"use client";

import { useId } from "react";
import { Link, Mail, MessageCircle, Share } from "lucide-react";
import { usePageShare } from "@/app/components/usePageShare";
import dashboardStyles from "@/app/dashboard/components/dashboard.module.css";
import styles from "./PublicPageShare.module.css";

export default function PublicPageShare({ slug }: { slug: string }) {
  const { pageUrl, shareMessage, shareOpen, copied, sharePage, copyLink } = usePageShare(slug, true);
  const menuId = useId();

  return (
    <div className={styles.row}>
      <div className={styles.actions}>
        <button type="button" className={`btn btn-secondary ${styles.button}`} onClick={sharePage}
          aria-expanded={shareOpen} aria-controls={menuId}>
          <Share size={16} aria-hidden="true" />
          Partager
        </button>
        {shareOpen && pageUrl ? (
          <div id={menuId} className={dashboardStyles.shareMenu} role="group" aria-label="Options de partage">
            <button type="button" className={dashboardStyles.shareOption} onClick={copyLink}>
              <span className={dashboardStyles.taskIcon} aria-hidden="true"><Link size={20} /></span>
              <span>{copied ? "Lien copié !" : "Copier le lien"}</span>
            </button>
            <a className={dashboardStyles.shareOption}
              href={`mailto:?subject=${encodeURIComponent("Découvrez ma page DRIMLI")}&body=${encodeURIComponent(shareMessage)}`}>
              <span className={dashboardStyles.taskIcon} aria-hidden="true"><Mail size={20} /></span>
              <span>Partager par email</span>
            </a>
            <a className={dashboardStyles.shareOption} href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
              target="_blank" rel="noopener noreferrer">
              <span className={dashboardStyles.taskIcon} aria-hidden="true"><MessageCircle size={20} /></span>
              <span>Partager sur WhatsApp</span>
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
