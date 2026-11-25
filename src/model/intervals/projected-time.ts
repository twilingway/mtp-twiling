import { monthPosition, shiftUtcMonths } from "./calendar.js";
import type { CalendarDisplayParts } from "../../i18n/calendar-axis.js";

interface TimestampPoint {
  readonly timestamp: number;
}

/** Shared by drawings and the calendar axis; projected positions are never market bars. */
export function logicalForTime(
  data: readonly TimestampPoint[],
  timestamp: number,
  intervalMs: number | null
): number {
  const first = data[0],
    last = data.at(-1);
  if (!first || !last) return 0;
  const distance = (anchor: number) =>
    intervalMs === null
      ? monthPosition(timestamp) - monthPosition(anchor)
      : (timestamp - anchor) / intervalMs;
  if (timestamp < first.timestamp) return distance(first.timestamp);
  if (timestamp > last.timestamp) return data.length - 1 + distance(last.timestamp);
  let lo = 0,
    hi = data.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (data[mid]!.timestamp < timestamp) lo = mid + 1;
    else hi = mid;
  }
  if (!lo) return 0;
  const before = data[lo - 1]!,
    after = data[lo]!;
  return lo - 1 + (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
}

export function timeForLogical(
  data: readonly TimestampPoint[],
  index: number,
  intervalMs: number | null
): number | null {
  const first = data[0],
    last = data.at(-1);
  if (!first || !last) return null;
  const i = Math.round(index);
  const offset = (timestamp: number, count: number) =>
    intervalMs === null ? shiftUtcMonths(timestamp, count) : timestamp + count * intervalMs;
  return i < 0
    ? offset(first.timestamp, i)
    : i >= data.length
      ? offset(last.timestamp, i - data.length + 1)
      : data[i]!.timestamp;
}

export function projectedCalendarDomain(
  data: readonly TimestampPoint[],
  intervalMs: number | null
) {
  const last = data.at(-1);
  if (!last) return null;
  const end = shiftUtcMonths(last.timestamp, 9);
  const lastIndex =
    data.length - 1 + (intervalMs === null ? 9 : Math.floor((end - last.timestamp) / intervalMs));
  return {
    firstFutureIndex: data.length,
    lastIndex,
    end,
    timestamp(index: number): number | null {
      const timestamp = timeForLogical(data, index, intervalMs);
      return timestamp !== null && timestamp <= end ? timestamp : null;
    },
    logical: (timestamp: number) => logicalForTime(data, timestamp, intervalMs)
  };
}

type Domain = NonNullable<ReturnType<typeof projectedCalendarDomain>>;

/** Sample visible screen cells, preserving month boundaries with logarithmic index searches. */
export function projectedCalendarIndices(
  domain: Domain,
  from: number,
  to: number,
  spacing: number,
  minuteStep: number,
  parts: (timestamp: number) => CalendarDisplayParts
): number[] {
  const first = Math.max(domain.firstFutureIndex, Math.floor(from));
  const last = Math.min(domain.lastIndex, Math.ceil(to));
  if (first > last || !Number.isFinite(spacing) || spacing <= 0) return [];
  const stride = Math.max(1, Math.floor(32 / spacing));
  const indices = new Set<number>();
  const partAt = (index: number) => parts(domain.timestamp(index)!);
  const month = (date: CalendarDisplayParts) => date.year * 12 + date.month;
  const day = (date: CalendarDisplayParts) => date.year * 512 + date.month * 32 + date.day;
  const boundary = (start: number, end: number, key: typeof month): number | null => {
    const before = key(partAt(start - 1));
    if (key(partAt(end)) === before) return null;
    let lo = start,
      hi = end;
    while (lo < hi) {
      const middle = Math.floor((lo + hi) / 2);
      if (key(partAt(middle)) === before) lo = middle + 1;
      else hi = middle;
    }
    return lo;
  };
  for (let start = first; start <= last; start += stride) {
    const end = Math.min(last, start + stride - 1);
    indices.add(start);
    let monthStart = boundary(start, end, month);
    while (monthStart !== null) {
      indices.add(monthStart);
      monthStart = monthStart < end ? boundary(monthStart + 1, end, month) : null;
    }
    const dayStart = boundary(start, end, day);
    if (dayStart !== null) indices.add(dayStart);
    const timestamp = domain.timestamp(start)!;
    const date = parts(timestamp);
    const minutes = date.hour * 60 + date.minute;
    const delta = (minuteStep - (minutes % minuteStep)) % minuteStep;
    const clock = Math.ceil(
      domain.logical(timestamp - (timestamp % 60_000) + delta * 60_000) - 1e-8
    );
    if (clock >= start && clock <= end) indices.add(clock);
  }
  return [...indices].sort((a, b) => a - b);
}
