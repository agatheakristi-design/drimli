import type { JoinAction, VideoProvider } from "./types";

export type AppointmentVideoFields = {
  id: string;
  videoProvider: VideoProvider;
  videoJoinUrl?: string | null; // WhatsApp aujourd'hui
  videoRoomId?: string | null;  // Jitsi demain
};

export function getJoinAction(appt: AppointmentVideoFields): JoinAction {
  switch (appt.videoProvider) {
    case "whatsapp": {
      const url = (appt.videoJoinUrl ?? "").trim();
      if (!url) return { kind: "none" };
      return { kind: "redirect", url };
    }

    case "jitsi": {
      // Demain: on renverra vers une page interne Drimli qui embarque Jitsi
      // Exemple: /appointments/:id/room
      return { kind: "internal", path: `/appointments/${appt.id}/room` };
    }

    default:
      return { kind: "none" };
  }
}
