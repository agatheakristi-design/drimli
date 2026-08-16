"use client";

import { useEffect, useState } from "react";
import Button from "@/app/components/ui/Button";
import { supabase } from "@/lib/supabaseClient";
import type { CalendarAppointment } from "./types";
import type { VideoRoomStatus } from "@/lib/video/types";
import styles from "./calendar.module.css";
import { cancellationRefundAmount } from "@/lib/billing";

type AppointmentDetailsProps = {
  appointment: CalendarAppointment;
  onAppointmentChanged?: () => void;
};

type BillingDetails = {
  payment: null | { amount_paid: number; application_fee_amount: number; refunded_amount: number; professional_amount: number; currency: string; status: string };
  invoice: null | { invoice_number: string; download_url: string | null };
  refunds: Array<{ id: string; amount: number; currency: string; status: string; credit_note: null | { credit_note_number: string; download_url: string | null } }>;
  cancellation_policy: "flexible" | "moderate" | "non_refundable" | null;
  cancellation_refund_deadline_hours: number | null;
};

function cancellationLabel(policy: BillingDetails["cancellation_policy"]) {
  if (policy === "moderate") return "remboursement possible jusqu’à 48 h avant le rendez-vous.";
  if (policy === "non_refundable") return "la réservation n’est pas remboursable après paiement.";
  return "remboursement possible jusqu’à 24 h avant le rendez-vous.";
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount / 100);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function videoLabel(provider: string | null, joinUrl: string | null) {
  if (!joinUrl) return "Indisponible";
  if (provider === "google_meet") return "Google Meet prête";
  return "Visioconférence prête";
}

function appointmentStatusLabel(status: CalendarAppointment["status"]) {
  return status === "confirmed" ? "Confirmé" : "Annulé";
}

