"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function PublicPageViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    let cancelled = false;

    async function countView() {
      const storageKey = `drimli:public-page-view:${slug}`;
      const attemptId = `pending:${Date.now()}:${Math.random()}`;

      try {
        if (window.sessionStorage.getItem(storageKey)) return;

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        window.sessionStorage.setItem(storageKey, attemptId);

        const response = await fetch("/api/public-page-views", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(data.session?.access_token
              ? { Authorization: `Bearer ${data.session.access_token}` }
              : {}),
          },
          body: JSON.stringify({ slug }),
          keepalive: true,
        });

        if (!response.ok) {
          throw new Error("Page view could not be recorded");
        }

        window.sessionStorage.setItem(storageKey, "counted");
      } catch {
        if (window.sessionStorage.getItem(storageKey) === attemptId) {
          window.sessionStorage.removeItem(storageKey);
        }
        // Analytics must never interfere with the public page experience.
      }
    }

    void countView();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return null;
}
