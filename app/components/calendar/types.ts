export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayAvailability = { start: string; end: string } | null;

export type Availability = Record<DayKey, DayAvailability>;

export type ProviderBlock = {
  id: string;
  start_datetime: string;
  end_datetime: string;
  reason: string | null;
};

export type CalendarAppointment = {
  id: string;
  product_id: string | null;
  serviceName: string;
  clientName: string;
  clientEmail: string | null;
  start_datetime: string;
  end_datetime: string;
  status: "confirmed";
  videoProvider: string | null;
  videoJoinUrl: string | null;
};

export type CalendarPanelMode = "settings" | "appointment";

export type CalendarSettingsSection =
  | "availability"
  | "blocks"
  | "upcoming-blocks";

export const DAY_KEYS: DayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];
