import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/app/components/ui/Logo";
import styles from "./PublicFlowShell.module.css";

export default function PublicFlowShell({ children, transparentHeader = false }: { children: ReactNode; transparentHeader?: boolean }) {
  return (
    <div className={styles.shell}>
      <header className={`${styles.header} ${transparentHeader ? styles.transparentHeader : ""}`}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Drimli — Accueil">
            <Logo />
          </Link>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
