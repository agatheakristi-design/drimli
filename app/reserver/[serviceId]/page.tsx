"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import styles from "./page.module.css";

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

type ProfileRow = {
  full_name: string | null;
  profession: string | null;
  description: string | null;
  avatar_url: string | null;
  cancellation_policy: "flexible" | "moderate" | "non_refundable" | null;
};

function cancellationPolicyLabel(policy: ProfileRow["cancellation_policy"]) {
  if (policy === "moderate") return "Remboursement possible jusqu’à 48 h avant le rendez-vous";
  if (policy === "non_refundable") return "Réservation non remboursable après paiement";
  return "Remboursement possible jusqu’à 24 h avant le rendez-vous";
}

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
  const params = useParams<{ serviceId: string }>();
  const serviceId = useMemo(() => {
    const raw = params?.serviceId;
    return typeof raw === "string" ? raw : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [service, setService] = useState<ServiceRow | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [errorText, setErrorText] = useState("");

  const [date, setDate] = useState(""); // YYYY-MM-DD
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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

  async function loadSlotsForService(
    serviceRow: ServiceRow,
    selectedDate: string,
    preferredSlot: Slot | null = null
  ) {
    setSlotsLoading(true);
    setErrorText("");
    setSlots([]);
    setSelectedSlot(null);

    try {
      const url = `/api/slots?providerId=${encodeURIComponent(serviceRow.provider_id)}&serviceId=${encodeURIComponent(
        serviceRow.id
      )}&date=${encodeURIComponent(selectedDate)}`;

      const res = await fetch(url);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorText(json?.error || "❌ Erreur chargement des créneaux");
        setSlotsLoading(false);
        return;
      }

      const availableSlots = Array.isArray(json) ? (json as Slot[]) : [];
      setSlots(availableSlots);

      if (preferredSlot) {
        const availablePreferredSlot = availableSlots.find(
          (slot) =>
            slot.start === preferredSlot.start && slot.end === preferredSlot.end
        );
        setSelectedSlot(availablePreferredSlot ?? null);
      }

      setSlotsLoading(false);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error
          ? error.message
          : "❌ Erreur chargement des créneaux"
      );
      setSlotsLoading(false);
    }
  }

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

      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, profession, description, avatar_url, cancellation_policy")
        .eq("provider_id", data.provider_id)
        .maybeSingle<ProfileRow>();

      if (cancelled) return;

      setProfile(profileData ?? null);

      const query = new URLSearchParams(window.location.search);
      const requestedDate = query.get("date") ?? "";
      const requestedStart = query.get("start") ?? "";
      const requestedEnd = query.get("end") ?? "";

      if (requestedDate) {
        setDate(requestedDate);
        await loadSlotsForService(
          data,
          requestedDate,
          requestedStart && requestedEnd
            ? { start: requestedStart, end: requestedEnd }
            : null
        );
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  async function loadSlots(selectedDate: string) {
    if (!service) return;
    await loadSlotsForService(service, selectedDate);
  }

 async function createPendingAppointment(slot: Slot) {
  if (!service) return null;

  const trimmedFirstName = firstName.trim();
  const trimmedLastName = lastName.trim();
  const clientName = `${trimmedFirstName} ${trimmedLastName}`.trim();

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
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
        client_name: clientName,
        clientEmail: clientEmail.trim(),
        clientPhone: clientPhone.trim(),
      }),

    });

    const json = await res.json().catch(() => null);
    setCreating(false);

    if (!res.ok) {
      if (json?.code === "SLOT_NO_LONGER_AVAILABLE") {
        setSelectedSlot(null);

        if (date) {
          await loadSlots(date);
        }

        setErrorText(
          json.error ||
            "Ce créneau vient d’être réservé. Choisissez-en un autre."
        );
        return null;
      }

      setErrorText(
        "❌ Erreur création rendez-vous : " +
          (json?.error || "unknown")
      );
      return null;
    }

    return json?.id ?? null;
  } catch (error: unknown) {
    setCreating(false);
    setErrorText(
      "❌ Erreur création rendez-vous : " +
        (error instanceof Error ? error.message : "unknown")
    );
    return null;
  }
}

  async function pay() {
    if (!selectedSlot) return;

    if (!firstName.trim()) {
      setErrorText("❌ Merci d’indiquer votre prénom.");
      return;
    }
    if (!lastName.trim()) {
      setErrorText("❌ Merci d’indiquer votre nom.");
      return;
    }
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
      <div className={styles.page}>
        <header className={styles.header}>
          <Container className={styles.headerInner}>Drimli</Container>
        </header>
        <Container className={styles.stateContainer}>
          <Card>Chargement…</Card>
        </Container>
      </div>
    );
  }

  if (errorText && !service) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Container className={styles.headerInner}>Drimli</Container>
        </header>
        <Container className={styles.stateContainer}>
          <Card>{errorText}</Card>
        </Container>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Container className={styles.headerInner}>Drimli</Container>
      </header>

      <Container className={styles.content}>
        <main className={styles.layout}>
          <section className={styles.professional} aria-label="Professionnel">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className={styles.avatar}
                />
              ) : (
                <div className={styles.avatarPlaceholder} aria-hidden="true">
                  {profile?.full_name?.charAt(0) ?? "D"}
                </div>
              )}

              <div className={styles.professionalContent}>
                <h1>{profile?.full_name ?? "Votre professionnel"}</h1>
                {profile?.profession ? (
                  <p className={styles.profession}>{profile.profession}</p>
                ) : null}
                {profile?.description ? (
                  <p className={styles.professionalDescription}>
                    {profile.description}
                  </p>
                ) : null}
              </div>
          </section>

          <section className={styles.formSection}>
              <h2>Renseigner vos informations</h2>

              {!selectedSlot ? (
                <div className={styles.slotPicker}>
                  <div className={styles.field}>
                    <label htmlFor="appointment-date">Choisir une date</label>
                    <input
                      id="appointment-date"
                      className="input"
                      type="date"
                      value={date}
                      min={todayParis}
                      onChange={async (event) => {
                        const selectedDate = event.target.value;
                        setDate(selectedDate);
                        if (selectedDate) await loadSlots(selectedDate);
                      }}
                    />
                  </div>

                  {!date ? (
                    <p className={styles.helper}>Choisissez une date pour voir les créneaux.</p>
                  ) : slotsLoading ? (
                    <p className={styles.helper}>Chargement des créneaux…</p>
                  ) : slots.length === 0 ? (
                    <p className={styles.helper}>Aucun créneau disponible ce jour-là.</p>
                  ) : (
                    <div className={styles.slotGroup}>
                      <p>Sélectionnez un créneau</p>
                      <div className={styles.slots}>
                        {slots.map((slot) => {
                          return (
                            <button
                              key={`${slot.start}-${slot.end}`}
                              type="button"
                              aria-pressed="false"
                              onClick={() => setSelectedSlot(slot)}
                              disabled={creating || paying}
                              className={styles.slot}
                            >
                              {formatParisTime(slot.start)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className={styles.formFields}>
                <fieldset className={styles.nameGroup}>
                  <legend>Nom complet</legend>
                  <div className={styles.nameFields}>
                    <div className={styles.field}>
                      <label htmlFor="first-name">Prénom</label>
                      <input
                        id="first-name"
                        className="input"
                        type="text"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        placeholder="Votre prénom"
                        autoComplete="given-name"
                        required
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="last-name">Nom</label>
                      <input
                        id="last-name"
                        className="input"
                        type="text"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        placeholder="Votre nom"
                        autoComplete="family-name"
                        required
                      />
                    </div>
                  </div>
                </fieldset>

                <div className={styles.field}>
                  <label htmlFor="client-email">Email</label>
                  <input
                    id="client-email"
                    className="input"
                    type="email"
                    value={clientEmail}
                    onChange={(event) => setClientEmail(event.target.value)}
                    placeholder="vous@email.com"
                    autoComplete="email"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="client-phone">Téléphone</label>
                  <input
                    id="client-phone"
                    className="input"
                    type="tel"
                    value={clientPhone}
                    onChange={(event) => setClientPhone(event.target.value)}
                    placeholder="06 12 34 56 78"
                    autoComplete="tel"
                    required
                  />
                </div>
              </div>

              {errorText ? (
                <p className={styles.error} role="alert">{errorText}</p>
              ) : null}
          </section>

          <aside className={styles.summaryColumn} aria-label="Récapitulatif">
            <Card className={styles.summaryCard}>
              <p className={styles.eyebrow}>Récapitulatif</p>

              <div className={styles.dateSummary}>
                <CalendarDays size={18} aria-hidden="true" />
                <span>
                  {selectedSlot
                    ? `${formatParisDate(selectedSlot.start)} · ${formatParisTime(selectedSlot.start)}`
                    : "Créneau à sélectionner"}
                </span>
              </div>

              <div className={styles.serviceSummary}>
                <div>
                  <h2>{service?.title ?? "Prestation"}</h2>
                  <p>{service?.duration_minutes ?? 60} min</p>
                </div>
                <strong>
                  {service?.price_cents != null
                    ? `${service.price_cents / 100} €`
                    : "—"}
                </strong>
              </div>

              <div className={styles.paymentAction}>
                <Button
                  type="button"
                  onClick={pay}
                  disabled={!selectedSlot || creating || paying}
                  className={styles.paymentButton}
                >
                  {paying ? "Redirection vers le paiement…" : "Procéder au paiement"}
                </Button>
              </div>

              <div className={styles.assurances}>
                <p>
                  <ShieldCheck size={18} aria-hidden="true" />
                  Paiement sécurisé
                </p>
                <p>
                  <CalendarDays size={18} aria-hidden="true" />
                  {cancellationPolicyLabel(profile?.cancellation_policy ?? null)}
                </p>
              </div>
            </Card>
          </aside>
        </main>
      </Container>
    </div>
  );
}
