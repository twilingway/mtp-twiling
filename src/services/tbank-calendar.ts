import type { TBankClient } from "./tbank-client.js";
import type { Timeframe } from "../model/types.js";
import {
  candleCalendarPeriod,
  candleCloseAt,
  candleDuration,
  shiftUtcDate,
  utcDate
} from "../model/candle-clock.js";
import type { TradingCalendarDay, TradingCalendarInterval } from "../model/candle-clock.js";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const timestamp = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
function interval(start: unknown, end: unknown): TradingCalendarInterval | null {
  const from = timestamp(start),
    to = timestamp(end);
  return from !== null && to !== null && from < to ? { start: from, end: to } : null;
}
function mergeIntervals(items: readonly TradingCalendarInterval[]): TradingCalendarInterval[] {
  const result: TradingCalendarInterval[] = [];
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && item.start <= previous.end) previous.end = Math.max(previous.end, item.end);
    else result.push({ ...item });
  }
  return result;
}
function subtractIntervals(
  items: TradingCalendarInterval[],
  excluded: readonly TradingCalendarInterval[]
) {
  for (const gap of excluded)
    items = items.flatMap((item) => {
      if (gap.end <= item.start || gap.start >= item.end) return [item];
      const parts: TradingCalendarInterval[] = [];
      if (item.start < gap.start) parts.push({ start: item.start, end: gap.start });
      if (gap.end < item.end) parts.push({ start: gap.end, end: item.end });
      return parts;
    });
  return items;
}
/** Accept only the requested exchange, including the API's upper/lower-case aliases. */
export function parseTradingCalendar(input: unknown, exchange: string): TradingCalendarDay[] {
  const response = record(input),
    exchanges = response?.exchanges;
  if (!Array.isArray(exchanges)) return [];
  const days = new Map<number, TradingCalendarDay>();
  for (const value of exchanges) {
    const schedule = record(value);
    if (
      typeof schedule?.exchange !== "string" ||
      schedule.exchange.toLowerCase() !== exchange.toLowerCase() ||
      !Array.isArray(schedule.days)
    )
      continue;
    for (const value of schedule.days) {
      const raw = record(value),
        dateValue = timestamp(raw?.date);
      if (!raw || dateValue === null || typeof raw.isTradingDay !== "boolean") continue;
      const date = utcDate(dateValue);
      if (!raw.isTradingDay) {
        days.set(date, { date, isTradingDay: false, start: null, end: null, intervals: [] });
        continue;
      }
      const regular: TradingCalendarInterval[] = [],
        excluded: TradingCalendarInterval[] = [];
      const rawIntervals = Array.isArray(raw.intervals) ? raw.intervals : [];
      for (const item of rawIntervals) {
        const entry = record(item),
          bounds = record(entry?.interval);
        const parsed = interval(bounds?.startTs, bounds?.endTs);
        if (!parsed || typeof entry?.type !== "string") continue;
        const type = entry.type.toLowerCase();
        if (/clearing|auction|break/.test(type)) excluded.push(parsed);
        else if (type.startsWith("regular_trading_session")) regular.push(parsed);
      }
      if (!rawIntervals.length) {
        for (const [start, end] of [
          [raw.startTime, raw.endTime],
          [raw.morningStartTime, raw.morningEndTime],
          [raw.eveningStartTime, raw.eveningEndTime]
        ]) {
          const parsed = interval(start, end);
          if (parsed) regular.push(parsed);
        }
      }
      for (const [start, end] of [
        [raw.clearingStartTime, raw.clearingEndTime],
        [raw.openingAuctionStartTime, raw.openingAuctionEndTime],
        [raw.closingAuctionStartTime, raw.closingAuctionEndTime]
      ]) {
        const parsed = interval(start, end);
        if (parsed) excluded.push(parsed);
      }
      const intervals = subtractIntervals(mergeIntervals(regular), mergeIntervals(excluded));
      const starts = [timestamp(raw.startTime), ...intervals.map((item) => item.start)].filter(
        (item): item is number => item !== null
      );
      const ends = [timestamp(raw.endTime), ...intervals.map((item) => item.end)].filter(
        (item): item is number => item !== null
      );
      days.set(date, {
        date,
        isTradingDay: true,
        start: starts.length ? Math.min(...starts) : null,
        end: ends.length ? Math.max(...ends) : null,
        intervals
      });
    }
  }
  return [...days.values()].sort((a, b) => a.date - b.date);
}

interface Pending<T> {
  promise: Promise<T>;
  controller: AbortController;
  consumers: Set<symbol>;
}
interface CacheEntry<T> {
  expires: number;
  value?: T;
  error?: Error;
  pending?: Pending<T>;
}
interface CalendarCache {
  instruments: Map<string, CacheEntry<string>>;
  schedules: Map<string, CacheEntry<TradingCalendarDay[]>>;
  provedDays: Map<string, Map<number, TradingCalendarDay>>;
}
const clients = new WeakMap<TBankClient, CalendarCache>();
const aborted = () => new DOMException("Отменено", "AbortError");
const copyDays = (days: readonly TradingCalendarDay[]) =>
  days.map((day) => ({ ...day, intervals: day.intervals.map((item) => ({ ...item })) }));
