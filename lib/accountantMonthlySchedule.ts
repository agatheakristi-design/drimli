/** The accounting period and scheduling gate always use Europe/Paris. */
function parisParts(now: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

export function previousAccountantMonth(now: Date) {
  const parts = parisParts(now);
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 2, 1)).toISOString().slice(0, 7);
}

export function isAccountantMonthlyWindow(now: Date) {
  const parts = parisParts(now);
  return parts.day === "05" && parts.hour === "08";
}
