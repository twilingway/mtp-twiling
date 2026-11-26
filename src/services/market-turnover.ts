import { providerSeriesId } from "../model/market-provider.js";
import type { BybitProviderRef, OkxProviderRef } from "../model/market-provider.js";
import { quoteTurnoverPageBudget } from "../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type {
  QuoteTurnoverBar,
  QuoteTurnoverHistory,
  TurnoverInterval
} from "../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import type { HistoryRange, MarketRow } from "../model/types.js";

export function quoteTurnoverSource(
  row: Pick<MarketRow, "providerRef" | "uid" | "quoteCoin" | "assetClass"> | undefined
) {
  const ref = row?.providerRef;
  if (!ref || !row.quoteCoin || row.assetClass !== "crypto" || row.uid !== providerSeriesId(ref))
    return null;
  return { ref, uid: row.uid, currency: row.quoteCoin };
}

type ReadHistory<Ref> = (
  ref: Ref,
  interval: TurnoverInterval,
  range: HistoryRange & { maxPages: number },
  signal: AbortSignal
) => Promise<readonly QuoteTurnoverBar[]>;

export async function loadPublicQuoteTurnover(
  row: MarketRow,
  interval: TurnoverInterval,
  range: HistoryRange,
  signal: AbortSignal,
  bybit: ReadHistory<BybitProviderRef>,
  okx: ReadHistory<OkxProviderRef>
): Promise<QuoteTurnoverHistory | null> {
  const source = quoteTurnoverSource(row);
  if (!source) return null;
  const { ref, uid, currency } = source;
  const maxPages = quoteTurnoverPageBudget(interval, range, ref.provider === "bybit" ? 1000 : 300);
  signal.throwIfAborted();
  const history =
    ref.provider === "bybit"
      ? await bybit(ref, interval, { ...range, maxPages }, signal)
      : await okx(ref, interval, { ...range, maxPages }, signal);
  signal.throwIfAborted();
  const bars = history
    .filter(({ timestamp }) => timestamp >= range.from && timestamp <= range.to)
    .map(({ timestamp, quoteTurnover }) => ({ timestamp, quoteTurnover }));
  return { instrumentKey: uid, currency, interval, range, bars };
}
