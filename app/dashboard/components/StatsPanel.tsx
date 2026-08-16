"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Eye, Star } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type PageViewRow = {
  views: number | string | null;
};

export default function StatsPanel() {
  const [sales, setSales] = useState(0);
  const [revenueCents, setRevenueCents] = useState(0);
  const [views, setViews] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      const accessToken = data.session?.access_token;

      if (!user || !accessToken) return;

      const { data: pageViews } = await supabase
        .from("professional_page_views_daily")
        .select("views")
        .eq("provider_id", user.id);

      const viewTotal = ((pageViews ?? []) as PageViewRow[]).reduce(
        (total, row) => {
          const value = Number(row.views);
          return total + (Number.isFinite(value) ? value : 0);
        },
        0
      );

      if (!cancelled) {
        setViews(viewTotal);
      }

      const response = await fetch("/api/dashboard/stats", { headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json().catch(() => null);
      if (!cancelled) {
        setRevenueCents(response.ok ? Number(payload?.grossRevenue || 0) : 0);
        setSales(response.ok ? Number(payload?.salesCount || 0) : 0);
      }
    }

    loadStats();

    return () => {
      cancelled = true;
    };
  }, []);

  const formattedRevenue = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(revenueCents / 100);

  return (
    <aside className={styles.statsPanel}>
      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Vues</span>
        <strong className={styles.statsValue}>
          {views.toLocaleString("fr-FR")}
        </strong>
        <span className={styles.statsDelta}>
          <Eye size={14} />
          Depuis votre inscription
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Rendez-vous</span>
        <strong className={styles.statsValue}>{sales}</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          Depuis votre inscription
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Revenus</span>
        <strong className={styles.statsValue}>{formattedRevenue}</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          Depuis votre inscription
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Avis Google</span>
        <strong className={styles.statsValue}>DRIMLI Pro</strong>
        <span className={styles.statsDelta}>
          <Star size={14} />
          Bientôt disponible
        </span>
      </div>
    </aside>
  );
}
