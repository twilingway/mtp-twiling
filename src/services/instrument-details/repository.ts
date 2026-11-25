import type { Candle } from "../../model/types.js";
import type { InstrumentInfo } from "../../model/instrument-details/data.js";
import {
  instrumentInfo,
  fundamentals,
  dividends,
  reports,
  forecasts
} from "../../model/instrument-details/data.js";
import { covered, dailyCandles, DAY, mergeDaily } from "../../model/instrument-details/history.js";

export interface DetailsClient {
  owner: string;
  authenticated: boolean;
  closed: boolean;
  request(
    service: string,
    method: string,
    body: object,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>>;
}
export function isDetailsClient(value: unknown): value is DetailsClient {
  return (
    value !== null &&
    typeof value === "object" &&
    "owner" in value &&
    typeof value.owner === "string" &&
    "authenticated" in value &&
    typeof value.authenticated === "boolean" &&
    "closed" in value &&
    typeof value.closed === "boolean" &&
    "request" in value &&
    typeof value.request === "function"
  );
}
export type HistoryReader = (
  owner: string,
  uid: string,
  timeframe: "1d",
  from: number,
  to: number
) => Promise<Candle[]>;
export type Section =
  "fundamentals" | "dividends" | "reports" | "forecasts" | "history" | "seasonality";
export interface HistoryData {
  bars: Candle[];
  from: number;
  to: number;
  source: "local" | "api";
  completion: { confirmed: number; unknown: number };
}
export interface SectionData {
  fundamentals: { info: InstrumentInfo; snapshot: ReturnType<typeof fundamentals> };
  dividends: ReturnType<typeof dividends>;
  reports: ReturnType<typeof reports>;
  forecasts: ReturnType<typeof forecasts>;
  history: HistoryData;
  seasonality: HistoryData;
}
export interface Result<T> {
  data: T;
  receivedAt: number;
}
interface Flight {
  controller: AbortController;
  promise: Promise<Result<unknown>>;
  users: number;
  listeners: Set<(done: number, total: number) => void>;
  progress: [number, number];
}
function aborted(): DOMException {
  return new DOMException("Cancelled", "AbortError");
}

/** Session-scoped memory only. No token, persistence, or trading endpoint is exposed here. */
export class InstrumentDetailsRepository {
  private readonly owner: string;
  private readonly cache = new Map<string, { result: Result<unknown>; expires: number }>();
  private readonly pending = new Map<string, Flight>();
  constructor(
    private readonly client: DetailsClient,
    private readonly readHistory: HistoryReader,
    private readonly now = Date.now
  ) {
    this.owner = client.owner;
  }
  private assert(signal: AbortSignal): void {
    if (
      signal.aborted ||
      this.client.closed ||
      !this.client.authenticated ||
      this.client.owner !== this.owner
    )
      throw aborted();
  }
  private async request(method: string, body: object, signal: AbortSignal, market = false) {
    this.assert(signal);
    const result = await this.client.request(
      market ? "MarketDataService" : "InstrumentsService",
      method,
      body,
      signal
    );
    this.assert(signal);
    return result;
  }
  private async instrument(uid: string, signal: AbortSignal): Promise<InstrumentInfo> {
    return (
      await this.shared(`info:${uid}`, signal, 3600000, async (signal) =>
        instrumentInfo(
          await this.request(
            "GetInstrumentBy",
            { idType: "INSTRUMENT_ID_TYPE_UID", id: uid },
            signal
          ),
          uid
        )
      )
    ).data;
  }
  load<K extends Section>(
    uid: string,
    section: K,
    signal: AbortSignal,
    seed: Candle[] = [],
    onProgress?: (done: number, total: number) => void
  ): Promise<Result<SectionData[K]>> {
    return this.shared(
      `${uid}:${section}`,
      signal,
      section === "fundamentals" ? 3600000 : 900000,
      async (signal, progress) => {
        const now = this.now();
        if (section === "history" || section === "seasonality")
          return this.history(uid, section === "seasonality", seed, now, signal, progress);
        const info = await this.instrument(uid, signal);
        if (info.kind !== "share") throw new Error("UNSUPPORTED_INSTRUMENT");
        const from = new Date(now),
          to = new Date(now);
        from.setUTCFullYear(from.getUTCFullYear() - 2);
        to.setUTCFullYear(to.getUTCFullYear() + 1);
        const window = { instrumentId: uid, from: from.toISOString(), to: to.toISOString() };
        if (section === "fundamentals")
          return {
            info,
            snapshot: info.assetUid
              ? fundamentals(
                  await this.request("GetAssetFundamentals", { assets: [info.assetUid] }, signal),
                  info.assetUid
                )
              : null
          };
        if (section === "dividends")
          return dividends(await this.request("GetDividends", window, signal));
        if (section === "reports") {
          from.setTime(now - 90 * DAY);
          return reports(
            await this.request("GetAssetReports", { ...window, from: from.toISOString() }, signal),
            uid
          );
        }
        return forecasts(await this.request("GetForecastBy", { instrumentId: uid }, signal), uid);
      },
      onProgress
    ) as Promise<Result<SectionData[K]>>;
  }
  private async history(
    uid: string,
    long: boolean,
    seed: Candle[],
    now: number,
    signal: AbortSignal,
    progress: (done: number, total: number) => void
  ): Promise<HistoryData> {
    const year = new Date(now).getUTCFullYear();
    const from = long ? Date.UTC(year - 5, 0, 1) : now - 380 * DAY;
    // Stored/chart bars do not retain isComplete. Exclude the two most recent UTC days.
    const cutoff = Math.floor(now / DAY) * DAY - 2 * DAY;
    let local: Candle[] = [];
    try {
      local = await this.readHistory(this.owner, uid, "1d", from, now);
    } catch {
      /* Network remains available when the optional cache cannot be read. */
    }
    this.assert(signal);
    let bars = mergeDaily(local, seed).filter(
      (bar) =>
        bar.timestamp >= from &&
        bar.timestamp < cutoff &&
        [bar.timestamp, bar.close, bar.open, bar.high, bar.low, bar.volume].every(
          Number.isFinite
        ) &&
        bar.close > 0 &&
        bar.volume >= 0
    );
    const intervals: { from: number; to: number }[] = [];
    if (long) {
      for (let y = year - 5; y <= year; y++)
        intervals.push({ from: Date.UTC(y, 0, 1), to: Math.min(now, Date.UTC(y + 1, 0, 1) - 1) });
    } else intervals.push({ from, to: now });
    let usedApi = false;
    const confirmed = new Set<number>();
    progress(0, intervals.length);
    for (const [index, range] of intervals.entries()) {
      this.assert(signal);
      const hasHistory = covered(bars, range.from + 7 * DAY, range.to - DAY);
      // Cached bars have no completion metadata. Verify recent closed days even when the older range is covered.
      const requestFrom = hasHistory
        ? range.to === now
          ? Math.max(range.from, now - 10 * DAY)
          : null
        : range.from;
      if (requestFrom !== null) {
        usedApi = true;
        const response = await this.request(
          "GetCandles",
          {
            instrumentId: uid,
            interval: "CANDLE_INTERVAL_DAY",
            from: new Date(requestFrom).toISOString(),
            to: new Date(range.to).toISOString(),
            limit: 2400
          },
          signal,
          true
        );
        const received = dailyCandles(response).filter(
          (bar) => bar.timestamp >= requestFrom && bar.timestamp <= range.to
        );
        for (const bar of received) confirmed.add(bar.timestamp);
        bars = mergeDaily(bars, received);
      }
      progress(index + 1, intervals.length);
    }
    return {
      bars,
      from,
      to: now,
      source: usedApi ? "api" : "local",
      completion: { confirmed: confirmed.size, unknown: bars.length - confirmed.size }
    };
  }
  private shared<T>(
    key: string,
    signal: AbortSignal,
    ttl: number,
    run: (signal: AbortSignal, progress: (done: number, total: number) => void) => Promise<T>,
    onProgress?: (done: number, total: number) => void
  ): Promise<Result<T>> {
    this.assert(signal);
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return Promise.resolve(cached.result as Result<T>);
    if (cached) this.cache.delete(key);
    let flight = this.pending.get(key);
    if (!flight) {
      const created: Flight = {
        controller: new AbortController(),
        promise: Promise.resolve({ data: null, receivedAt: 0 }),
        users: 0,
        listeners: new Set(),
        progress: [0, 0]
      };
      flight = created;
      this.pending.set(key, created);
      created.promise = Promise.resolve()
        .then(async () => {
          const data = await run(created.controller.signal, (done, total) => {
            created.progress = [done, total];
            for (const listener of created.listeners) listener(done, total);
          });
          this.assert(created.controller.signal);
          const result = { data, receivedAt: this.now() };
          this.cache.set(key, { result, expires: this.now() + ttl });
          while (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!);
          return result;
        })
        .finally(() => {
          if (this.pending.get(key) === created) this.pending.delete(key);
        });
    }
    const active = flight;
    active.users++;
    if (onProgress) {
      active.listeners.add(onProgress);
      onProgress(...active.progress);
    }
    return new Promise<Result<T>>((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        if (onProgress) active.listeners.delete(onProgress);
        if (--active.users === 0 && this.pending.get(key) === active) {
          this.pending.delete(key);
          active.controller.abort();
        }
      };
      const abort = () => {
        release();
        reject(aborted());
      };
      signal.addEventListener("abort", abort, { once: true });
      active.promise.then(
        (result) => {
          if (!finished) {
            release();
            resolve(result as Result<T>);
          }
        },
        (error: unknown) => {
          if (!finished) {
            release();
            reject(error instanceof Error ? error : new Error("DETAILS_REQUEST", { cause: error }));
          }
        }
      );
    });
  }
}

const repositories = new WeakMap<DetailsClient, InstrumentDetailsRepository>();
export function detailsRepository(
  client: DetailsClient,
  readHistory: HistoryReader
): InstrumentDetailsRepository {
  let repository = repositories.get(client);
  if (!repository) {
    repository = new InstrumentDetailsRepository(client, readHistory);
    repositories.set(client, repository);
  }
  return repository;
}
