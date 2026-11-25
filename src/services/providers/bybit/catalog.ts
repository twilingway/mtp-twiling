import type { BybitHttp } from "./http.js";
import {
  BybitError,
  decimal,
  epochMs,
  instrumentRef,
  optionalText,
  record,
  requiredText,
  seriesId
} from "./types.js";
import type { AssetClass, BybitCatalog, BybitCategory, BybitInstrument } from "./types.js";

function assetClass(symbolType: string): AssetClass {
  switch (symbolType) {
    case "":
    case "innovation":
    case "adventure":
      return "crypto";
    case "stock":
      return "stock";
    case "ETF":
      return "etf";
    case "forex":
      return "forex";
    case "commodity":
      return "commodity";
    case "xstocks":
    case "mstocks":
      return "tokenized-stock";
    default:
      return "unknown";
  }
}
export function normaliseInstrument(category: BybitCategory, value: unknown): BybitInstrument {
  const raw = record(value),
    ref = instrumentRef(category, requiredText(raw.symbol));
  const baseCoin = requiredText(raw.baseCoin),
    quoteCoin = requiredText(raw.quoteCoin);
  if (typeof raw.symbolType !== "string")
    throw new BybitError("protocol", "Missing Bybit symbol type");
  const kind = assetClass(raw.symbolType),
    status = requiredText(raw.status);
  const cryptoType =
    category === "spot"
      ? ["", "adventure"].includes(raw.symbolType)
      : ["", "innovation"].includes(raw.symbolType);
  const contractType = optionalText(raw.contractType),
    settleCoin = optionalText(raw.settleCoin);
  const price = raw.priceFilter === undefined ? {} : record(raw.priceFilter);
  const lot = raw.lotSizeFilter === undefined ? {} : record(raw.lotSizeFilter);
  return {
    ref,
    seriesId: seriesId(ref),
    displayTicker: `${baseCoin}/${quoteCoin}`,
    baseCoin,
    quoteCoin,
    settleCoin,
    fullName: optionalText(raw.fullName),
    symbolType: raw.symbolType,
    contractType,
    status,
    assetClass: kind,
    cryptoEligible:
      status === "Trading" &&
      kind === "crypto" &&
      cryptoType &&
      (category === "spot" || (contractType === "LinearPerpetual" && settleCoin === "USDT")),
    marketRegion: optionalText(raw.marketRegion),
    underlyingTicker: optionalText(raw.underlyingTicker),
    tickSize: decimal(price.tickSize),
    quantityStep: decimal(lot.qtyStep ?? lot.basePrecision),
    launchTime: epochMs(raw.launchTime),
    xstockMultiplier: decimal(raw.xstockMultiplier)
  };
}
/** Exact base equality is necessary; conflicting names never enrich spot. */
export function enrichSpotNames(items: readonly BybitInstrument[]): BybitInstrument[] {
  const names = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.ref.category !== "linear" || item.assetClass !== "crypto" || !item.fullName) continue;
    const group = names.get(item.baseCoin) ?? new Set<string>();
    group.add(item.fullName);
    names.set(item.baseCoin, group);
  }
  return items.map((item) => {
    const group = names.get(item.baseCoin);
    return item.ref.category === "spot" &&
      item.assetClass === "crypto" &&
      !item.fullName &&
      group?.size === 1
      ? { ...item, fullName: [...group][0] ?? null }
      : item;
  });
}
export async function loadCatalog(http: BybitHttp, signal?: AbortSignal): Promise<BybitCatalog> {
  const instruments = new Map<string, BybitInstrument>();
  let observedAt = 0;
  for (const category of ["spot", "linear"] as const) {
    let cursor = "";
    const seen = new Set<string>();
    do {
      signal?.throwIfAborted();
      if (seen.size >= 100) throw new BybitError("pagination", "Bybit catalog page limit exceeded");
      const params: Record<string, string> = { category };
      if (category === "linear") params.limit = "1000";
      if (cursor) params.cursor = cursor;
      const response = await http.get("/v5/market/instruments-info", params, signal);
      if (response.result.category !== category || !Array.isArray(response.result.list))
        throw new BybitError("protocol", "Bybit catalog category/list mismatch");
      observedAt = Math.max(observedAt, response.time);
      for (const raw of response.result.list) {
        const item = normaliseInstrument(category, raw);
        instruments.set(item.seriesId, item);
      }
      const next: unknown = response.result.nextPageCursor ?? "";
      if (typeof next !== "string" || (category === "spot" && next))
        throw new BybitError("protocol", "Unexpected Bybit catalog cursor");
      if (next && seen.has(next))
        throw new BybitError("pagination", "Repeated Bybit catalog cursor");
      if (next) seen.add(next);
      cursor = next;
    } while (cursor);
  }
  return { complete: true, observedAt, instruments: enrichSpotNames([...instruments.values()]) };
}
export interface SearchOptions {
  cryptoOnly?: boolean;
  category?: BybitCategory;
  aliases?: Readonly<Record<string, readonly string[]>>;
  limit?: number;
}
function searchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[\s/_:-]+/g, "");
}
export function searchCatalog(
  catalog: BybitCatalog,
  query: string,
  options: SearchOptions = {}
): BybitInstrument[] {
  const needle = searchText(query);
  if (!needle) return [];
  const limit = options.limit ?? 80;
  if (!Number.isInteger(limit) || limit < 1 || limit > 300)
    throw new RangeError("Invalid Bybit search limit");
  return catalog.instruments
    .filter((item) => {
      if ((options.cryptoOnly ?? true) && !item.cryptoEligible) return false;
      if (options.category && item.ref.category !== options.category) return false;
      const aliases = options.aliases?.[item.seriesId] ?? [];
      return [
        item.ref.symbol,
        item.displayTicker,
        item.baseCoin,
        item.quoteCoin,
        item.fullName ?? "",
        ...aliases
      ].some((value) => searchText(value).includes(needle));
    })
    .sort(
      (a, b) =>
        Number(!searchText(a.ref.symbol).startsWith(needle)) -
          Number(!searchText(b.ref.symbol).startsWith(needle)) ||
        a.seriesId.localeCompare(b.seriesId)
    )
    .slice(0, limit);
}
