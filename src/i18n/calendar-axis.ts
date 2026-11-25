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
/** Adapter-independent callbacks for calendar boundary detection AND axis text. */
export function calendarAxisDisplay(timeframe: string, preferences: DisplayPreferences) {
  const timeZone = intradayTimeframe(timeframe) ? resolveTimeZone(preferences.timeZone) : "UTC";
  // The grid and axis share this adapter-scoped bounded cache; quotes retain UTC timestamps.
  const partsCache = new Map<number, CalendarDisplayParts>();
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
  return {
    parts(instant: number): CalendarDisplayParts {
      if (timeZone === "UTC") {
        const date = new Date(instant);
        return {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: date.getUTCHours(),
          minute: date.getUTCMinutes()
        };
      }
      const cached = partsCache.get(instant);
      if (cached) return cached;
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
      return result;
    },
    year: (instant: number) => year.format(instant),
    month: (instant: number) => month.format(instant),
    day: (instant: number) => day.format(instant),
    clock: (instant: number) => clock.format(instant)
  };
}
export type CalendarAxisDisplay = ReturnType<typeof calendarAxisDisplay>;
