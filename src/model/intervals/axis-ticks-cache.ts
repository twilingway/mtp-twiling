import { calendarAxisTicks, hasCalendarAxis } from "./axis-ticks.js";
import type { CalendarAxisTick } from "./axis-ticks.js";

type TickOptions = Parameters<typeof calendarAxisTicks>[2];
type Timeframe = Parameters<typeof calendarAxisTicks>[1];
type TickKey = readonly [
  number,
  Timeframe,
  TickOptions["display"],
  number,
  number,
  number,
  number,
  number
];

/** One result for an affine logical X projection. Callers MUST advance revision on every
 * setData or timestamp insertion/replacement; same-timestamp OHLC updates need no revision.
 * The cache never scans market data to validate its key and never retains the input array.
 */
export class CalendarAxisTicksCache {
  private entry: { key: TickKey; ticks: readonly CalendarAxisTick[] | null } | null = null;

  get(
    data: readonly { timestamp: number }[],
    timeframe: Timeframe,
    options: TickOptions & { revision: number }
  ): readonly CalendarAxisTick[] | null {
    const { revision, from, to, width, coordinate, display } = options;
    if (
      !hasCalendarAxis(timeframe) ||
      !data.length ||
      ![revision, from, to, width].every(Number.isFinite) ||
      width <= 0 ||
      from > to
    ) {
      this.clear();
      return calendarAxisTicks(data, timeframe, options);
    }
    const first = Math.max(0, Math.floor(from));
    const origin = coordinate(first);
    const step = coordinate(first + 1) - origin;
    if (!Number.isFinite(origin) || !Number.isFinite(step) || step === 0) {
      this.clear();
      return calendarAxisTicks(data, timeframe, options);
    }
    const key: TickKey = [revision, timeframe, display, from, to, width, origin, step];
    if (this.entry && key.every((value, index) => Object.is(value, this.entry!.key[index])))
      return this.entry.ticks;
    const ticks = calendarAxisTicks(data, timeframe, options);
    this.entry = { key, ticks };
    return ticks;
  }

  clear(): void {
    this.entry = null;
  }
}
