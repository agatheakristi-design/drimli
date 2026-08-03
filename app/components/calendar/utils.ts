import {
  DAY_KEYS,
  type Availability,
  type CalendarAppointment,
  type DayKey,
} from "./types";

export function dateToYMD(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function addOneDayYMD(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function dayKeyFromYMD(value: string): DayKey {
  const dayIndex = new Date(`${value}T12:00:00Z`).getUTCDay();
  return DAY_KEYS[(dayIndex + 6) % 7];
}

function parisOffsetMs(instantMs: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const parisAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return parisAsUtc - instantMs;
}

export function parisDateTimeToIso(date: string, time: string) {
  const wallTimeAsUtc = Date.parse(`${date}T${time}:00Z`);
  let instant = wallTimeAsUtc - parisOffsetMs(wallTimeAsUtc);
  instant = wallTimeAsUtc - parisOffsetMs(instant);
  return new Date(instant).toISOString();
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function getAvailabilityHourRange(availability: Availability | null) {
  const openDays = availability
    ? Object.values(availability).filter(
        (slot): slot is NonNullable<typeof slot> =>
          Boolean(slot?.start && slot?.end && slot.start < slot.end)
      )
    : [];

  if (openDays.length === 0) {
    return { startHour: 9, endHour: 18 };
  }

  const earliest = Math.min(...openDays.map((slot) => timeToMinutes(slot.start)));
  const latest = Math.max(...openDays.map((slot) => timeToMinutes(slot.end)));

  return {
    startHour: Math.floor(earliest / 60),
    endHour: Math.ceil(latest / 60),
  };
}

export function getCalendarHourRange(
  availability: Availability | null,
  appointments: CalendarAppointment[]
) {
  const availabilityRange = getAvailabilityHourRange(availability);

  if (appointments.length === 0) return availabilityRange;

  const appointmentStarts = appointments.map(
    (appointment) => getParisDateTimeParts(appointment.start_datetime).minutes
  );
  const appointmentEnds = appointments.map((appointment) => {
    const startMinutes = getParisDateTimeParts(
      appointment.start_datetime
    ).minutes;
    const durationMinutes =
      (Date.parse(appointment.end_datetime) -
        Date.parse(appointment.start_datetime)) /
      60000;
    return Math.min(1440, startMinutes + durationMinutes);
  });

  return {
    startHour: Math.min(
      availabilityRange.startHour,
      Math.floor(Math.min(...appointmentStarts) / 60)
    ),
    endHour: Math.max(
      availabilityRange.endHour,
      Math.ceil(Math.max(...appointmentEnds) / 60)
    ),
  };
}

export function getParisDateTimeParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isHourWithinAvailability(
  startHour: number,
  availability: { start: string; end: string } | null
) {
  if (!availability) return false;

  const cellStart = startHour * 60;
  const cellEnd = cellStart + 60;
  return (
    cellEnd > timeToMinutes(availability.start) &&
    cellStart < timeToMinutes(availability.end)
  );
}

export function intervalsOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
) {
  const firstStartMs = Date.parse(firstStart);
  const firstEndMs = Date.parse(firstEnd);
  const secondStartMs = Date.parse(secondStart);
  const secondEndMs = Date.parse(secondEnd);

  if (
    !Number.isFinite(firstStartMs) ||
    !Number.isFinite(firstEndMs) ||
    !Number.isFinite(secondStartMs) ||
    !Number.isFinite(secondEndMs)
  ) {
    return false;
  }

  return firstStartMs < secondEndMs && firstEndMs > secondStartMs;
}
