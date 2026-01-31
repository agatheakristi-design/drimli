"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

function PaiementSuccesContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const sessionId = sp.get("session_id");

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [joinToken, setJoinToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorText("");
      setAppointmentId(null);
      setJoinToken(null);

      if (!sessionId) {
        setErrorText("Session Stripe manquante.");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`);
      const json = await res.json().catch(() => null);

      if (cancelled) return;

      if (!res.ok) {
        setErrorText(json?.error || "Erreur récupération session Stripe.");
        setLoading(false);
        return;
      }

      if (json?.payment_status !== "paid") {
        setErrorText("Paiement non confirmé (statut Stripe : " + (json?.payment_status || "unknown") + ").");
        setLoading(false);
        return;
      }

      const apptId = json?.appointment_id ?? null;
      setAppointmentId(apptId);

      if (apptId) {
        const tRes = await fetch("/api/appointments/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId: apptId }),
        });
        const tJson = await tRes.json().catch(() => null);
        if (tRes.ok && tJson?.join_token) setJoinToken(tJson.join_token);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <Container>
      <Card>
        {loading ? (
          <p>Vérification du paiement…</p>
        ) : errorText ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-black">Une erreur est survenue</h1>
            <p>{errorText}</p>
            <Button variant="secondary" onClick={() => router.replace("/")}>
              Revenir à l’accueil
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <h1 className="text-2xl font-black">Votre rendez-vous est confirmé</h1>
            <p className="text-muted-foreground">
              Vous pourrez retrouver votre salle d’attente à tout moment avec le lien reçu par email.
            </p>

            <Button
              onClick={() => {
                if (joinToken) router.replace(`/attente/${joinToken}`);
              }}
              disabled={!joinToken}
            >
              Entrer dans la salle d’attente
            </Button>

            <button
              className="text-sm underline text-muted-foreground"
              onClick={() => {
                if (joinToken) window.location.href = `/api/appointments/ics?token=${encodeURIComponent(joinToken)}`;
              }}
              disabled={!joinToken as any}
            >
              Ajouter à mon calendrier
            </button>
          </div>
        )}
      </Card>
    </Container>
  );
}

export default function PaiementSuccesPage() {
  return (
    <Suspense fallback={null}>
      <PaiementSuccesContent />
    </Suspense>
  );
}
