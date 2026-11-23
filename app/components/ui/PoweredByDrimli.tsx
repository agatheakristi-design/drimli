"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import Logo from "./Logo";
import styles from "./PoweredByDrimli.module.css";

export default function PoweredByDrimli({ withinPublicFlow = false }: { withinPublicFlow?: boolean }) {
  const pathname = usePathname();
  const params = useParams();

  if (!pathname || pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return null;

  // PublicFlowShell places the same signature inside its existing page background.
  // The root layout covers all other pages, including authentication and the client portal.
  const hasPublicFlow = typeof params.slug === "string" || pathname.startsWith("/reserver/");
  if (!withinPublicFlow && hasPublicFlow) return null;

  return (
    <footer className={styles.footer}>
      <Link href="/" className={styles.link} aria-label="Powered by Drimli — Accueil">
        <span>Powered by</span>
        <Logo className={styles.logo} />
      </Link>
    </footer>
  );
}
