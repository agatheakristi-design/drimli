import { createClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import Logo from "@/app/components/ui/Logo";
import {
  getJoinWindowState,
  type JoinWindowState,
} from "@/lib/video/joinWindow";
import { isGoogleMeetUrl } from "@/lib/video/meetUrl";
import PortalRefresh from "./PortalRefresh";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }> | { token: string };
};

type PortalDetails = {
  professionalName: string;
  avatarUrl: string | null;
  serviceTitle: string;
  startsAt: Date;
  endsAt: Date;
  state: JoinWindowState;
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

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
  | { kind: "preparing" }
  | { kind: "ready"; details: PortalDetails }
> {
  if (!token || token.length > 200) return { kind: "invalid" };

  const { data: appointment, error } = await supabaseAdmin
    .from("appointments")
    .select(
      "status, start_datetime, end_datetime, provider_id, product_id, video_provider, video_join_url"
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
  if (
    appointment.video_provider !== "google_meet" ||
    !isGoogleMeetUrl(appointment.video_join_url)
  ) {
    return { kind: "preparing" };
  }

  const [{ data: profile }, { data: product }] = await Promise.all([
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
  ]);

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
    },
  };
}

export default async function RendezVousTokenPage({ params }: PageProps) {
  const { token } = await Promise.resolve(params);
  const portal = await loadPortal(token);

  if (portal.kind === "invalid") {
    return <ErrorState>Ce lien de rendez-vous est invalide ou a expiré.</ErrorState>;
  }
  if (portal.kind === "unavailable") {
    return <ErrorState>Ce rendez-vous n’est pas disponible.</ErrorState>;
  }
  if (portal.kind === "preparing") {
    return <ErrorState>La visioconférence est en cours de préparation.</ErrorState>;
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
        {details.state === "early" ? (
          <>
            <h1>Votre visioconférence n’est pas encore disponible</h1>
            <p>
              Vous pourrez la rejoindre 10 minutes avant le début du
              rendez-vous.
            </p>
          </>
        ) : null}

        {details.state === "open" ? (
          <>
            <h1>Votre visioconférence est prête</h1>
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

        {details.state === "ended" ? (
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

      <dl className={styles.details}>
        <div>
          <dt>Prestation</dt>
          <dd>{details.serviceTitle}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDate(details.startsAt)}</dd>
        </div>
        <div>
          <dt>Horaire</dt>
          <dd>
            {formatTime(details.startsAt)} – {formatTime(details.endsAt)}
          </dd>
        </div>
      </dl>
    </PortalLayout>
  );
}
