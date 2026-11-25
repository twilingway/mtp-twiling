import { currentDisplayPreferences, intlLocale } from "./preferences.js";
import type { DisplayPreferences } from "./preferences.js";
import { resolveTimeZone } from "./timezones.js";

export function formatNumber(
  value: number | null | undefined,
  digits = 2,
  signed = false,
  preferences: DisplayPreferences = currentDisplayPreferences()
): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat(intlLocale(preferences.locale), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: signed ? "exceptZero" : "auto"
      }).format(value);
}
export function formatClock(
  instant: number,
  preferences: DisplayPreferences = currentDisplayPreferences()
): string {
  return new Intl.DateTimeFormat(intlLocale(preferences.locale), {
    timeZone: resolveTimeZone(preferences.timeZone),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(instant);
}
export function intradayTimeframe(timeframe: string): boolean {
  return /^\d+[mh]$/.test(timeframe);
}
/** D/W/M timestamps encode an exchange trading date, not a local wall-clock instant. */
export function chartDateFormat(
  timeframe: string,
  preferences: DisplayPreferences,
  tick: "date" | "day" | "time" | "month" | "year" = "date"
): Intl.DateTimeFormat {
  const intraday = intradayTimeframe(timeframe);
  const options: Intl.DateTimeFormatOptions =
    tick === "year"
      ? { year: "numeric" }
      : tick === "month"
        ? { month: "short" }
        : tick === "day"
          ? { day: "2-digit" }
          : tick === "time" && intraday
            ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
            : {
                day: "2-digit",
                month: "short",
                year: "2-digit",
                ...(intraday
                  ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
                  : {})
              };
  return new Intl.DateTimeFormat(intlLocale(preferences.locale), {
    ...options,
    timeZone: intraday ? resolveTimeZone(preferences.timeZone) : "UTC"
  });
}
export function formatChartDate(
  instant: number,
  timeframe: string,
  preferences: DisplayPreferences = currentDisplayPreferences()
): string {
  return chartDateFormat(timeframe, preferences).format(instant);
}
