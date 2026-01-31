"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

function PaiementAnnuleContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const appointmentId = sp.get("appointmentId");

  return (
    <Container>
      <Card>
        <div className="space-y-3">
          <h1 className="text-2xl font-black">Paiement annulé</h1>
          <p className="text-muted-foreground">
            Vous n’avez pas été débité. Vous pouvez réessayer si besoin.
          </p>

          {appointmentId ? (
            <p className="text-sm text-muted-foreground">
              Référence : <span className="font-semibold">{appointmentId}</span>
            </p>
          ) : null}

          <Button onClick={() => router.replace("/")}>Retour</Button>
        </div>
      </Card>
    </Container>
  );
}

export default function PaiementAnnulePage() {
  return (
    <Suspense fallback={null}>
      <PaiementAnnuleContent />
    </Suspense>
  );
}
