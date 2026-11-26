import type { TechnicalBar } from "../types.js";
import { civilClock, DAY_MS } from "../ta-batch-sessions-calendar.js";
import type { AnchorStarts, VisibleAverageRange } from "../ta-batch-anchored.js";

export const calendarAnchorPeriods = [
  "session",
  "calendar-day",
  "week",
  "month",
  "quarter",
  "year",
  "decade",
  "century"
] as const;
export type CalendarAnchorPeriod = (typeof calendarAnchorPeriods)[number];

export interface AnchoredIndicatorContext {
  readonly chartIntervalDays?: number;
  readonly exchangeTimeZone?: string;
  readonly continuousSession?: boolean;
  readonly anchoredPeriodStarts?: Readonly<
    Partial<Record<CalendarAnchorPeriod, readonly number[]>>
  >;
  readonly visibleRange?: VisibleAverageRange;
}

export type AnchoredStudyHistory =
  | {
      kind: "anchored-period";
      lookbackBars: null;
      seedPolicy: "first-candle-of-period";
      convergence: "full-input-dependent";
    }
  | {
      kind: "viewport";
      lookbackBars: null;
      seedPolicy: "first-visible-candle";
      convergence: "full-input-dependent";
    };

function periodStart(local: number, period: CalendarAnchorPeriod): number {
  const date = new Date(local);
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth(),
    day = date.getUTCDate();
  switch (period) {
    case "session":
    case "calendar-day":
      return Date.UTC(year, month, day);
    case "week":
      return Date.UTC(year, month, day - ((date.getUTCDay() + 6) % 7));
    case "month":
      return Date.UTC(year, month, 1);
    case "quarter":
      return Date.UTC(year, Math.floor(month / 3) * 3, 1);
    case "year":
      return Date.UTC(year, 0, 1);
    case "decade":
      return Date.UTC(Math.floor(year / 10) * 10, 0, 1);
    case "century":
      return Date.UTC(Math.floor(year / 100) * 100, 0, 1);
  }
}

/** Find confirmed boundaries in the full data, independent of the viewport or display zone. */
export function anchoredPeriodStarts(
  bars: readonly TechnicalBar[],
  anchor: CalendarAnchorPeriod,
  context?: AnchoredIndicatorContext
): AnchorStarts {
  const confirmed = context?.anchoredPeriodStarts?.[anchor];
  if (confirmed) return confirmed;
  if (!bars.length || !context?.exchangeTimeZone || !context.chartIntervalDays) return null;
  const { chartIntervalDays, exchangeTimeZone, continuousSession } = context;
  // Session opening of a non-continuous intraday venue cannot be inferred from civil midnight.
  if (anchor === "session" && !continuousSession && chartIntervalDays < 1) return null;
  const clock =
    exchangeTimeZone === "UTC" || chartIntervalDays >= 1
      ? (timestamp: number) => timestamp
      : civilClock(exchangeTimeZone);
  const starts: number[] = [];
  let previousPeriod: number | undefined;
  const duration = chartIntervalDays * DAY_MS;
  for (const bar of bars) {
    const timestamp = clock(bar.timestamp);
    const period = periodStart(timestamp, anchor);
    if (period !== previousPeriod) {
      // Exchange-wide history starts only at a recorded period transition or exact boundary.
      // For a continuous feed the first bar must also straddle the exact boundary.
      const opening =
        timestamp === period ||
        (previousPeriod !== undefined && (!continuousSession || timestamp < period + duration));
      if (opening) starts.push(bar.timestamp);
      previousPeriod = period;
    }
  }
  return starts;
}
