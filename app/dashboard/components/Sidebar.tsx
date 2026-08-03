"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Home,
} from "lucide-react";
import LogoutButton from "@/app/components/LogoutButton";
import styles from "./dashboard.module.css";

type SidebarProps = {
  fullName: string;
  email: string;
};

const navigation = [
  {
    label: "Vue d’ensemble",
    href: "/dashboard",
    icon: Home,
  },
  {
    label: "Mes rendez-vous",
    href: "/dashboard/calendrier",
    icon: CalendarDays,
  },
];

function getInitials(fullName: string) {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return initials || "DR";
}

export default function Sidebar({ fullName, email }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <Link href="/dashboard" className={styles.brand}>
        Drimli
      </Link>

      <nav className={styles.navigation} aria-label="Tableau de bord">
        {navigation.map(({ label, href, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);

          return (
            <Link
              key={`${label}-${href}`}
              href={href}
              className={`${styles.navigationItem} ${
                active ? styles.navigationItemActive : ""
              }`}
            >
              <Icon className={styles.navigationIcon} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.account}>
        <div className={styles.accountRow}>
          <div className={styles.accountAvatar}>
            {getInitials(fullName)}
          </div>

          <div className={styles.accountCopy}>
            <strong>{fullName}</strong>
            <span>{email}</span>
          </div>
        </div>

        <div className={styles.signOut}>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
