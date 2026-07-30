export type VideoProvider =
  | "none"
  | "whatsapp"
  | "google_meet"
  | "phone"
  | "in_person";

export type JoinAction =
  | { kind: "none" }
  | { kind: "redirect"; url: string }
  | { kind: "internal"; path: string }
  | { kind: "message"; text: string };
