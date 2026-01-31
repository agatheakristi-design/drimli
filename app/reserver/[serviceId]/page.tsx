"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type ServiceRow = {
  id: string;
  provider_id: string;
  title: string | null;
  description: string | null;
  price_cents: number | null;
  duration_minutes: number | null;
  active: boolean | null;
};

type Slot = { start: string; end: string };

function formatParisTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatParisDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(iso));
}

export default function Page() {
  const params = useParams();
  const serviceId = useMemo(() => {
    const raw = (params as any)?.serviceId;
    return typeof raw === "string" ? raw : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [service, setService] = useState<ServiceRow | null>(null);
  const [errorText, setErrorText] = useState("");

  const [date, setDate] = useState(""); // YYYY-MM-DD
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);
  const todayParis = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date()); // format YYYY-MM-DD

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorText("");
      setService(null);

      if (!serviceId) {
        setErrorText("❌ Missing serviceId in URL.");
        setLoading(false);
        return;
      }

      if (!isUuid(serviceId)) {
        setErrorText(`❌ serviceId is not a UUID: "${serviceId}"`);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("products")
        .select("id, provider_id, title, description, price_cents, duration_minutes, active")
        .eq("id", serviceId)
        .maybeSingle<ServiceRow>();

      if (cancelled) return;

      if (error) {
        setErrorText("❌ Supabase error: " + error.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setErrorText("❌ Service introuvable");
        setLoading(false);
        return;
      }

      if (data.active === false) {
        setErrorText("❌ Ce service n'est pas disponible.");
        setLoading(false);
        return;
      }

      setService(data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  async function loadSlots(selectedDate: string) {
    if (!service) return;

    setSlotsLoading(true);
    setErrorText("");
    setSlots([]);
    setSelectedSlot(null);

    try {
      const url = `/api/slots?providerId=${encodeURIComponent(service.provider_id)}&serviceId=${encodeURIComponent(
        service.id
      )}&date=${encodeURIComponent(selectedDate)}`;

      const res = await fetch(url);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorText(json?.error || "❌ Erreur chargement des créneaux");
        setSlotsLoading(false);
        return;
      }

      setSlots(Array.isArray(json) ? (json as Slot[]) : []);
      setSlotsLoading(false);
    } catch (e: any) {
      setErrorText(e?.message || "❌ Erreur chargement des créneaux");
      setSlotsLoading(false);
    }
  }

 async function createPendingAppointment(slot: Slot) {
  if (!service) return null;

  setCreating(true);
  setErrorText("");

  try {
    const res = await fetch("/api/appointments/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: service.provider_id,
        productId: service.id,
        start: slot.start,
        end: slot.end,
        clientEmail: clientEmail.trim(),
        clientPhone: clientPhone.trim(),
      }),

    });

    const json = await res.json().catch(() => null);
    setCreating(false);

    if (!res.ok) {
      setErrorText("❌ Erreur création rendez-vous : " + (json?.error || "unknown"));
      return null;
    }

    return json?.id ?? null;
  } catch (e: any) {
    setCreating(false);
    setErrorText("❌ Erreur création rendez-vous : " + (e?.message || "unknown"));
    return null;
  }
}

  async function pay() {
    if (!selectedSlot) return;

    if (!clientEmail.trim()) {
      setErrorText("❌ Merci d’indiquer votre email.");
      return;
    }
    if (!clientPhone.trim()) {
      setErrorText("❌ Merci d’indiquer votre téléphone.");
      return;
    }

    setPaying(true);
    setErrorText("");

    // 1) Create appointment pending (DB prevents overlap)
    const appointmentId = await createPendingAppointment(selectedSlot);
    if (!appointmentId) {
      setPaying(false);
      return;
    }

    // 2) Create checkout session & redirect
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appointmentId }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.url) {
      setErrorText(json?.error || "❌ Erreur paiement");
      setPaying(false);
      return;
    }

    window.location.href = json.url;
  }

  if (loading) {
    return (
      <Container>
        <Card>Chargement…</Card>
      </Container>
    );
  }

  if (errorText && !service) {
    return (
      <Container>
        <Card>{errorText}</Card>
      </Container>
    );
  }

  return (
    <Container>
      <Card>
        <div className="space-y-2">
          <h1 className="text-2xl font-black">{service?.title ?? "Réserver"}</h1>
          {service?.description ? (
            <p className="text-muted-foreground">{service.description}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {service?.duration_minutes ?? 60} min •{" "}
            {service?.price_cents != null ? `${service.price_cents / 100} €` : "—"}
          </p>
        </div>
      </Card>

      <div className="h-4" />

      <Card>
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Pour recevoir votre lien de connexion</p>
              <input
                className="w-full rounded-xl border border-border bg-background px-4 py-3"
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="Votre email"
                required
              />
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Pour accéder à votre rendez-vous</p>
              <input
                className="w-full rounded-xl border border-border bg-background px-4 py-3"
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="Votre téléphone"
                required
              />
            </div>
          </div>

          <div>
            <p className="font-extrabold">Choisir une date</p>
            <input
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3"
              type="date"
              value={date}
              min={todayParis}
              onChange={async (e) => {
                const d = e.target.value;
                setDate(d);
                if (d) await loadSlots(d);
              }}
            />
          </div>

          {!date ? (
            <p className="text-sm text-muted-foreground">
              Choisis une date pour voir les créneaux.
            </p>
          ) : slotsLoading ? (
            <p>Chargement des créneaux…</p>
          ) : slots.length === 0 ? (
            <p>Aucun créneau disponible ce jour-là.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {selectedSlot
                  ? `Sélectionné : ${formatParisDate(selectedSlot.start)} à ${formatParisTime(selectedSlot.start)}`
                  : "Sélectionne un créneau"}
              </p>

              <div className="flex flex-wrap gap-2">
                {slots.map((s, idx) => {
                  const selected = selectedSlot?.start === s.start;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedSlot(s)}
                      disabled={creating || paying}
                      className={[
                        "rounded-xl border px-4 py-2 font-extrabold",
                        selected ? "border-black" : "border-border",
                      ].join(" ")}
                    >
                      {formatParisTime(s.start)}
                    </button>
                  );
                })}
              </div>

              <Button
  onClick={pay}
  disabled={!selectedSlot || creating || paying}
  className="w-full"
>
  {paying ? "Redirection vers le paiement…" : "Payer et confirmer"}
</Button>
            </div>
          )}

          {errorText ? <p>{errorText}</p> : null}
        </div>
      </Card>
    </Container>
  );
}