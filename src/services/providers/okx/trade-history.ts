import type { SpotTrade, SpotTradeHistory } from "../../../model/market-trades.js";
import type { OkxHttp } from "./http.js";
import { OkxError, okxPositiveDecimal, okxRecord, okxSeriesId, okxTimestamp } from "./types.js";
import type { OkxProviderRef } from "./types.js";

interface TradeRange {
  readonly from: number;
  readonly to: number;
}

export type OkxSpotTrade = SpotTrade;
export type OkxSpotTradeHistory = SpotTradeHistory;

const PAGE_SIZE = 100;
const MAX_PAGES = 12;

function parseTrade(input: unknown, symbol: string) {
  const row = okxRecord(input);
  const id = row.tradeId;
  const timestamp = okxTimestamp(row.ts);
  const price = okxPositiveDecimal(row.px);
  const quantity = okxPositiveDecimal(row.sz);
  if (
    row.instId !== symbol ||
    typeof id !== "string" ||
    !/^[1-9][0-9]{0,29}$/.test(id) ||
    timestamp === null ||
    price === null ||
    quantity === null
  )
    throw new OkxError("protocol", "Invalid OKX spot trade values");
  const trade: OkxSpotTrade = { id, timestamp, price, quantity };
  return { sequence: BigInt(id), trade };
}

export async function loadOkxSpotTradeHistory(
  http: Pick<OkxHttp, "get">,
  ref: OkxProviderRef,
  range: TradeRange,
  signal?: AbortSignal,
  maxPages = 8
): Promise<OkxSpotTradeHistory> {
  const instrumentKey = okxSeriesId(ref);
  const { from, to } = range;
  if (
    ref.category !== "spot" ||
    okxTimestamp(from) === null ||
    okxTimestamp(to) === null ||
    from >= to ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > MAX_PAGES
  )
    throw new RangeError("Invalid OKX spot trade window");

  const descending: OkxSpotTrade[] = [];
  let cursor: { sequence: bigint; trade: OkxSpotTrade } | undefined;
  let prior: OkxSpotTrade | undefined;
  pages: for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const raw = await http.get(
      "/api/v5/market/history-trades",
      {
        instId: ref.symbol,
        type: cursor ? "1" : "2",
        after: cursor?.trade.id ?? String(to),
        limit: String(PAGE_SIZE)
      },
      signal
    );
    signal?.throwIfAborted();
    if (raw.length > PAGE_SIZE) throw new OkxError("pagination", "Oversized OKX spot trade page");
    if (!raw.length) break;
    const rows = raw
      .map((entry) => parseTrade(entry, ref.symbol))
      .sort((a, b) => (a.sequence === b.sequence ? 0 : a.sequence > b.sequence ? -1 : 1));
    for (const row of rows) {
      if (
        row.trade.timestamp >= to ||
        (cursor &&
          (row.sequence >= cursor.sequence || row.trade.timestamp > cursor.trade.timestamp))
      )
        throw new OkxError("pagination", "Non-monotonic OKX spot trade page");
      // A missing sequence number means the older portion cannot be certified.
      if (cursor && row.sequence !== cursor.sequence - 1n) break pages;
      if (row.trade.timestamp < from) {
        prior = row.trade;
        break pages;
      }
      descending.push(row.trade);
      cursor = row;
    }
  }

  if (prior)
    return { instrumentKey, coverage: { from, to }, previous: prior, trades: descending.reverse() };
  const oldest = descending.at(-1)?.timestamp;
  // The oldest loaded millisecond can straddle a page. It supplies a seed, never an output.
  const start = oldest === undefined ? to : oldest + 1;
  if (start >= to) return { instrumentKey, coverage: null, previous: null, trades: [] };
  const oldestIndex = descending.findIndex((trade) => trade.timestamp < start);
  return {
    instrumentKey,
    coverage: { from: start, to },
    previous: descending[oldestIndex]!,
    trades: descending.slice(0, oldestIndex).reverse()
  };
}
