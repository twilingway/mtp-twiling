import type { NativeIntervalId } from "./registry.js";
import type { CalendarAxisDisplay } from "../../i18n/calendar-axis.js";
import { NATIVE_TIMEFRAME_CONFIG } from "./native-timeframes.js";
import { projectedCalendarDomain, projectedCalendarIndices } from "./projected-time.js";
const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const hourly = new Set<NativeIntervalId>(["1h", "2h", "4h"]);
const calendar = new Set<NativeIntervalId>(["1d", "1w", "1M"]);
const minutes = new Set<NativeIntervalId>(["1m", "2m", "3m", "5m", "10m", "15m", "30m"]);
export const hasCalendarAxis = (timeframe: NativeIntervalId): boolean =>
  calendar.has(timeframe) || hourly.has(timeframe) || minutes.has(timeframe);
const monthLabel = (date: Date) => months[date.getUTCMonth()]!;
const dayLabel = (date: Date) => `${date.getUTCDate()} ${monthLabel(date)}`;
const clockLabel = (date: Date) =>
  `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;

/** TickMarkType values are fixed by Lightweight Charts 5: year=0, month=1, day=2, time=3/4. */
export function lightweightCalendarLabel(
  timestamp: number,
  timeframe: NativeIntervalId,
  type: number,
  detailed: boolean,
  display?: CalendarAxisDisplay
): string | null {
  if (!hasCalendarAxis(timeframe)) return null;
  const date = new Date(timestamp);
  if (type === 0) return display?.year(timestamp) ?? String(date.getUTCFullYear());
  if (type === 1)
    return calendar.has(timeframe)
      ? (display?.month(timestamp) ?? monthLabel(date))
      : (display?.day(timestamp) ?? dayLabel(date));
  if (type === 2)
    return !calendar.has(timeframe) || detailed ? (display?.day(timestamp) ?? dayLabel(date)) : "";
  return minutes.has(timeframe) || (hourly.has(timeframe) && detailed)
    ? (display?.clock(timestamp) ?? clockLabel(date))
    : "";
}
export interface CalendarAxisTick {
  coord: number;
  value: number;
  text: string;
}
/** Real bars and lazy future positions share calendar boundaries; no market data is extended. */
export function calendarAxisTicks(
  data: readonly { timestamp: number }[],
  timeframe: NativeIntervalId,
  options: {
    from: number;
    to: number;
    width: number;
    coordinate: (index: number) => number;
    display?: CalendarAxisDisplay;
  }
): CalendarAxisTick[] | null {
  if (!hasCalendarAxis(timeframe)) return null;
  const domain = projectedCalendarDomain(data, NATIVE_TIMEFRAME_CONFIG[timeframe].ms);
  if (!domain || ![options.from, options.to, options.width].every(Number.isFinite)) return [];
  const from = Math.max(0, Math.floor(options.from)),
    to = Math.min(domain.lastIndex, Math.ceil(options.to));
  if (from > to || options.width <= 0) return [];
  const origin = options.coordinate(from);
  const spacing = Math.abs(options.coordinate(from + 1) - origin);
  if (!Number.isFinite(origin) || !Number.isFinite(spacing) || spacing <= 0) return [];
  const futureFrom = Math.max(from, Math.floor(from - origin / spacing) - 1);
  const futureTo = Math.min(to, Math.ceil(from + (options.width - origin) / spacing) + 1);
  const detailed = spacing >= 24 && timeframe !== "1M";
  const minuteAxis = minutes.has(timeframe);
  const minimumMinutes = minuteAxis
    ? (80 * Number.parseInt(timeframe)) / Math.max(0.2, spacing)
    : 1440;
  const minuteStep =
    [1, 2, 3, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].find(
      (step) => step >= minimumMinutes
    ) ?? 1440;
  const candidates: { tick: CalendarAxisTick; priority: number }[] = [];
  const parts = (timestamp: number) => {
    if (options.display) return options.display.parts(timestamp);
    const date = new Date(timestamp);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes()
    };
  };
  const realTo = Math.min(data.length - 1, to);
  function* visibleIndices() {
    for (let index = from; index <= realTo; index++) yield index;
    yield* projectedCalendarIndices(domain!, futureFrom, futureTo, spacing, minuteStep, parts);
  }
  let previousIndex = -2;
  let previousDate: ReturnType<typeof parts> | null = null;
  for (const index of visibleIndices()) {
    const timestamp = domain.timestamp(index);
    if (timestamp === null) continue;
    const before =
      index === previousIndex + 1
        ? previousDate
        : index > 0
          ? parts(domain.timestamp(index - 1)!)
          : null;
    const date = parts(timestamp);
    const year = !before || date.year !== before.year;
    const month = year || date.month !== before?.month;
    const day = month || date.day !== before?.day;
    const crossedMinuteBucket =
      !before ||
      Math.floor((date.hour * 60 + date.minute) / minuteStep) !==
        Math.floor((before.hour * 60 + before.minute) / minuteStep);
    previousIndex = index;
    previousDate = date;
    let text: string, priority: number;
    if (year) {
      text = options.display?.year(timestamp) ?? String(date.year);
      priority = 4;
    } else if (month) {
      text = lightweightCalendarLabel(timestamp, timeframe, 1, detailed, options.display)!;
      priority = 3;
    } else if (day && (!calendar.has(timeframe) || detailed)) {
      text = lightweightCalendarLabel(timestamp, timeframe, 2, detailed, options.display)!;
      priority = 2;
    } else if (minuteAxis) {
      // A UTC-aligned 2m/10m bar may never land exactly on Nepal's local round hour.
      if (!crossedMinuteBucket) continue;
      text = lightweightCalendarLabel(timestamp, timeframe, 3, true, options.display)!;
      priority = 1;
    } else if (detailed) {
      text = lightweightCalendarLabel(
        timestamp,
        timeframe,
        hourly.has(timeframe) ? 3 : 2,
        true,
        options.display
      )!;
      priority = 1;
    } else continue;
    const coord = options.coordinate(index < data.length ? index : domain.logical(timestamp));
    if (Number.isFinite(coord) && coord >= 0 && coord <= options.width)
      candidates.push({ tick: { coord, value: timestamp, text }, priority });
  }
  const selected: CalendarAxisTick[] = [];
  // Reserve year/month/day boundaries first, then fill detail without label collisions.
  for (const { tick } of candidates.sort(
    (a, b) => b.priority - a.priority || a.tick.coord - b.tick.coord
  )) {
    if (
      selected.every(
        (other) =>
          Math.abs(other.coord - tick.coord) >=
          Math.max(56, (other.text.length + tick.text.length) * 3.5)
      )
    )
      selected.push(tick);
  }
  return selected.sort((a, b) => a.coord - b.coord);
}
