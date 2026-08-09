"use client";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import ServicesManager from "../components/ServicesManager";

export default function ServicesPage() {
  return (
    <Container>
      <Card>
        <ServicesManager />
      </Card>
    </Container>
  );
}
