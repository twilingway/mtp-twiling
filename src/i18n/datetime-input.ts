import { resolveTimeZone } from "./timezones.js";
export function dateTimeInput(timestamp: number, zone: string): string {
  if (!Number.isFinite(timestamp)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimeZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
/** Reject DST gaps. Keep the existing occurrence of a repeated hour, otherwise use the first. */
export function parseDateTimeInput(value: string, zone: string, previous?: number): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  if (previous !== undefined && dateTimeInput(previous, zone) === value) return previous;
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal)) return NaN;
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour += 6) {
    const probe = nominal + hour * 3600000;
    offsets.add(Date.parse(`${dateTimeInput(probe, zone)}:00Z`) - probe);
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((candidate) => dateTimeInput(candidate, zone) === value)
    .sort((a, b) => a - b);
  return candidates[0] ?? NaN;
}
