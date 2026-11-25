import type { Candle, ChartView, HistoryRange, MarketRow, Timeframe } from "./types.js";
import { shiftUtcMonths, utcMonthStart } from "./intervals/calendar.js";

const DAY = 86400000;
export const HISTORY_FALLBACK_FIRST = Date.UTC(1990, 0, 1);
export interface HistoryViewPlan {
  from: number;
  to: number;
  earliest: number;
  knownFirst: boolean;
  mode: "none" | "left" | "anchor" | "camera";
  target: number;
  requiredBars: number;
  intervalMs: number | null;
  visibleTo: number;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function historyViewNeedsWidth(view: ChartView | undefined): boolean {
  return !!view && !finite(view.from) && !!(view.anchor || view.camera || view.barSpace);
}
export function historyFirstDate(row: MarketRow, timeframe: Timeframe): number | null {
  const daily = timeframe === "1d" || timeframe === "1w" || timeframe === "1M";
  for (const value of [
    daily ? row.first1dayCandleDate : row.first1minCandleDate,
    row.firstTradeDate
  ]) {
    const timestamp = value ? Date.parse(value) : NaN;
    if (Number.isFinite(timestamp))
      return timeframe === "1M"
        ? utcMonthStart(timestamp)
        : daily
          ? Math.floor(timestamp / DAY) * DAY
          : timestamp;
  }
  return null;
}
function estimatedBarsFrom(
  anchor: number,
  intervalMs: number | null,
  bars: number,
  paddingDays: number
): number {
  return intervalMs === null
    ? shiftUtcMonths(anchor, -Math.ceil(bars * 1.65)) - paddingDays * DAY
    : anchor - (Math.ceil(((bars * intervalMs) / DAY) * 1.65) + paddingDays) * DAY;
}
function alignHistoryStart(timestamp: number, intervalMs: number | null): number {
  return intervalMs === null ? utcMonthStart(timestamp) : Math.floor(timestamp / DAY) * DAY;
}
export function planHistoryViewRange(options: {
  until: number;
  rangeDays: number;
  intervalMs: number | null;
  period: number;
  first: number | null;
  view?: ChartView | undefined;
  width?: number | undefined;
}): HistoryViewPlan {
  const { until, rangeDays, intervalMs, period, first, view } = options,
    paddingDays = period ? 14 : 0,
    earliest = Math.min(
      until,
      intervalMs === null
        ? utcMonthStart(first ?? HISTORY_FALLBACK_FIRST)
        : (first ?? HISTORY_FALLBACK_FIRST)
    );
  let from = estimatedBarsFrom(until - rangeDays * DAY, intervalMs, period, paddingDays),
    mode: HistoryViewPlan["mode"] = "none",
    target = until,
    requiredBars = 0;
  if (view && finite(view.from)) {
    mode = "left";
    target = Math.min(until, view.from * 1000);
    requiredBars = period;
    from = Math.min(from, estimatedBarsFrom(target, intervalMs, period, paddingDays));
  } else if (view && historyViewNeedsWidth(view)) {
    const width = options.width,
      spacing = view.camera?.barSpace ?? view.barSpace;
    if (!finite(width) || width <= 0 || !finite(spacing) || spacing <= 0)
      throw new Error("Не удалось определить ширину и масштаб сохранённого графика.");
    if (view.anchor) {
      mode = "anchor";
      target = Math.min(until, view.anchor.timestamp);
      requiredBars = Math.ceil((width / spacing) * Math.max(0, view.anchor.xFraction)) + period;
    } else {
      mode = "camera";
      const offset = view.camera?.rightOffsetBars ?? (view.offsetRight ?? 0) / spacing;
      requiredBars = Math.ceil(Math.max(0, width / spacing - offset)) + period;
    }
    if (!Number.isFinite(requiredBars))
      throw new Error("Масштаб сохранённого окна не поддерживается.");
    from = Math.min(from, estimatedBarsFrom(target, intervalMs, requiredBars, 14));
  }
  return {
    from: Math.max(earliest, alignHistoryStart(from, intervalMs)),
    to: until,
    earliest,
    knownFirst: first !== null,
    mode,
    target,
    requiredBars,
    intervalMs,
    visibleTo:
      view && finite(view.to) && (!finite(view.from) || view.to >= view.from)
        ? Math.min(until, view.to * 1000)
        : until
  };
}
export function historyViewCoverage(
  plan: HistoryViewPlan,
  candles: readonly Candle[],
  requestedFrom: number
): { complete: boolean; missingBars: number } {
  if (plan.mode === "none") return { complete: true, missingBars: 0 };
  const count =
      plan.mode === "camera"
        ? Math.max(0, candles.length - 1)
        : candles.filter((bar) => bar.timestamp < plan.target).length,
    missingBars = Math.max(0, plan.requiredBars - count),
    firstReached = plan.knownFirst && requestedFrom <= plan.earliest && candles.length > 0,
    visibleLeftPresent =
      plan.mode !== "left" ||
      (candles[0]?.timestamp ?? Infinity) <= Math.max(plan.target, plan.earliest) ||
      (firstReached && plan.target < plan.earliest);
  return { complete: visibleLeftPresent && (missingBars === 0 || firstReached), missingBars };
}
export function historyViewBackfillStep(plan: HistoryViewPlan, missingBars: number): number {
  return plan.from - historyViewBackfillFrom(plan, plan.from, missingBars);
}
/** Recompute each calendar step from its current cursor; elapsed milliseconds must not be doubled. */
export function historyViewBackfillFrom(
  plan: HistoryViewPlan,
  from: number,
  missingBars: number,
  multiplier = 1
): number {
  if (plan.intervalMs === null)
    return shiftUtcMonths(
      utcMonthStart(from),
      -Math.max(1, Math.ceil(missingBars * 1.65)) * multiplier
    );
  return (
    from -
    Math.max(DAY, Math.ceil(((missingBars * plan.intervalMs) / DAY) * 1.65) * DAY) * multiplier
  );
}

export function historyViewCachedWindow(
  plan: HistoryViewPlan,
  candles: readonly Candle[]
): { from: number; to: number } {
  const before =
    plan.mode === "camera"
      ? Math.max(0, candles.length - 1)
      : candles.filter((bar) => bar.timestamp < plan.target).length;
  return {
    from: candles[Math.max(0, before - plan.requiredBars)]?.timestamp ?? plan.from,
    // Coverage must prove the saved right edge, including empty market intervals.
    // Missing cached candles cannot shorten the interval we need to establish.
    to: plan.visibleTo
  };
}
export function historyRangeCovered(
  ranges: readonly HistoryRange[],
  from: number,
  to: number
): boolean {
  let cursor = from;
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    if (range.to < cursor) continue;
    if (range.from > cursor + 1) return false;
    cursor = Math.max(cursor, range.to);
    if (cursor >= to) return true;
  }
  return false;
}
