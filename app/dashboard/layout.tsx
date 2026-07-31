"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CornerUpLeft } from "lucide-react";
import Container from "@/app/components/ui/Container";
import DashboardGate from "@/app/components/DashboardGate";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMainDashboard = pathname === "/dashboard";

  if (isMainDashboard) {
    return <DashboardGate>{children}</DashboardGate>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Container>
        <div className="py-8">
          <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div>
              <Link
                href="/dashboard"
                className="inline-flex items-center text-muted-foreground transition hover:text-foreground"
              >
                <CornerUpLeft className="dashboard-back-icon h-6 w-6 stroke-[1.5]" />
              </Link>
            </div>

            <DashboardGate>{children}</DashboardGate>
          </div>
        </div>
      </Container>
    </div>
  );
}
