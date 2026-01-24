import { redirect } from "next/navigation";
import { isJoinWindowOpen } from "@/lib/video/joinWindow";
import { getJoinAction } from "@/lib/video/getJoinAction";
import type { VideoProvider } from "@/lib/video/types";

type ApiAppointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  videoProvider: string;
  videoJoinUrl: string | null;
  videoRoomId: string | null;
};

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
};

function normalizeProvider(v: string): VideoProvider {
  const x = (v || "").toLowerCase().trim();
  if (x === "whatsapp") return "whatsapp";
  if (x === "jitsi") return "jitsi";
  return "none";
}

export default async function JoinAppointmentPage(props: PageProps) {
  const params = await Promise.resolve(props.params);
  const id = params?.id;

  if (!id) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Rejoindre la visio</h1>
        <p style={{ marginTop: 12 }}>Erreur: id manquant dans l’URL.</p>
      </main>
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/appointments/${id}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const msg = payload?.error ?? `Unable to load appointment (${res.status})`;
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Rejoindre la visio</h1>
        <p style={{ marginTop: 12 }}>Erreur: {msg}</p>
      </main>
    );
  }

  const appt = (await res.json()) as ApiAppointment;

  const startsAt = new Date(appt.startsAt);
  const endsAt = new Date(appt.endsAt);

  if (!isJoinWindowOpen({ startsAt, endsAt })) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Rejoindre la visio</h1>
        <p style={{ marginTop: 12 }}>
          La visio sera disponible 5 minutes avant le début du rendez-vous,
          et jusqu’à 10 minutes après la fin.
        </p>
      </main>
    );
  }

  const action = getJoinAction({
    id: appt.id,
    videoProvider: normalizeProvider(appt.videoProvider),
    videoJoinUrl: appt.videoJoinUrl,
    videoRoomId: appt.videoRoomId,
  });

  if (action.kind === "redirect") redirect(action.url);
  if (action.kind === "internal") redirect(action.path);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Rejoindre la visio</h1>
      <p>Aucune visio configurée.</p>
    </main>
  );
}
