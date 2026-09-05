import { createClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import Logo from "@/app/components/ui/Logo";
import {
  getJoinWindowState,
  type JoinWindowState,
} from "@/lib/video/joinWindow";
import { isGoogleMeetUrl } from "@/lib/video/meetUrl";
import type { VideoRoomStatus } from "@/lib/video/types";
import PortalRefresh from "./PortalRefresh";
import AppointmentManagement from "./AppointmentManagement";
import { clientAppointmentPermissions } from "@/lib/clientAppointmentPolicy";
import type { CancellationPolicy } from "@/lib/payoutPolicy";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

type PortalDetails = {
  professionalName: string;
  avatarUrl: string | null;
  serviceTitle: string;
  startsAt: Date;
  endsAt: Date;
  state: JoinWindowState;
  roomStatus: VideoRoomStatus;
  providerId: string;
  serviceId: string;
  policy: CancellationPolicy;
  videoReady: boolean;
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.brand} aria-label="Drimli">
        <Logo />
      </div>
      <section className={styles.card}>{children}</section>
    </main>
  );
}

function ErrorState({ children }: { children: ReactNode }) {
  return (
    <PortalLayout>
      <div className={styles.messageOnly}>
        <h1>{children}</h1>
      </div>
    </PortalLayout>
  );
}

async function loadPortal(token: string): Promise<
  | { kind: "invalid" }
  | { kind: "unavailable" }
  | { kind: "ready"; details: PortalDetails }
> {
  if (!token || token.length > 200) return { kind: "invalid" };

  const { data: appointment, error } = await supabaseAdmin
    .from("appointments")
    .select(
      "id, status, start_datetime, end_datetime, provider_id, product_id, video_provider, video_join_url, video_room_status"
    )
    .eq("join_token", token)
    .maybeSingle();

  if (error || !appointment) return { kind: "invalid" };
  if (appointment.status !== "confirmed") return { kind: "unavailable" };
  if (
    !appointment.start_datetime ||
    !appointment.end_datetime ||
    !appointment.provider_id ||
    !appointment.product_id
  ) {
    return { kind: "unavailable" };
  }
  const [{ data: profile }, { data: product }, { data: snapshot }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("provider_id", appointment.provider_id)
      .maybeSingle(),
    supabaseAdmin
      .from("products")
      .select("title")
      .eq("id", appointment.product_id)
      .maybeSingle(),
    supabaseAdmin
      .from("billing_checkout_snapshots")
      .select("cancellation_policy")
      .eq("appointment_id", appointment.id)
      .maybeSingle(),
  ]);
  if (!snapshot?.cancellation_policy) return { kind: "unavailable" };

  const startsAt = new Date(appointment.start_datetime);
  const endsAt = new Date(appointment.end_datetime);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    startsAt >= endsAt
  ) {
    return { kind: "unavailable" };
  }

  return {
    kind: "ready",
    details: {
      professionalName: profile?.full_name?.trim() || "Votre professionnel",
      avatarUrl: profile?.avatar_url?.trim() || null,
      serviceTitle: product?.title?.trim() || "Rendez-vous",
      startsAt,
      endsAt,
      state: getJoinWindowState({ startsAt, endsAt }),
      roomStatus: appointment.video_room_status as VideoRoomStatus,
      providerId: appointment.provider_id,
      serviceId: appointment.product_id,
      policy: snapshot.cancellation_policy as CancellationPolicy,
      videoReady: appointment.video_provider === "google_meet" && isGoogleMeetUrl(appointment.video_join_url),
    },
  };
}

export default async function RendezVousTokenPage({ params }: PageProps) {
  const { token } = await params;
  const portal = await loadPortal(token);

  if (portal.kind === "invalid") {
    return <ErrorState>Ce lien de rendez-vous est invalide ou a expiré.</ErrorState>;
  }
  if (portal.kind === "unavailable") {
    return <ErrorState>Ce rendez-vous n’est pas disponible.</ErrorState>;
  }
  const { details } = portal;
  const opensAt = details.startsAt.getTime() - 10 * 60_000;
  const closesAt = details.endsAt.getTime() + 30 * 60_000;

  return (
    <PortalLayout>
      <PortalRefresh
        state={details.state}
        opensAt={opensAt}
        closesAt={closesAt}
        roomStatus={details.roomStatus}
      />

      <header className={styles.header}>
        {details.avatarUrl ? (
          <img
            className={styles.avatar}
            src={details.avatarUrl}
            alt=""
          />
        ) : (
          <div className={styles.avatarFallback} aria-hidden="true">
            {details.professionalName.charAt(0).toUpperCase()}
          </div>
        )}

        <div>
          <span className={styles.eyebrow}>Rendez-vous avec</span>
          <strong>{details.professionalName}</strong>
        </div>
      </header>

      <div className={styles.content}>
        {!details.videoReady ? (
          <><h1>Votre rendez-vous est confirmé</h1><p>La visioconférence est en cours de préparation.</p></>
        ) : details.roomStatus !== "locked" && details.state === "early" ? (
          <>
            <h1>Votre visioconférence n’est pas encore disponible</h1>
            <p>
              Vous pourrez la rejoindre 10 minutes avant le début du
              rendez-vous.
            </p>
          </>
        ) : null}

        {details.videoReady && details.state === "open" && details.roomStatus === "closed" ? (
          <>
            <h1>Votre rendez-vous va bientôt commencer</h1>
            <p>
              Le professionnel prépare la séance. Vous pourrez rejoindre la
              visioconférence dès qu’il ouvrira la salle.
            </p>
            <span className={styles.waitingStatus}>En attente</span>
          </>
        ) : null}

        {details.videoReady && details.state === "open" && details.roomStatus === "open" ? (
          <>
            <h1>Le professionnel est prêt</h1>
            <a
              className={styles.joinButton}
              href={`/api/rendez-vous/${encodeURIComponent(token)}/join`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Rejoindre la visioconférence
            </a>
          </>
        ) : null}

        {details.videoReady && details.roomStatus === "locked" ? (
          <>
            <h1>L’accès à cette visioconférence est fermé</h1>
          </>
        ) : null}

        {details.videoReady && details.roomStatus !== "locked" && details.state === "ended" ? (
          <>
            <h1>Cette visioconférence n’est plus disponible</h1>
            <p>Le créneau d’accès est terminé.</p>
            <p>
              Si vous pensez qu’il s’agit d’une erreur, contactez votre
              professionnel.
            </p>
          </>
        ) : null}
      </div>

      <AppointmentManagement
        token={token}
        providerId={details.providerId}
        serviceId={details.serviceId}
        serviceTitle={details.serviceTitle}
        initialStart={details.startsAt.toISOString()}
        initialEnd={details.endsAt.toISOString()}
        initialPermissions={clientAppointmentPermissions(details.policy, details.startsAt)}
      />
    </PortalLayout>
  );
}
