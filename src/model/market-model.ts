import type { Candle, CatalogInstrument, MarketRow } from "./types.js";
interface WatchlistItem {
  symbol: string;
  name: string;
  color: string;
  mark: string;
  type?: "index" | "future";
  note?: string;
}
export const WATCHLIST: WatchlistItem[] = [
  { symbol: "SBER", name: "Сбербанк", color: "#21a675", mark: "С" },
  { symbol: "GAZP", name: "Газпром", color: "#008fc7", mark: "Г" },
  { symbol: "NVTK", name: "НОВАТЭК", color: "#1759a6", mark: "Н" },
  { symbol: "SIBN", name: "Газпром нефть", color: "#008fc7", mark: "Г" },
  { symbol: "LKOH", name: "ЛУКОЙЛ", color: "#e72642", mark: "Л" },
  { symbol: "ROSN", name: "Роснефть", color: "#e4b731", mark: "Р" },
  { symbol: "OZON", name: "Озон", color: "#005bff", mark: "О" },
  { symbol: "VTBR", name: "ВТБ", color: "#154fb8", mark: "В" },
  {
    symbol: "RTSI",
    name: "Индекс РТС",
    type: "index",
    color: "#5476bc",
    mark: "Р"
  },
  {
    symbol: "IMOEX",
    name: "Индекс Мосбиржи",
    type: "index",
    color: "#da3b4f",
    mark: "М",
    note: "Индекс Мосбиржи; на вашем скриншоте обозначен IRUS"
  },
  { symbol: "MOEX", name: "Московская биржа", color: "#ea2946", mark: "М" },
  { symbol: "T", name: "Т-Технологии", color: "#e0bb27", mark: "Т" },
  {
    symbol: "NG",
    name: "Природный газ",
    type: "future",
    color: "#31a8de",
    mark: "Г"
  },
  { symbol: "YDEX", name: "Яндекс", color: "#ef4935", mark: "Я" }
];

export function quotation(q: unknown): number | null {
  if (!q || typeof q !== "object" || !("units" in q) || q.units == null) return null;
  const nano = "nano" in q ? q.nano : 0;
  if (
    !["string", "number"].includes(typeof q.units) ||
    (nano != null && !["string", "number"].includes(typeof nano))
  )
    return null;
  const value = Number(q.units) + Number(nano ?? 0) / 1e9;
  return Number.isFinite(value) ? value : null;
}

export function dayChange(
  price: number | null,
  previousClose: number | null
): { change: number | null; changePercent: number | null } {
  if (price == null || previousClose == null || previousClose <= 0)
    return { change: null, changePercent: null };
  return {
    change: price - previousClose,
    changePercent: (price / previousClose - 1) * 100
  };
}

export function resolveWatchlist(
  shares: readonly CatalogInstrument[],
  futures: readonly CatalogInstrument[],
  indicatives: readonly CatalogInstrument[],
  now = new Date()
): MarketRow[] {
  return WATCHLIST.map((item) => {
    let candidates;
    if (item.type === "future") {
      candidates = futures
        .filter(
          (i) =>
            /^(NG)([FGHJKMNQUVXZ]\d{1,2}|-)/i.test(i.ticker ?? "") &&
            new Date(i.expirationDate ?? "").getTime() > now.getTime()
        )
        .sort(
          (a, b) =>
            new Date(a.expirationDate ?? "").getTime() - new Date(b.expirationDate ?? "").getTime()
        );
    } else if (item.type === "index") {
      candidates = indicatives.filter((i) => i.ticker?.toUpperCase() === item.symbol);
    } else {
      candidates = shares.filter(
        (i) => i.ticker === item.symbol && ["TQBR", "TQTF"].includes(i.classCode ?? "")
      );
    }
    const instrument = candidates?.[0];
    return {
      ...item,
      uid: instrument?.uid ?? instrument?.instrumentUid ?? null,
      figi: instrument?.figi ?? null,
      ticker: instrument?.ticker ?? item.symbol,
      name: instrument?.name ?? item.name,
      currency: instrument?.currency ?? (item.type === "future" ? "usd" : "rub"),
      brand: instrument?.brand ?? null,
      step: quotation(instrument?.minPriceIncrement),
      expirationDate: instrument?.expirationDate ?? null,
      first1minCandleDate: instrument?.first1minCandleDate,
      first1dayCandleDate: instrument?.first1dayCandleDate,
      firstTradeDate: instrument?.firstTradeDate,
      price: null,
      previousClose: null,
      closeTime: null,
      time: null,
      change: null,
      changePercent: null,
      availability: instrument ? "pending" : "unavailable",
      note:
        item.type === "future" && instrument
          ? `${instrument.ticker} · ближайший контракт, не склейка NG1!`
          : (item.note ?? (instrument ? null : "Не найден в каталоге Т‑Инвестиций"))
    };
  });
}

export const TIMEFRAMES = {
  "1m": { interval: "CANDLE_INTERVAL_1_MIN", days: 1 },
  "5m": { interval: "CANDLE_INTERVAL_5_MIN", days: 1 },
  "15m": { interval: "CANDLE_INTERVAL_15_MIN", days: 1 },
  "1h": { interval: "CANDLE_INTERVAL_HOUR", days: 7 },
  "1d": { interval: "CANDLE_INTERVAL_DAY", days: 365 },
  "1w": { interval: "CANDLE_INTERVAL_WEEK", days: 730 }
};

export function normaliseCandles(candles: unknown): Candle[] {
  const byTime = new Map<number, Candle>();
  const values: unknown[] = Array.isArray(candles) ? candles : [];
  for (const raw of values) {
    if (!isCandleRecord(raw)) continue;
    const timestamp = typeof raw.time === "string" ? Date.parse(raw.time) : NaN;
    const open = quotation(raw.open),
      high = quotation(raw.high),
      low = quotation(raw.low),
      close = quotation(raw.close);
    const volume =
      typeof raw.volume === "string" || typeof raw.volume === "number" ? Number(raw.volume) : 0;
    if (
      Number.isFinite(timestamp) &&
      open !== null &&
      high !== null &&
      low !== null &&
      close !== null
    )
      byTime.set(timestamp, { timestamp, open, high, low, close, volume });
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
}
function isCandleRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
