import { intlLocale } from "./preferences.js";
import type { DisplayPreferences } from "./preferences.js";
import { intradayTimeframe } from "./format.js";
import { resolveTimeZone } from "./timezones.js";

export interface CalendarDisplayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}
export interface CalendarAxisDisplay {
  parts(instant: number): CalendarDisplayParts;
  partsForData?(
    data: readonly { timestamp: number }[]
  ): (instant: number, index?: number) => CalendarDisplayParts;
  year(instant: number): string;
  month(instant: number): string;
  day(instant: number): string;
  clock(instant: number): string;
}
/** Adapter-independent callbacks for calendar boundary detection AND axis text. */
export function calendarAxisDisplay(
  timeframe: string,
  preferences: DisplayPreferences
): CalendarAxisDisplay {
  const timeZone = intradayTimeframe(timeframe) ? resolveTimeZone(preferences.timeZone) : "UTC";
  // The grid and axis share this adapter-scoped bounded cache; quotes retain UTC timestamps.
  const partsCache = new Map<number, CalendarDisplayParts>();
  // Loaded candles own positional slots, so a Fit scan cannot evict its own working set.
  // Timestamp checks also cover replacement arrays and an in-place last-bar update.
  const candleTimes: number[] = [];
  const candleParts: (CalendarDisplayParts | undefined)[] = [];
  let recentInstant: number | undefined;
  let recentParts: CalendarDisplayParts | undefined;
  const numeric = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const formatter = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intlLocale(preferences.locale), { timeZone, ...options });
  const year = formatter({ year: "numeric" }),
    month = formatter({ month: "short" }),
    day = formatter({ day: "numeric", month: "short" }),
    clock = formatter({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const remember = (instant: number, value: CalendarDisplayParts) => {
    recentInstant = instant;
    recentParts = value;
    return value;
  };
  const parts = (instant: number): CalendarDisplayParts => {
    if (instant === recentInstant && recentParts) return recentParts;
    if (timeZone === "UTC") {
      const date = new Date(instant);
      return remember(instant, {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes()
      });
    }
    const cached = partsCache.get(instant);
    if (cached) return remember(instant, cached);
    const parts = numeric.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const result = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute")
    };
    if (partsCache.size >= 8192) {
      const oldest = partsCache.keys().next().value;
      if (oldest !== undefined) partsCache.delete(oldest);
    }
    partsCache.set(instant, result);
    return remember(instant, result);
  };
  const text = (
    format: Intl.DateTimeFormat,
    key: (value: CalendarDisplayParts) => number,
    limit: number
  ) => {
    const cache = new Map<number, string>();
    return (instant: number) => {
      const value = key(parts(instant));
      const cached = cache.get(value);
      if (cached !== undefined) return cached;
      const result = format.format(instant);
      if (cache.size >= limit) cache.delete(cache.keys().next().value!);
      cache.set(value, result);
      return result;
    };
  };
  return {
    parts,
    partsForData(data: readonly { timestamp: number }[]) {
      candleTimes.length = data.length;
      candleParts.length = data.length;
      return (instant: number, index?: number): CalendarDisplayParts => {
        if (index === undefined || index < 0 || index >= data.length) return parts(instant);
        const cached = candleParts[index];
        if (candleTimes[index] === instant && cached) return remember(instant, cached);
        const result = parts(instant);
        candleTimes[index] = instant;
        candleParts[index] = result;
        return result;
      };
    },
    year: text(year, (value) => value.year, 64),
    month: text(month, (value) => value.month, 12),
    day: text(day, (value) => value.month * 32 + value.day, 372),
    clock: text(clock, (value) => value.hour * 60 + value.minute, 1440)
  };
}
