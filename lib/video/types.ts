export type VideoProvider = "none" | "google_meet";

export type JoinAction =
  | { kind: "none" }
  | { kind: "redirect"; url: string }
  | { kind: "internal"; path: string }
  | { kind: "message"; text: string };
