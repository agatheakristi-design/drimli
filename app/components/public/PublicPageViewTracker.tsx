"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function PublicPageViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    let cancelled = false;

    async function countView() {
      try {
        const storageKey = `drimli:public-page-view:${slug}`;
        if (window.sessionStorage.getItem(storageKey)) return;

        const { data } = await supabase.auth.getSession();
        if (cancelled || data.session?.user) return;

        window.sessionStorage.setItem(storageKey, "1");

        await fetch("/api/public-page-views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
          keepalive: true,
        });
      } catch {
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
