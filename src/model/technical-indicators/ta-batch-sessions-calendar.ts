export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export function timestampIsValid(timestamp: number): boolean {
  return Number.isSafeInteger(timestamp) && Math.abs(timestamp) <= 8.64e15;
}

/** A civil timestamp preserves local date and time fields in UTC storage. */
export function civilClock(timeZone: string): (timestamp: number) => number {
  const name = timeZone.trim();
  if (!name) throw new RangeError("Missing exchange time zone");
  const fixed = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(name);
  if (fixed) {
    const hours = Number(fixed[2]);
    const minutes = Number(fixed[3] ?? 0);
    if (hours > 23 || minutes > 59) throw new RangeError("Invalid fixed time zone");
    const direction = fixed[1] === "-" ? -1 : 1;
    return (timestamp) => timestamp + (hours * 60 + minutes) * MINUTE_MS * direction;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: name,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric"
  });
  return (timestamp) => {
    const values = new Map(
      formatter.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)])
    );
    const date = new Date(0);
    date.setUTCFullYear(values.get("year")!, values.get("month")! - 1, values.get("day"));
    date.setUTCHours(
      values.get("hour")!,
      values.get("minute"),
      values.get("second"),
      ((timestamp % 1000) + 1000) % 1000
    );
    return date.getTime();
  };
}
