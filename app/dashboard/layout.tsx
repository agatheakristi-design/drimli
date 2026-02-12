import type { ReactNode } from "react";
import Container from "@/app/components/ui/Container";
import PublicPageLink from "@/app/components/PublicPageLink";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Container>
        <div className="py-8">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <PublicPageLink />
            {children}
          </div>
        </div>
      </Container>
    </div>
  );
}
