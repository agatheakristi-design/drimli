export type VideoProvider = "none" | "whatsapp" | "jitsi";

export type JoinAction =
  | { kind: "none" }
  | { kind: "redirect"; url: string }
  | { kind: "internal"; path: string };
