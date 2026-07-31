import type { JoinAction, VideoProvider } from "./types";

export type AppointmentVideoFields = {
  id: string;
  videoProvider: VideoProvider;
  videoJoinUrl?: string | null;
  videoRoomId?: string | null;
};

export function getJoinAction(appt: AppointmentVideoFields): JoinAction {
  switch (appt.videoProvider) {
    case "google_meet":
    case "whatsapp":
      return {
        kind: "message",
        text: "Le professionnel vous contactera sur WhatsApp à l'heure du rendez-vous.",
      };

    case "phone":
      return {
        kind: "message",
        text: "Le professionnel vous appellera à l'heure du rendez-vous.",
      };

    case "in_person":
      return {
        kind: "message",
        text: "Présentez-vous sur le lieu du rendez-vous.",
      };

    default:
      return { kind: "none" };
  }
}
