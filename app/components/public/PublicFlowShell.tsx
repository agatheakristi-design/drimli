import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/app/components/ui/Logo";
import styles from "./PublicFlowShell.module.css";

export default function PublicFlowShell({ children, transparentHeader = false, professionalHeader = false }: { children: ReactNode; transparentHeader?: boolean; professionalHeader?: boolean }) {
  return (
    <div className={`${styles.shell} ${professionalHeader ? styles.professionalPage : ""}`}>
      <header className={`${styles.header} ${transparentHeader ? styles.transparentHeader : ""} ${professionalHeader ? styles.professionalHeader : ""}`}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Drimli — Accueil">
            <Logo />
          </Link>
          {professionalHeader ? (
            <>
              <p className={styles.tagline}>Réservation, paiement, visio, facturation et avis Google — en un seul parcours.</p>
              <Link href="/signup" className={`btn btn-primary ${styles.signup}`}>
                Créer un compte gratuit
              </Link>
            </>
          ) : null}
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      {professionalHeader ? (
        <footer className={styles.footer}>
          <span>Powered by</span>
          <Logo className={styles.footerLogo} />
        </footer>
      ) : null}
    </div>
  );
}
