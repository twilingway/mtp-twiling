import type { Candle, ChartView, HistoryRange, MarketRow, Timeframe } from "./types.js";

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
  intervalMs: number;
  visibleTo: number;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function historyViewNeedsWidth(view: ChartView | undefined): boolean {
  return !!view && !finite(view.from) && !!(view.anchor || view.camera || view.barSpace);
}
export function historyFirstDate(row: MarketRow, timeframe: Timeframe): number | null {
  const daily = timeframe === "1d" || timeframe === "1w";
  for (const value of [
    daily ? row.first1dayCandleDate : row.first1minCandleDate,
    row.firstTradeDate
  ]) {
    const timestamp = value ? Date.parse(value) : NaN;
    if (Number.isFinite(timestamp)) return daily ? Math.floor(timestamp / DAY) * DAY : timestamp;
  }
  return null;
}
export function planHistoryViewRange(options: {
  until: number;
  rangeDays: number;
  intervalMs: number;
  period: number;
  first: number | null;
  view?: ChartView | undefined;
  width?: number | undefined;
}): HistoryViewPlan {
  const { until, rangeDays, intervalMs, period, first, view } = options,
    warmupDays = Math.ceil(((period * intervalMs) / DAY) * 1.65) + (period ? 14 : 0),
    earliest = Math.min(until, first ?? HISTORY_FALLBACK_FIRST);
  let from = Math.floor((until - (rangeDays + warmupDays) * DAY) / DAY) * DAY,
    mode: HistoryViewPlan["mode"] = "none",
    target = until,
    requiredBars = 0;
  if (view && finite(view.from)) {
    mode = "left";
    target = Math.min(until, view.from * 1000);
    requiredBars = period;
    from = Math.min(from, target - warmupDays * DAY);
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
    const estimatedDays = Math.ceil(((requiredBars * intervalMs) / DAY) * 1.65) + 14;
    from = Math.min(from, target - estimatedDays * DAY);
  }
  return {
    from: Math.max(earliest, Math.floor(from / DAY) * DAY),
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
  return Math.max(DAY, Math.ceil(((missingBars * plan.intervalMs) / DAY) * 1.65) * DAY);
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
