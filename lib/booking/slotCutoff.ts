export const DEFAULT_PROVIDER_TIME_ZONE = "Europe/Paris";
export const BOOKING_LEAD_TIME_MS = 2 * 60 * 60 * 1000;

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function providerTimeZone(availability: unknown) {
  if (
    availability &&
    typeof availability === "object" &&
    "timezone" in availability &&
    typeof availability.timezone === "string" &&
    isValidTimeZone(availability.timezone)
  ) {
    return availability.timezone;
  }

  return DEFAULT_PROVIDER_TIME_ZONE;
}

export function dateInTimeZone(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function timeZoneOffsetMs(instantMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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
  const wallTimeAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return wallTimeAsUtc - instantMs;
}

export function zonedDateTimeToIso(
  date: string,
  time: string,
  timeZone: string
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Invalid date or time");
  }

  const wallTimeAsUtc = Date.parse(`${date}T${time}:00Z`);
  let instant = wallTimeAsUtc - timeZoneOffsetMs(wallTimeAsUtc, timeZone);
  instant = wallTimeAsUtc - timeZoneOffsetMs(instant, timeZone);

  const result = new Date(instant);
  const resultParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(result);
  const resultValues = Object.fromEntries(
    resultParts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const formattedDate = `${resultValues.year}-${resultValues.month}-${resultValues.day}`;
  const formattedTime = `${resultValues.hour}:${resultValues.minute}`;

  if (formattedDate !== date || formattedTime !== time) {
    throw new Error("Invalid wall-clock time");
  }

  return result.toISOString();
}

export function isSlotStartAllowed(params: {
  date: string;
  startMs: number;
  nowMs: number;
  timeZone: string;
}) {
  const today = dateInTimeZone(new Date(params.nowMs), params.timeZone);

  if (params.date < today) return false;
  if (params.date > today) return true;

  return params.startMs >= params.nowMs + BOOKING_LEAD_TIME_MS;
}
