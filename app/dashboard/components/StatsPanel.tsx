"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Eye, Star } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type AppointmentRow = {
  product_id: string | null;
};

type ProductRow = {
  id: string;
  price_cents: number | null;
};

type PageViewRow = {
  views: number | string | null;
};

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function StatsPanel() {
  const [reservations, setReservations] = useState(0);
  const [revenueCents, setRevenueCents] = useState(0);
  const [views, setViews] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;

      if (!user) return;

      const now = new Date();

      const monthStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      ).toISOString();

      const nextMonthStart = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1
      ).toISOString();

      const monthStartDate = toDateKey(
        new Date(now.getFullYear(), now.getMonth(), 1)
      );
      const nextMonthStartDate = toDateKey(
        new Date(now.getFullYear(), now.getMonth() + 1, 1)
      );

      const { data: pageViews } = await supabase
        .from("professional_page_views_daily")
        .select("views")
        .eq("provider_id", user.id)
        .gte("view_date", monthStartDate)
        .lt("view_date", nextMonthStartDate);

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

      const { count } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", user.id)
        .eq("status", "confirmed")
        .gte("start_datetime", now.toISOString());

      if (!cancelled) {
        setReservations(count ?? 0);
      }

      const { data: appointments } = await supabase
        .from("appointments")
        .select("product_id")
        .eq("provider_id", user.id)
        .eq("status", "confirmed")
        .gte("start_datetime", monthStart)
        .lt("start_datetime", nextMonthStart);

      const appointmentRows = (appointments ?? []) as AppointmentRow[];

      const productIds = Array.from(
        new Set(
          appointmentRows
            .map((appointment) => appointment.product_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (productIds.length === 0) {
        if (!cancelled) setRevenueCents(0);
        return;
      }

      const { data: products } = await supabase
        .from("products")
        .select("id, price_cents")
        .in("id", productIds);

      const priceByProduct = new Map(
        ((products ?? []) as ProductRow[]).map((product) => [
          product.id,
          product.price_cents ?? 0,
        ])
      );

      const total = appointmentRows.reduce((sum, appointment) => {
        if (!appointment.product_id) return sum;

        return sum + (priceByProduct.get(appointment.product_id) ?? 0);
      }, 0);

      if (!cancelled) {
        setRevenueCents(total);
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
          Ce mois-ci
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Réservations</span>
        <strong className={styles.statsValue}>{reservations}</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          À venir
        </span>
      </div>

      <div className={styles.statsCard}>
        <span className={styles.statsLabel}>Revenus</span>
        <strong className={styles.statsValue}>{formattedRevenue}</strong>
        <span className={styles.statsDelta}>
          <ArrowUpRight size={14} />
          Ce mois-ci
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
