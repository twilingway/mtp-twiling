import { validProviderIdentity } from "../model/market-provider.js";
import { isCorrelationComparisonUid } from "../model/technical-indicators/catalog-expansion/correlation.js";
import type { CorrelationComparisonSeries } from "../model/technical-indicators/catalog-expansion/correlation.js";
import { assertTechnicalBars } from "../model/technical-indicators/data.js";
import type { Candle, HistoryRange, MarketRow, Timeframe } from "../model/types.js";
import type { CandleOptions, CandleResult } from "./types.js";

export interface CorrelationComparisonInstrument {
  readonly uid: string;
  readonly symbol: string;
}

export interface CorrelationCandleReader {
  loadCandles(
    symbol: string,
    timeframe: Timeframe,
    range: HistoryRange,
    options: CandleOptions
  ): Promise<Pick<CandleResult, "symbol" | "timeframe" | "candles">>;
}
export type CorrelationCandleSeries = CorrelationComparisonSeries & { bars: Candle[] };

/** Resolve only a single saved instrument using its exact UID, including its provider and category. */
export function selectCorrelationComparison(
  rows: readonly MarketRow[],
  comparisonUid: string,
  primaryUid: string
): CorrelationComparisonInstrument | null {
  if (comparisonUid === primaryUid || !isCorrelationComparisonUid(comparisonUid)) return null;
  const matches = rows.filter((row) => row.uid === comparisonUid);
  const match = matches[0];
  return matches.length === 1 && match?.symbol && validProviderIdentity(match)
    ? { uid: comparisonUid, symbol: match.symbol }
    : null;
}

/** Background history loader. A chart reroute or session shutdown aborts the caller's signal. */
export async function loadCorrelationComparison(
  reader: CorrelationCandleReader,
  instrument: CorrelationComparisonInstrument,
  timeframe: Timeframe,
  range: HistoryRange,
  signal: AbortSignal
): Promise<CorrelationCandleSeries> {
  signal.throwIfAborted();
  const { from, to } = range;
  const { uid, symbol } = instrument;
  if (
    !isCorrelationComparisonUid(uid) ||
    !symbol ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from > to
  )
    throw new RangeError("Invalid correlation comparison history request");
  const result = await reader.loadCandles(symbol, timeframe, { from, to }, { uid, signal });
  signal.throwIfAborted();
  if (result.symbol !== symbol || result.timeframe !== timeframe)
    throw new RangeError("Comparison history does not match its requested symbol and interval");
  assertTechnicalBars(result.candles);
  if (result.candles.some((bar) => !Number.isSafeInteger(bar.timestamp)))
    throw new RangeError("Comparison candles require integer UTC milliseconds");
  const bars = result.candles.filter((bar) => bar.timestamp >= from && bar.timestamp <= to);
  return { instrumentUid: uid, timeframe, bars };
}
