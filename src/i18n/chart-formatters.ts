import { chartDateFormat, formatChartDate, intradayTimeframe } from "./format.js";
import type { DisplayPreferences } from "./preferences.js";
type ChartTime = number | string | { year: number; month: number; day: number };
export function chartTimeInstant(time: ChartTime): number {
  return typeof time === "number"
    ? time * 1000
    : typeof time === "string"
      ? Date.parse(`${time}T00:00:00Z`)
      : Date.UTC(time.year, time.month - 1, time.day);
}
export function lightweightDateFormatters(timeframe: string, preferences: DisplayPreferences) {
  return {
    timeFormatter: (time: ChartTime): string =>
      formatChartDate(chartTimeInstant(time), timeframe, preferences),
    tickMarkFormatter: (time: ChartTime, type: number): string => {
      const mode = type === 0 ? "year" : type === 1 ? "month" : type >= 3 ? "time" : "day";
      return chartDateFormat(timeframe, preferences, mode).format(chartTimeInstant(time));
    }
  };
}
export function klineDateFormatter(timeframe: string, preferences: DisplayPreferences) {
  return (
    _dateTimeFormat: Intl.DateTimeFormat,
    timestamp: number,
    template: string,
    type: number
  ): string => {
    if (type !== 2) return formatChartDate(timestamp, timeframe, preferences);
    const mode =
      template === "YYYY"
        ? "year"
        : template === "MM" || template === "YYYY-MM"
          ? "month"
          : intradayTimeframe(timeframe) && /HH|mm|ss/.test(template)
            ? "time"
            : "date";
    return chartDateFormat(timeframe, preferences, mode).format(timestamp);
  };
}
