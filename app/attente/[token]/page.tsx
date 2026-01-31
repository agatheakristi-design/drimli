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
  start_datetime: string | null;
  end_datetime: string | null;
  provider_id: string | null;
  status: string | null;
};

type ProfileRow = {
  provider_id: string;
  full_name: string | null;
  contact_whatsapp: string | null;
  avatar_url?: string | null;
};

function toWhatsAppWaMe(phone: string) {
  // accepte "+33..." ou "06..." → on garde uniquement chiffres
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export default function SalleAttenteDrimcallPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();

  const token = useMemo(() => {
    const raw = params?.token;
    return typeof raw === "string" ? raw : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [appointment, setAppointment] = useState<AppointmentRow | null>(null);
  const [pro, setPro] = useState<ProfileRow | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorText("");
      setToast("");
      setAppointment(null);
      setPro(null);

      if (!token) {
        setErrorText("Lien invalide.");
        setLoading(false);
        return;
      }

      const { data: appt, error: apptErr } = await supabase
        .from("appointments")
        .select("id, join_token, start_datetime, end_datetime, provider_id, status")
        .eq("join_token", token)
        .maybeSingle<AppointmentRow>();

      if (cancelled) return;

      if (apptErr) {
        setErrorText("Erreur chargement : " + apptErr.message);
        setLoading(false);
        return;
      }

      if (!appt) {
        setErrorText("Accès introuvable (lien incorrect ou expiré).");
        setLoading(false);
        return;
      }

      setAppointment(appt);

      if (appt.provider_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("provider_id, full_name, contact_whatsapp, avatar_url")
          .eq("provider_id", appt.provider_id)
          .maybeSingle<ProfileRow>();

        if (!cancelled) setPro(profile ?? null);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  function notifyPro() {
    setToast("");

    const phone = pro?.contact_whatsapp;
    if (!phone) {
      setToast("Le professionnel n’a pas encore configuré son contact WhatsApp.");
      return;
    }

    const base = toWhatsAppWaMe(phone);
    if (!base) {
      setToast("Numéro WhatsApp invalide.");
      return;
    }

    // Message très simple, sans techno
    const msg = `Bonjour, je suis dans la salle d’attente Drimcall pour notre rendez-vous.`;
    const url = `${base}?text=${encodeURIComponent(msg)}`;

    window.location.href = url;
  }

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
            <h1 className="text-2xl font-black">Salle d’attente Drimcall</h1>
            <p className="text-muted-foreground">
              {pro?.full_name ? pro.full_name : "Votre professionnel"}
            </p>
            <p className="text-muted-foreground">En consultation — vous serez rejoint(e)</p>
          </div>

          <Button onClick={notifyPro}>Prévenir le professionnel</Button>

          <p className="text-xs text-muted-foreground">
            Le professionnel vous rejoint dès qu’il est disponible.
          </p>

          {toast ? <p className="text-sm">{toast}</p> : null}
        </div>
      </Card>
    </Container>
  );
}
