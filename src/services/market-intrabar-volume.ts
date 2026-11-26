import { providerSeriesId } from "../model/market-provider.js";
import type { BybitProviderRef, OkxProviderRef } from "../model/market-provider.js";
import type { IntrabarVolumeHistory } from "../model/technical-indicators/ta-batch-volume-intrabars.js";
import { quoteTurnoverPageBudget } from "../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type { TurnoverInterval } from "../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type { HistoryRange, MarketRow } from "../model/types.js";

export function intrabarVolumeSource(
  row: Pick<MarketRow, "providerRef" | "uid" | "baseCoin" | "assetClass"> | undefined
) {
  const ref = row?.providerRef;
  if (!ref || !row.baseCoin || row.assetClass !== "crypto" || row.uid !== providerSeriesId(ref))
    return null;
  return { ref, uid: row.uid, currency: row.baseCoin };
}

interface LowerVolumeQuote {
  timestamp: number;
  open: number;
  close: number;
  baseVolume: number;
}

type ReadHistory<Ref> = (
  ref: Ref,
  interval: TurnoverInterval,
  range: HistoryRange & { maxPages: number },
  signal: AbortSignal
) => Promise<readonly LowerVolumeQuote[]>;

export async function loadPublicIntrabarVolume(
  row: MarketRow,
  interval: TurnoverInterval,
  range: HistoryRange,
  signal: AbortSignal,
  bybit: ReadHistory<BybitProviderRef>,
  okx: ReadHistory<OkxProviderRef>
): Promise<IntrabarVolumeHistory | null> {
  const source = intrabarVolumeSource(row);
  if (!source) return null;
  const { ref, uid, currency } = source;
  const maxPages = quoteTurnoverPageBudget(interval, range, ref.provider === "bybit" ? 1000 : 300);
  signal.throwIfAborted();
  const data =
    ref.provider === "bybit"
      ? await bybit(ref, interval, { ...range, maxPages }, signal)
      : await okx(ref, interval, { ...range, maxPages }, signal);
  signal.throwIfAborted();
  return {
    instrumentKey: uid,
    currency,
    interval,
    range,
    bars: data
      .filter(({ timestamp }) => timestamp >= range.from && timestamp <= range.to)
      .map(({ timestamp, open, close, baseVolume }) => ({
        timestamp,
        open,
        close,
        volume: baseVolume
      }))
  };
}
