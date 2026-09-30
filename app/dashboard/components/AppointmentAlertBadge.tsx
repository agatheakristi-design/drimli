"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import styles from "./dashboard.module.css";

type EventReference = { event_id: string; kind: string };

export default function AppointmentAlertBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    // Acknowledge once on entry, never every poll while the calendar stays open.
    let acknowledgeEntry = pathname === "/dashboard/calendrier";

    async function refresh() {
      if (busy || cancelled) return;
      busy = true;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token || cancelled) return;
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const read = async (): Promise<EventReference[]> => {
          const response = await fetch("/api/dashboard/appointment-alerts", { headers, cache: "no-store" });
          if (!response.ok) throw new Error("Notifications indisponibles");
          return (await response.json()).events;
        };
        let events = await read();
        if (cancelled) return;
        setCount(events.length);
        if (acknowledgeEntry) {
          // Capture identities once. Events arriving during/after this operation
          // must remain unseen, including a different kind on the same appointment.
          acknowledgeEntry = false;
          for (let i = 0; i < events.length; i += 1000) {
            if (cancelled) return;
            const response = await fetch("/api/dashboard/appointment-alerts", {
              method: "POST", headers, body: JSON.stringify({ events: events.slice(i, i + 1000) }),
            });
            if (!response.ok) throw new Error("Lecture non enregistrée");
          }
          if (events.length) events = await read();
          if (!cancelled) setCount(events.length);
        }
      } catch {
        // Keep the last known badge on failure; never silently mark it read.
      } finally {
        busy = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  return count > 0 ? (
    <span className={styles.appointmentAlertBadge} role="status" aria-label={`${count} événements de rendez-vous non vus`}>
      {count > 9 ? "9+" : count}
    </span>
  ) : null;
}
