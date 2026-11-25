import type { Candle } from "../types.js";
import { items, numeric, quote, record, date } from "./data.js";

export const DAY = 86400000;
export function dailyCandles(value: unknown): Candle[] {
  return items(record(value)?.candles).flatMap((raw) => {
    const time = date(raw.time),
      close = quote(raw.close),
      open = quote(raw.open),
      high = quote(raw.high),
      low = quote(raw.low),
      volume = numeric(raw.volume);
    if (
      raw.isComplete !== true ||
      !time ||
      close === null ||
      open === null ||
      high === null ||
      low === null ||
      volume === null ||
      close <= 0 ||
      open <= 0 ||
      low <= 0 ||
      high < low ||
      high < close ||
      high < open ||
      low > close ||
      low > open ||
      volume < 0 ||
      !Number.isSafeInteger(volume)
    )
      return [];
    return [{ timestamp: Date.parse(time), close, open, high, low, volume }];
  });
}
export function mergeDaily(...sources: Candle[][]): Candle[] {
  return [...new Map(sources.flat().map((bar) => [bar.timestamp, bar])).values()].sort(
    (a, b) => a.timestamp - b.timestamp
  );
}
/** Conservative coverage guard, not a reconstruction of the exchange calendar. */
export function covered(bars: Candle[], from: number, to: number): boolean {
  const relevant = bars.filter((bar) => bar.timestamp >= from - 7 * DAY && bar.timestamp <= to);
  return (
    relevant.length >= 2 &&
    relevant[0]!.timestamp <= from &&
    relevant.at(-1)!.timestamp >= to - 7 * DAY &&
    relevant.every(
      (bar, index) => index === 0 || bar.timestamp - relevant[index - 1]!.timestamp <= 14 * DAY
    )
  );
}
export interface PriceStats {
  count: number;
  from: number | null;
  to: number | null;
  average30: number | null;
  returns: { months: number; value: number | null }[];
}
export function priceStats(bars: Candle[], now: number): PriceStats {
  const daily = mergeDaily(bars).filter((bar) => bar.timestamp < Math.floor(now / DAY) * DAY);
  const last = daily.at(-1),
    recent = daily.slice(-30);
  return {
    count: daily.length,
    from: daily[0]?.timestamp ?? null,
    to: last?.timestamp ?? null,
    average30:
      recent.length === 30 && covered(recent, recent[0]!.timestamp, now - DAY)
        ? recent.reduce((sum, bar) => sum + bar.volume, 0) / 30
        : null,
    returns: [1, 3, 6, 12].map((months) => {
      if (!last) return { months, value: null };
      const targetDate = new Date(last.timestamp);
      const day = targetDate.getUTCDate();
      targetDate.setUTCDate(1);
      targetDate.setUTCMonth(targetDate.getUTCMonth() - months);
      const month = targetDate.getUTCMonth();
      targetDate.setUTCDate(day);
      if (targetDate.getUTCMonth() !== month) targetDate.setUTCDate(0);
      const target = targetDate.getTime(),
        first = daily.findLast((bar) => bar.timestamp <= target);
      return {
        months,
        value:
          first &&
          first.close > 0 &&
          target - first.timestamp <= 7 * DAY &&
          covered(daily, first.timestamp, now - DAY)
            ? (last.close / first.close - 1) * 100
            : null
      };
    })
  };
}
export interface SeasonalMonth {
  month: number;
  count: number;
  average: number | null;
  positive: number | null;
}
export function seasonality(bars: Candle[], now: number): SeasonalMonth[] {
  const daily = mergeDaily(bars),
    observations: number[][] = Array.from({ length: 12 }, () => []);
  const current = new Date(now),
    thisMonth = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1);
  const groups = new Map<string, Candle[]>();
  for (const bar of daily) {
    if (bar.timestamp >= thisMonth) continue;
    const key = new Date(bar.timestamp).toISOString().slice(0, 7);
    const group = groups.get(key) ?? [];
    group.push(bar);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const [year, month] = key.split("-").map(Number),
      start = Date.UTC(year!, month! - 1, 1),
      end = Date.UTC(year!, month, 1) - DAY;
    const previous = daily.findLast((bar) => bar.timestamp < start),
      last = group.at(-1)!;
    if (
      group.length < 10 ||
      group[0]!.timestamp > start + 7 * DAY ||
      last.timestamp < end - 7 * DAY ||
      !previous ||
      start - previous.timestamp > 10 * DAY ||
      !covered(daily, previous.timestamp, end)
    )
      continue;
    observations[month! - 1]!.push((last.close / previous.close - 1) * 100);
  }
  return observations.map((values, month) => ({
    month,
    count: values.length,
    average:
      values.length >= 3 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    positive:
      values.length >= 3 ? (values.filter((value) => value > 0).length / values.length) * 100 : null
  }));
}
