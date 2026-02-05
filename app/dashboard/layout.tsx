import type { ReactNode } from "react";
import Container from "@/app/components/ui/Container";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Container>
        <div className="py-8">{children}</div>
      </Container>
    </div>
  );
}