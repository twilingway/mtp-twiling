import type { CandleCalendarPeriod } from "../model/candle-clock.js";
import { mergeCandles } from "../model/history-codec.js";
import type { Candle, HistoryRange } from "../model/types.js";
import {
  nativePriceLevelInterval,
  normalizePriceLevelPeriods,
  priceLevelCalendarPeriod,
  shiftPriceLevelCalendarStart
} from "../model/technical-indicators/catalog-expansion/level-periods.js";
import type {
  NativePriceLevelInterval,
  PriceLevelHistoryRequest,
  PriceLevelVenue
} from "../model/technical-indicators/catalog-expansion/level-periods.js";
import type { PricePeriod } from "../model/technical-indicators/ta-batch-pivots-periods.js";
import type { CandleOptions, CandleResult } from "./types.js";

type ReadHistoryCandles = (
  symbol: string,
  timeframe: NativePriceLevelInterval,
  range: HistoryRange,
  options?: CandleOptions
) => Promise<CandleResult>;

export interface PriceLevelHistorySource {
  readonly loadCandles: ReadHistoryCandles;
  readonly symbol: string;
  readonly uid: string;
  readonly venue: PriceLevelVenue;
  readonly asOf: number;
  readonly signal: AbortSignal;
  readonly sessionBounds?: ReadonlyMap<number, CandleCalendarPeriod>;
  /** Persistent coverage can confirm earlier bank ranges even when the read does not report it. */
  readonly coveredRanges?: (
    timeframe: NativePriceLevelInterval
  ) => Promise<readonly HistoryRange[]>;
}

/** Load supplemental candles without replacing the active native market subscription. */
export async function loadPriceLevelPeriods(
  { interval, from, to, precedingTradingPeriods }: PriceLevelHistoryRequest,
  source: PriceLevelHistorySource
): Promise<PricePeriod[]> {
  const { signal, asOf, symbol, uid } = source;
  signal.throwIfAborted();
  if (
    ![from, to, asOf].every(Number.isSafeInteger) ||
    from < 0 ||
    to < from ||
    asOf < from ||
    !Number.isInteger(precedingTradingPeriods) ||
    precedingTradingPeriods < 0 ||
    precedingTradingPeriods > 100
  )
    throw new RangeError("Invalid supplemental price level range");

  const firstPeriod = priceLevelCalendarPeriod(from, interval);
  const timeframe = nativePriceLevelInterval(interval);
  const end = Math.min(asOf, priceLevelCalendarPeriod(to, interval).end - 1);
  let nextTo = end;
  let start = Math.max(
    0,
    shiftPriceLevelCalendarStart(firstPeriod.start, interval, -precedingTradingPeriods)
  );
  let bars: Candle[] = [];
  const coverage: HistoryRange[] = [];
  const extendSearch = Math.max(1, precedingTradingPeriods);
  // A bank day can be sparse due to holidays; use separate bounded reads to find the last actual bar.
  for (let attempt = 0; attempt < 4; attempt++) {
    const range = { from: start, to: nextTo };
    if (range.to <= range.from) break;
    const result = await source.loadCandles(symbol, timeframe, range, { uid, signal });
    signal.throwIfAborted();
    if (result.timeframe !== timeframe || result.symbol !== symbol)
      throw new RangeError("Supplemental history came from another chart source");
    bars = mergeCandles(
      result.candles.filter(({ timestamp }) => timestamp >= range.from && timestamp <= range.to),
      bars
    );
    if (result.requestedRangeCovered) coverage.push({ from: start, to: nextTo + 1 });
    const persisted = (await source.coveredRanges?.(timeframe)) ?? [];
    signal.throwIfAborted();
    const periods = normalizePriceLevelPeriods(bars, interval, {
      venue: source.venue,
      asOf,
      coveredRanges: [...coverage, ...persisted],
      ...(source.sessionBounds ? { sessionBounds: source.sessionBounds } : {})
    });
    const firstVisible = periods.findIndex(({ endsAt }) => endsAt > from);
    const enoughHistory = firstVisible >= precedingTradingPeriods;
    if (
      enoughHistory ||
      start === 0 ||
      attempt === 3 ||
      source.venue !== "tbank" ||
      (!result.requestedRangeCovered && persisted.length === 0)
    ) {
      return firstVisible < 0
        ? []
        : periods.slice(Math.max(0, firstVisible - precedingTradingPeriods));
    }
    nextTo = start - 1;
    start = Math.max(
      0,
      shiftPriceLevelCalendarStart(start, interval, -(extendSearch * 2 ** attempt))
    );
  }
  return [];
}
