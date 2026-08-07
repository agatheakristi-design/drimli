"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { JoinWindowState } from "@/lib/video/joinWindow";
import type { VideoRoomStatus } from "@/lib/video/types";

export default function PortalRefresh({
  state,
  opensAt,
  closesAt,
  roomStatus,
}: {
  state: JoinWindowState;
  opensAt: number;
  closesAt: number;
  roomStatus: VideoRoomStatus;
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
    const polling =
      state === "open" && roomStatus !== "locked"
        ? window.setInterval(() => router.refresh(), 5_000)
        : null;

    return () => {
      window.clearTimeout(timeout);
      if (polling !== null) window.clearInterval(polling);
    };
  }, [closesAt, opensAt, roomStatus, router, state]);

  return null;
}
