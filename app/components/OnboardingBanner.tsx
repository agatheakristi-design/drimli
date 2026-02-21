"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status = {
  profileComplete: boolean;
  paymentComplete: boolean;
  servicesComplete: boolean;
  availabilityComplete: boolean;
  doneCount: number;
  total: number;
  accountReady: boolean;
  next: string;
};

export default function OnboardingBanner() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const r = await fetch("/api/onboarding/status", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as Status;
      if (!cancelled) setStatus(j);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  if (status.accountReady) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-black text-base">⚠️ Configuration incomplète</p>
          <p className="text-sm text-muted-foreground">
            {status.doneCount}/{status.total} étapes terminées — termine pour que les clients puissent réserver.
          </p>
        </div>

        <Link
          href={status.next}
          className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition"
        >
          Compléter maintenant
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-border px-3 py-1">
          {status.profileComplete ? "✅" : "⏳"} Profil
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          {status.paymentComplete ? "✅" : "⏳"} Paiement
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          {status.servicesComplete ? "✅" : "⏳"} Services
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          {status.availabilityComplete ? "✅" : "⏳"} Disponibilités
        </span>
      </div>
    </div>
  );
}
