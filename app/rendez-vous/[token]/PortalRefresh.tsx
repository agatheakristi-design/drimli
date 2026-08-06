"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { JoinWindowState } from "@/lib/video/joinWindow";

export default function PortalRefresh({
  state,
  opensAt,
  closesAt,
}: {
  state: JoinWindowState;
  opensAt: number;
  closesAt: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const boundary = state === "early" ? opensAt : state === "open" ? closesAt + 1_000 : null;
    if (boundary === null) return;

    const delay = Math.min(
      2_147_000_000,
      Math.max(0, boundary - Date.now())
    );
    const timeout = window.setTimeout(() => router.refresh(), delay);
    return () => window.clearTimeout(timeout);
  }, [closesAt, opensAt, router, state]);

  return null;
}
