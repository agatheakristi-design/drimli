import type { JoinAction, VideoProvider } from "./types";

export type AppointmentVideoFields = {
  id: string;
  videoProvider: VideoProvider | string;
  videoJoinUrl?: string | null;
  videoRoomId?: string | null;
};

export function getJoinAction(appt: AppointmentVideoFields): JoinAction {
  switch (appt.videoProvider) {
    case "google_meet":
      return appt.videoJoinUrl
        ? { kind: "redirect", url: appt.videoJoinUrl }
        : {
            kind: "message",
            text: "Lien de visioconférence indisponible.",
          };

    default:
      return {
        kind: "message",
        text: "Lien de visioconférence indisponible.",
      };
  }
}