function pruneProvedDays(cache: CalendarCache, today: number, now: number): void {
  for (const [exchange, days] of cache.provedDays) {
    for (const [date, day] of days)
      if (date < today && (day.end === null || day.end <= now)) days.delete(date);
    if (!days.size) cache.provedDays.delete(exchange);
  }
}
function cached<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  now: number,
  expires: number,
  signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  let entry = map.get(key);
  if (entry?.value !== undefined && now < entry.expires) return Promise.resolve(entry.value);
  if (entry?.error && now < entry.expires) return Promise.reject(entry.error);
  if (!entry?.pending || entry.pending.controller.signal.aborted) {
    entry = { expires };
    const controller = new AbortController(),
      consumers = new Set<symbol>(),
      target = entry,
      startedAt = Date.now();
    const promise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw aborted();
        return load(controller.signal);
      })
      .then((value) => {
        if (controller.signal.aborted) throw aborted();
        if (map.get(key) === target) {
          target.value = value;
          delete target.pending;
        }
        return value;
      })
      .catch((error: unknown) => {
        if (map.get(key) === target) {
          if (controller.signal.aborted || record(error)?.name === "AbortError") map.delete(key);
          else
            map.set(key, {
              expires: now + Math.max(0, Date.now() - startedAt) + 60_000,
              error:
                error instanceof Error
                  ? error
                  : new Error("Календарь недоступен.", { cause: error })
            });
        }
        throw error;
      });
    target.pending = { promise, controller, consumers };
    map.set(key, target);
  }
  const pending = entry.pending;
  if (!pending) return Promise.reject(new Error("Календарь недоступен."));
  const consumer = Symbol();
  pending.consumers.add(consumer);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      signal.removeEventListener("abort", abort);
      pending.consumers.delete(consumer);
    };
    const abort = () => {
      if (settled) return;
      finish();
      if (!pending.consumers.size) {
        pending.controller.abort();
        if (map.get(key) === entry) map.delete(key);
      }
      reject(aborted());
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.promise.then(
      (value) => {
        if (!settled) {
          finish();
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!settled) {
          finish();
          reject(
            error instanceof Error ? error : new Error("Календарь недоступен.", { cause: error })
          );
        }
      }
    );
    if (signal.aborted) abort();
  });
}
export async function loadCandleCalendar(
  client: TBankClient,
  uid: string,
  barTimestamp: number,
  timeframe: Timeframe,
  now: number,
  signal: AbortSignal
): Promise<TradingCalendarDay[]> {
  if (!uid || !Number.isFinite(barTimestamp) || !Number.isFinite(now)) return [];
  if (signal.aborted) throw aborted();
  const duration = candleDuration(timeframe),
    today = utcDate(now);
  let cache = clients.get(client);
  if (cache) pruneProvedDays(cache, today, now);
  if (barTimestamp > now || (duration !== null && barTimestamp + duration <= now)) return [];
  const period = candleCalendarPeriod(duration === null ? barTimestamp : now, timeframe);
  const knownExchange = cache?.instruments.get(uid)?.value;
  const proved = knownExchange ? [...(cache?.provedDays.get(knownExchange)?.values() ?? [])] : [];
  const carriedSession = proved.some(
    (day) =>
      day.date < today &&
      day.isTradingDay &&
      day.end !== null &&
      day.end > now &&
      day.intervals.some((item) => item.start <= now && now < item.end)
  );
  // Midnight does not invalidate an already-confirmed overnight session for this UID/exchange.
  if (carriedSession && candleCloseAt(barTimestamp, timeframe, now, proved) !== null)
    return copyDays(proved);
  if (period.end <= today) return [];
  if (duration !== null && barTimestamp < today && !carriedSession) return [];
  // TradingSchedules rejects historical from dates; never ask for prior trading dates.
  const from = Math.max(today, period.start),
    to = shiftUtcDate(period.end, 1);
  if (!cache) {
    cache = { instruments: new Map(), schedules: new Map(), provedDays: new Map() };
    clients.set(client, cache);
  }
  for (const [key, entry] of cache.schedules)
    if (!entry.pending && entry.expires <= now) cache.schedules.delete(key);
  const exchange = await cached(
    cache.instruments,
    uid,
    now,
    Infinity,
    signal,
    async (requestSignal) => {
      const response = await client.request(
        "InstrumentsService",
        "GetInstrumentBy",
        { idType: "INSTRUMENT_ID_TYPE_UID", id: uid },
        requestSignal
      );
      const instrument = record(response.instrument);
      if (typeof instrument?.exchange !== "string" || !instrument.exchange.trim())
        throw new Error("Площадка инструмента неизвестна.");
      if (typeof instrument.uid === "string" && instrument.uid !== uid)
        throw new Error("Банк вернул другой инструмент.");
      return instrument.exchange.trim().toUpperCase();
    }
  );
  if (signal.aborted) throw aborted();
  const key = JSON.stringify([exchange, from, to, utcDate(now)]);
  // Expiration is checked on bar/date changes; the second-by-second UI tick stays local.
  const days = await cached(
    cache.schedules,
    key,
    now,
    now + 5 * 60_000,
    signal,
    async (requestSignal) => {
      const response = await client.request(
        "InstrumentsService",
        "TradingSchedules",
        {
          exchange,
          from: new Date(from).toISOString(),
          to: new Date(to - 1).toISOString()
        },
        requestSignal
      );
      const result = parseTradingCalendar(response, exchange);
      if (!result.length) throw new Error("Календарь площадки недоступен.");
      return result;
    }
  );
  if (signal.aborted) throw aborted();
  let provedForExchange = cache.provedDays.get(exchange);
  if (!provedForExchange) {
    provedForExchange = new Map();
    cache.provedDays.set(exchange, provedForExchange);
  }
  for (const day of days) provedForExchange.set(day.date, day);
  pruneProvedDays(cache, today, now);
  return copyDays(
    [...(cache.provedDays.get(exchange)?.values() ?? [])].sort((a, b) => a.date - b.date)
  );
}
