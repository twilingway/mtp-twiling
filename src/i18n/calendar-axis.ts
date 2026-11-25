import { intlLocale } from "./preferences.js";
import type { DisplayPreferences } from "./preferences.js";
import { intradayTimeframe } from "./format.js";
import { resolveTimeZone } from "./timezones.js";

export interface CalendarDisplayParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}
/** Adapter-independent callbacks for calendar boundary detection AND axis text. */
export function calendarAxisDisplay(timeframe: string, preferences: DisplayPreferences) {
  const timeZone = intradayTimeframe(timeframe) ? resolveTimeZone(preferences.timeZone) : "UTC";
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
      const parts = numeric.formatToParts(instant);
      const get = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value);
      return {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour: get("hour"),
        minute: get("minute")
      };
    },
    year: (instant: number) => year.format(instant),
    month: (instant: number) => month.format(instant),
    day: (instant: number) => day.format(instant),
    clock: (instant: number) => clock.format(instant)
  };
}
export type CalendarAxisDisplay = ReturnType<typeof calendarAxisDisplay>;