export default function AppointmentDetails({
  appointment,
  onAppointmentChanged,
}: AppointmentDetailsProps) {
  const [roomStatus, setRoomStatus] = useState(appointment.videoRoomStatus);
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [billing, setBilling] = useState<BillingDetails | null>(null);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [partialRefund, setPartialRefund] = useState("");

  useEffect(() => {
    setRoomStatus(appointment.videoRoomStatus);
    setMeetingStarted(false);
    setStatusMessage("");
  }, [appointment.id, appointment.videoRoomStatus]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token;
      if (!accessToken) return;
      const response = await fetch(`/api/appointments/${encodeURIComponent(appointment.id)}/billing`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json().catch(() => null);
      if (!cancelled) setBilling(response.ok ? payload : null);
    });
    return () => { cancelled = true; };
  }, [appointment.id]);

  function openProfessionalMeeting() {
    if (!appointment.videoJoinUrl) return;
    window.open(appointment.videoJoinUrl, "_blank", "noopener,noreferrer");
    setMeetingStarted(true);
  }

  async function updateRoomStatus(nextStatus: VideoRoomStatus) {
    setUpdating(true);
    setStatusMessage("");

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Session expirée.");

      const response = await fetch(
        `/api/appointments/${encodeURIComponent(appointment.id)}/video-room`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const payload = (await response.json()) as {
        status?: VideoRoomStatus;
        error?: string;
      };

      if (!response.ok || !payload.status) {
        throw new Error(payload.error || "Mise à jour impossible.");
      }

      setRoomStatus(payload.status);
      setStatusMessage(
        payload.status === "open"
          ? "La salle est ouverte aux clients."
          : "L’accès vidéo est verrouillé."
      );
      onAppointmentChanged?.();
    } catch (error: unknown) {
      setStatusMessage(
        error instanceof Error ? error.message : "Mise à jour impossible."
      );
    } finally {
      setUpdating(false);
    }
  }

  async function cancelAppointment(refund: "full" | "partial" | "none") {
    if (!billing?.payment) return;
    setUpdating(true);
    setStatusMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Session expirée.");

      if (refund !== "none") {
        const requestedAmount = refund === "partial"
          ? Math.round(Number(partialRefund.replace(",", ".")) * 100)
          : undefined;
        const remaining = billing.payment.amount_paid - billing.payment.refunded_amount;
        let amountCents: number | null;
        try { amountCents = cancellationRefundAmount(refund, remaining, requestedAmount); }
        catch { throw new Error("Indiquez un montant partiel valide."); }
        const response = await fetch("/api/stripe/refund", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId: appointment.id, ...(refund === "partial" ? { amountCents } : {}) }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Remboursement impossible.");
      }

      if (refund === "none") {
        const { error } = await supabase
          .from("appointments")
          .update({ status: "cancelled_by_provider" })
          .eq("id", appointment.id);
        if (error) throw error;
      }
      setStatusMessage(refund === "none" ? "Rendez-vous annulé sans remboursement." : "Rendez-vous annulé et remboursement effectué.");
      setCancellationOpen(false);
      onAppointmentChanged?.();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Annulation impossible.");
    } finally {
      setUpdating(false);
    }
  }

  const roomLabel =
    roomStatus === "closed"
      ? "Salle fermée"
      : roomStatus === "open"
        ? "Salle ouverte"
        : "Accès vidéo verrouillé";

  return (
    <section className={styles.appointmentDetails}>
      <header className={styles.appointmentDetailsHeader}>
        <span className={styles.appointmentEyebrow}>Rendez-vous</span>
        <h3>{appointment.serviceName}</h3>
        <p>{appointment.clientName}</p>
      </header>

      <dl className={styles.appointmentDetailsList}>
        <div className={styles.appointmentDetailsRow}>
          <dt>Date</dt>
          <dd>{formatDate(appointment.start_datetime)}</dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Horaire</dt>
          <dd>
            {formatTime(appointment.start_datetime)} –{" "}
            {formatTime(appointment.end_datetime)}
          </dd>
        </div>
        {appointment.clientEmail ? (
          <div className={styles.appointmentDetailsRow}>
            <dt>Email</dt>
            <dd>{appointment.clientEmail}</dd>
          </div>
        ) : null}
        <div className={styles.appointmentDetailsRow}>
          <dt>Statut</dt>
          <dd>{appointmentStatusLabel(appointment.status)}</dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Paiement</dt>
          <dd>Payé</dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Visio</dt>
          <dd>
            {videoLabel(
              appointment.videoProvider,
              appointment.videoJoinUrl
            )}
          </dd>
        </div>
        <div className={styles.appointmentDetailsRow}>
          <dt>Salle client</dt>
          <dd>{roomLabel}</dd>
        </div>
      </dl>

      {billing?.payment && appointment.status === "confirmed" ? (
        <div className={styles.appointmentBilling}>
          <section>
            <h4>Paiement</h4>
            <strong>{money(billing.payment.amount_paid, billing.payment.currency)}</strong>
            <span>Payé</span>
            <dl>
              <div><dt>Commission Drimli</dt><dd>{money(billing.payment.application_fee_amount, billing.payment.currency)}</dd></div>
              <div><dt>Vous recevez</dt><dd>{money(billing.payment.professional_amount, billing.payment.currency)}</dd></div>
            </dl>
          </section>
          {billing.invoice ? <section><h4>Facture client</h4><p>{billing.invoice.invoice_number}</p>{billing.invoice.download_url ? <Button variant="secondary" onClick={() => window.open(billing.invoice!.download_url!, "_blank", "noopener,noreferrer")}>Télécharger la facture</Button> : null}</section> : null}
          {billing.refunds.length ? <section><h4>Remboursement</h4>{billing.refunds.map((refund) => <div key={refund.id} className={styles.appointmentRefund}><p>{money(refund.amount, refund.currency)} remboursés</p>{refund.credit_note?.download_url ? <Button variant="secondary" onClick={() => window.open(refund.credit_note!.download_url!, "_blank", "noopener,noreferrer")}>Télécharger l’avoir</Button> : <span>{refund.status === "succeeded" ? "Avoir en préparation" : `Statut : ${refund.status}`}</span>}</div>)}</section> : null}
        </div>
      ) : null}

      {billing?.payment ? (
        <section className={styles.appointmentCancellation}>
          <p><strong>Conditions acceptées par le client :</strong> {cancellationLabel(billing.cancellation_policy)}</p>
          <Button variant="danger" disabled={updating} onClick={() => setCancellationOpen((open) => !open)}>Annuler le rendez-vous</Button>
          {cancellationOpen ? (
            <div className={styles.appointmentCancellationChoices}>
              <Button variant="secondary" disabled={updating} onClick={() => cancelAppointment("full")}>Annuler et rembourser intégralement</Button>
              <label>
                Montant du remboursement partiel (€)
                <input type="number" min="0.01" step="0.01" value={partialRefund} onChange={(event) => setPartialRefund(event.target.value)} />
              </label>
              <Button variant="secondary" disabled={updating} onClick={() => cancelAppointment("partial")}>Annuler et rembourser partiellement</Button>
              <Button variant="secondary" disabled={updating} onClick={() => cancelAppointment("none")}>Annuler sans remboursement</Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {appointment.status !== "confirmed" ? (
        <p className={styles.appointmentEmptyState}>
          Ce rendez-vous est annulé. Son paiement et ses documents restent
          accessibles ci-dessus.
        </p>
      ) : appointment.videoJoinUrl && roomStatus !== "locked" ? (
        <>
          <p className={styles.appointmentEmptyState}>
            {roomStatus === "closed"
              ? "Démarrez la visioconférence avant d’ouvrir la salle aux clients."
              : "Les clients peuvent désormais rejoindre la visioconférence."}
          </p>
          <div className={styles.appointmentActions}>
            <Button
              className={styles.appointmentPrimaryAction}
              onClick={openProfessionalMeeting}
            >
              {roomStatus === "closed"
                ? "Démarrer la visioconférence"
                : "Rejoindre la visioconférence"}
            </Button>

            {roomStatus === "closed" && meetingStarted ? (
              <Button
                variant="secondary"
                className={styles.appointmentPrimaryAction}
                disabled={updating}
                onClick={() => updateRoomStatus("open")}
              >
                Ouvrir la salle aux clients
              </Button>
            ) : null}

            {roomStatus === "open" ? (
              <Button
                variant="danger"
                className={styles.appointmentPrimaryAction}
                disabled={updating}
                onClick={() => updateRoomStatus("locked")}
              >
                Verrouiller l’accès vidéo
              </Button>
            ) : null}
          </div>
        </>
      ) : roomStatus === "locked" ? (
        <p className={styles.appointmentEmptyState}>
          L’accès à la visioconférence est verrouillé.
        </p>
      ) : (
        <p className={styles.appointmentEmptyState}>
          Lien de visioconférence indisponible
        </p>
      )}

      {statusMessage ? (
        <p className={styles.appointmentStatusMessage} role="status">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
