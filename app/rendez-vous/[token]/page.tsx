"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

type AppointmentRow = {
  id: string;
  join_token: string | null;
  status: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
  provider_id: string | null;
};

type ProfileRow = {
  provider_id: string;
  full_name: string | null;
};

function formatDateTimeParis(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function RendezVousTokenPage() {
  const router = useRouter();
  const params = useParams();

  const token = useMemo(() => {
    const raw = (params as any)?.token;
    return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [appointment, setAppointment] = useState<AppointmentRow | null>(null);
  const [proName, setProName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorText("");
      setAppointment(null);
      setProName(null);

      if (!token) {
        setErrorText("Lien invalide.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("appointments")
        .select("id, join_token, status, start_datetime, end_datetime, provider_id")
        .eq("join_token", token)
        .maybeSingle<AppointmentRow>();

      if (cancelled) return;

      if (error) {
        setErrorText("Erreur chargement : " + error.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setErrorText("Rendez-vous introuvable (lien expiré ou incorrect).");
        setLoading(false);
        return;
      }

      setAppointment(data);

      if (data.provider_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("provider_id", data.provider_id)
          .maybeSingle<ProfileRow>();

        if (!cancelled) setProName(profile?.full_name ?? null);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <Container>
        <Card>
          <p>Chargement…</p>
        </Card>
      </Container>
    );
  }

  if (errorText) {
    return (
      <Container>
        <Card>
          <div className="space-y-3">
            <h1 className="text-2xl font-black">Drimcall</h1>
            <p>{errorText}</p>
            <Button variant="secondary" onClick={() => router.push("/")}>
              Retour
            </Button>
          </div>
        </Card>
      </Container>
    );
  }

  return (
    <Container>
      <Card>
        <div className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black">Drimcall</h1>
            {proName ? (
              <p className="text-muted-foreground">Votre rendez-vous avec {proName}</p>
            ) : (
              <p className="text-muted-foreground">Votre rendez-vous</p>
            )}
            <p className="text-sm text-muted-foreground">
              {formatDateTimeParis(appointment?.start_datetime)}
            </p>
          </div>

          <Button onClick={() => router.push(`/attente/${encodeURIComponent(token)}`)}>
            Entrer dans la salle d’attente
          </Button>

          <p className="text-xs text-muted-foreground">
            Le professionnel vous rejoint dès qu’il est disponible.
          </p>

          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).catch(() => {});
            }}
          >
            Copier le lien
          </Button>
        </div>
      </Card>
    </Container>
  );
}
