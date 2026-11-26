import type { SpotTradeHistory } from "../../market-trades.js";
import type { VolumeProfileRow } from "../ta-batch-fib-key-levels.js";

export interface PriceVolumeRange {
  readonly from: number;
  readonly to: number;
}

/** Drop the preceding trade seed, which is outside the certified interval. */
export type PriceVolumeTradeHistory = Pick<
  SpotTradeHistory,
  "instrumentKey" | "coverage" | "trades"
>;

export const KEY_LEVEL_PROFILE_ROWS = 24;
const MAX_RETAINED_TRADES = 50_000;
const validRange = ({ from, to }: PriceVolumeRange) =>
  Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from;

function priceTicks(price: number, step: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const ticks = price / step;
  const rounded = Math.round(ticks);
  const tolerance = Math.min(0.1, Math.max(1, Math.abs(ticks)) * 8 * Number.EPSILON);
  return Number.isSafeInteger(rounded) &&
    Math.abs(rounded) <= Number.MAX_SAFE_INTEGER / 2 &&
    Math.abs(rounded - ticks) <= tolerance
    ? rounded
    : null;
}

function nearestRowWidth(tickCount: number, rows: number): number {
  const exact = tickCount / rows;
  const lower = Math.max(1, Math.floor(exact)),
    upper = Math.max(1, Math.ceil(exact));
  return Math.abs(Math.ceil(tickCount / lower) - rows) <=
    Math.abs(Math.ceil(tickCount / upper) - rows)
    ? lower
    : upper;
}

export function priceVolumeProfile(
  history: PriceVolumeTradeHistory | undefined,
  range: PriceVolumeRange,
  priceStep: number | undefined,
  targetRows = KEY_LEVEL_PROFILE_ROWS
): VolumeProfileRow[] {
  const coverage = history?.coverage;
  if (
    !history ||
    !coverage ||
    !validRange(range) ||
    !validRange(coverage) ||
    range.from < coverage.from ||
    range.to > coverage.to ||
    priceStep === undefined ||
    !Number.isFinite(priceStep) ||
    priceStep <= 0 ||
    !Number.isInteger(targetRows) ||
    targetRows < 1 ||
    targetRows > 1000
  )
    return [];

  const sizes = new Map<number, number>();
  const seen = new Set<string>();
  let minimum = Infinity,
    maximum = -Infinity,
    previousTime = -Infinity;
  for (const trade of history.trades) {
    const { id, timestamp, price, quantity } = trade;
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < previousTime ||
      timestamp < coverage.from ||
      timestamp >= coverage.to
    )
      return [];
    previousTime = timestamp;
    if (timestamp < range.from || timestamp >= range.to) continue;
    const tick = priceTicks(price, priceStep);
    if (!id || seen.has(id) || tick === null || !Number.isFinite(quantity) || quantity <= 0)
      return [];
    seen.add(id);
    const sum = (sizes.get(tick) ?? 0) + quantity;
    if (!Number.isFinite(sum)) return [];
    sizes.set(tick, sum);
    minimum = Math.min(minimum, tick);
    maximum = Math.max(maximum, tick);
  }
  if (!sizes.size) return [];
  const count = maximum - minimum + 1;
  const rowTicks = nearestRowWidth(count, targetRows);
  const volumes = Array<number>(Math.ceil(count / rowTicks)).fill(0);
  for (const [tick, quantity] of sizes) {
    const index = Math.floor((tick - minimum) / rowTicks);
    volumes[index] = volumes[index]! + quantity;
  }
  const result: VolumeProfileRow[] = [];
  let low = (minimum - 0.5) * priceStep;
  for (const [index, volume] of volumes.entries()) {
    const high = (minimum + Math.min(count, (index + 1) * rowTicks) - 0.5) * priceStep;
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(volume) || high <= low)
      return [];
    result.push({ low, high, volume });
    low = high;
  }
  return result;
}

/** Join contiguous verified reads for the same symbol. Keep complete timestamp groups at the cap. */
export function mergePriceVolumeHistory(
  previous: PriceVolumeTradeHistory | undefined,
  next: PriceVolumeTradeHistory
): PriceVolumeTradeHistory {
  const a = previous?.coverage,
    b = next.coverage;
  if (
    !previous ||
    previous.instrumentKey !== next.instrumentKey ||
    !a ||
    !b ||
    !validRange(a) ||
    !validRange(b) ||
    a.from > b.to ||
    b.from > a.to
  )
    return next;
  const unique = new Map(previous.trades.map((trade) => [trade.id, trade]));
  for (const trade of next.trades) {
    const existing = unique.get(trade.id);
    if (
      existing &&
      (existing.price !== trade.price ||
        existing.quantity !== trade.quantity ||
        existing.timestamp !== trade.timestamp)
    )
      return next;
    unique.set(trade.id, trade);
  }
  const from = Math.min(a.from, b.from),
    to = Math.max(a.to, b.to);
  const trades = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
  if (trades.length <= MAX_RETAINED_TRADES)
    return { instrumentKey: next.instrumentKey, coverage: { from, to }, trades };
  const cutoff = trades[trades.length - MAX_RETAINED_TRADES - 1]!.timestamp + 1;
  return cutoff < to
    ? {
        instrumentKey: next.instrumentKey,
        coverage: { from: cutoff, to },
        trades: trades.filter(({ timestamp }) => timestamp >= cutoff)
      }
    : { instrumentKey: next.instrumentKey, coverage: null, trades: [] };
}
