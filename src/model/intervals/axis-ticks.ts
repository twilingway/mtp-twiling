import type { NativeIntervalId } from "./registry.js";
const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const hourly = new Set<NativeIntervalId>(["1h", "2h", "4h"]);
const calendar = new Set<NativeIntervalId>(["1d", "1w", "1M"]);
export const hasCalendarAxis = (timeframe: NativeIntervalId): boolean =>
  calendar.has(timeframe) || hourly.has(timeframe);
const monthLabel = (date: Date) => months[date.getUTCMonth()]!;
const dayLabel = (date: Date) => `${date.getUTCDate()} ${monthLabel(date)}`;
const clockLabel = (date: Date) =>
  `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;

/** TickMarkType values are fixed by Lightweight Charts 5: year=0, month=1, day=2, time=3/4. */
export function lightweightCalendarLabel(
  timestamp: number,
  timeframe: NativeIntervalId,
  type: number,
  detailed: boolean
): string | null {
  if (!calendar.has(timeframe) && !hourly.has(timeframe)) return null;
  const date = new Date(timestamp);
  if (type === 0) return String(date.getUTCFullYear());
  if (type === 1) return calendar.has(timeframe) ? monthLabel(date) : dayLabel(date);
  if (type === 2) return hourly.has(timeframe) || detailed ? dayLabel(date) : "";
  return hourly.has(timeframe) && detailed ? clockLabel(date) : "";
}
export interface CalendarAxisTick {
  coord: number;
  value: number;
  text: string;
}
/** Build real calendar-boundary ticks from source bars; never relabel every day as a month. */
export function calendarAxisTicks(
  data: readonly { timestamp: number }[],
  timeframe: NativeIntervalId,
  options: { from: number; to: number; width: number; coordinate: (index: number) => number }
): CalendarAxisTick[] | null {
  if (!calendar.has(timeframe) && !hourly.has(timeframe)) return null;
  const from = Math.max(0, Math.floor(options.from)),
    to = Math.min(data.length - 1, Math.ceil(options.to));
  if (from > to || options.width <= 0) return [];
  const spacing = Math.abs(options.coordinate(from + 1) - options.coordinate(from));
  const detailed = spacing >= 24 && timeframe !== "1M";
  const candidates: { tick: CalendarAxisTick; priority: number }[] = [];
  for (let index = from; index <= to; index++) {
    const timestamp = data[index]!.timestamp,
      date = new Date(timestamp),
      prev = data[index - 1];
    const before = prev ? new Date(prev.timestamp) : null;
    const year = !before || date.getUTCFullYear() !== before.getUTCFullYear();
    const month = year || date.getUTCMonth() !== before?.getUTCMonth();
    const day = month || date.getUTCDate() !== before?.getUTCDate();
    let text: string, priority: number;
    if (year) {
      text = String(date.getUTCFullYear());
      priority = 4;
    } else if (month) {
      text = calendar.has(timeframe) ? monthLabel(date) : dayLabel(date);
      priority = 3;
    } else if (day && (hourly.has(timeframe) || detailed)) {
      text = dayLabel(date);
      priority = 2;
    } else if (detailed) {
      text = hourly.has(timeframe) ? clockLabel(date) : dayLabel(date);
      priority = 1;
    } else continue;
    const coord = options.coordinate(index);
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
