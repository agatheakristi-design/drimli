"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CornerUpLeft } from "lucide-react";
import Container from "@/app/components/ui/Container";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const isMainDashboard = pathname === "/dashboard";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Container>
        <div className="py-8">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">

            {/* Flèche uniquement si on n'est PAS sur /dashboard */}
            {!isMainDashboard && (
              <div>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition"
                >
                  <CornerUpLeft className="w-6 h-6 dashboard-back-icon stroke-[1.5]" />
                </Link>
              </div>
            )}

            {children}
          </div>
        </div>
      </Container>
    </div>
  );
}
