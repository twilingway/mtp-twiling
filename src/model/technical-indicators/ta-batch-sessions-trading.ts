import { assertTechnicalBars } from "./data.js";
import { finiteOrNull } from "./primitives.js";
import { convex } from "./channel-average/inputs.js";
import { civilClock, DAY_MS, MINUTE_MS } from "./ta-batch-sessions-calendar.js";
import type { NumericValue, TechnicalBar } from "./types.js";

export interface TradingSession {
  readonly id: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly timeZone?: string;
  readonly visible?: boolean;
}

export interface TradingSessionsContext {
  readonly intraday: boolean;
  readonly exchangeTimeZone?: string;
  readonly tickSize?: number;
}

export interface TradingSessionRange {
  readonly sessionId: string;
  /** Civil midnight of the start date, in UTC storage. Use timestamps for drawing. */
  readonly calendarStartDay: number;
  readonly startTimestamp: number;
  readonly lastTimestamp: number;
  readonly open: NumericValue;
  readonly close: NumericValue;
  readonly high: NumericValue;
  readonly low: NumericValue;
  readonly averageClose: NumericValue;
  readonly tickRange: NumericValue;
  readonly barCount: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface SessionAccumulator {
  range: Omit<Mutable<TradingSessionRange>, "tickRange">;
  closeCount: number;
}

function includeBar(session: SessionAccumulator, bar: TechnicalBar): void {
  const { range } = session;
  range.barCount++;
  range.lastTimestamp = bar.timestamp;
  range.close = bar.close;
  if (bar.high !== null)
    range.high = range.high === null ? bar.high : Math.max(range.high, bar.high);
  if (bar.low !== null) range.low = range.low === null ? bar.low : Math.min(range.low, bar.low);
  if (bar.close !== null) {
    session.closeCount++;
    range.averageClose =
      range.averageClose === null
        ? bar.close
        : convex(range.averageClose, bar.close, 1 / session.closeCount);
  }
}

export function tradingSessionRanges(
  bars: readonly TechnicalBar[],
  sessions: readonly TradingSession[],
  { intraday, exchangeTimeZone, tickSize }: TradingSessionsContext
): TradingSessionRange[] {
  if (!intraday) return [];
  if (sessions.length > 3 || new Set(sessions.map(({ id }) => id)).size !== sessions.length)
    throw new RangeError("Expected up to three distinct trading sessions");
  if (tickSize !== undefined && (!Number.isFinite(tickSize) || tickSize <= 0))
    throw new RangeError("Invalid tick size");
  assertTechnicalBars(bars);
  const ranges: TradingSessionRange[] = [];
  for (const session of sessions) {
    if (session.visible === false) continue;
    const { id, startMinute, endMinute } = session;
    for (const minute of [startMinute, endMinute])
      if (!Number.isInteger(minute) || minute < 0 || minute >= 1440)
        throw new RangeError("Invalid minute of day");
    const clock = civilClock(session.timeZone?.trim() || exchangeTimeZone?.trim() || "");
    const overnight = endMinute <= startMinute;
    const days = new Map<number, SessionAccumulator>();
    for (const bar of bars) {
      const local = clock(bar.timestamp);
      const localMidnight = Math.floor(local / DAY_MS) * DAY_MS;
      const minute = (local - localMidnight) / MINUTE_MS;
      const afterStart = minute >= startMinute;
      const beforeEnd = minute < endMinute;
      if (overnight ? !afterStart && !beforeEnd : !afterStart || !beforeEnd) continue;

      const calendarStartDay = overnight && beforeEnd ? localMidnight - DAY_MS : localMidnight;
      let range = days.get(calendarStartDay);
      if (!range) {
        range = {
          range: {
            sessionId: id,
            calendarStartDay,
            startTimestamp: bar.timestamp,
            lastTimestamp: bar.timestamp,
            open: bar.open,
            close: null,
            high: null,
            low: null,
            averageClose: null,
            barCount: 0
          },
          closeCount: 0
        };
        days.set(calendarStartDay, range);
      }
      includeBar(range, bar);
    }
    for (const { range } of days.values()) {
      const { high, low } = range;
      const tickRange =
        high === null || low === null || tickSize === undefined
          ? null
          : finiteOrNull(Math.round((high - low) / tickSize));
      ranges.push({ ...range, tickRange });
    }
  }
  return ranges.sort((a, b) => a.startTimestamp - b.startTimestamp);
}
