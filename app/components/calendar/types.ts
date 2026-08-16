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
  status: "confirmed" | "cancelled_by_provider" | "cancelled_by_client";
  videoProvider: string | null;
  videoJoinUrl: string | null;
  videoRoomStatus: "closed" | "open" | "locked";
};

export type CalendarPanelMode = "settings" | "refunds" | "appointment";

export type RefundedAppointment = {
  appointment: CalendarAppointment;
  amountPaid: number;
  refundedAmount: number;
  currency: string;
  refundStatus: "partial" | "total";
  invoice: null | {
    invoiceNumber: string;
    downloadUrl: string | null;
  };
  creditNotes: Array<{
    id: string;
    creditNoteNumber: string;
    amount: number;
    currency: string;
    downloadUrl: string | null;
  }>;
};

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
