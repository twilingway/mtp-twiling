import {
  BybitHttp,
  BybitStream,
  loadCatalog,
  loadHistory,
  loadQuotes,
  searchCatalog,
  nativeInterval
} from "./providers/bybit/index.js";
import type { BybitCatalog, BybitCategory, BybitQuote } from "./providers/bybit/types.js";
import type { BybitStreamOptions } from "./providers/bybit/websocket.js";
import type { BybitInterval } from "./providers/bybit/market.js";
import { publicCatalogInstrument } from "./market-public-mapping.js";
import { TIMEFRAMES, mergeCandles, subtractRanges } from "../model/history-codec.js";
import { shiftTimeframe } from "../model/intervals/calendar.js";
import type {
  Candle,
  CatalogInstrument,
  MarketRow,
  Timeframe,
  HistoryRange,
  InstrumentSearchKind
} from "../model/types.js";
import type { Cache, CandleOptions, CandleResult, CandleEvent } from "./types.js";
export interface PublicMarketOptions {
  http?: BybitHttp;
  stream?: (
    category: BybitCategory,
    options: BybitStreamOptions
  ) => Pick<BybitStream, "setSubscriptions" | "start" | "dispose">;
  online?: () => boolean;
}
interface Events {
  quote(quote: BybitQuote): void;
  candle(event: CandleEvent): void;
  notice(message: string): void;
  reconnect(category: BybitCategory): void;
}
export class PublicMarket {
  cachePaused = false;
  private catalog: BybitCatalog | undefined;
  private catalogRequest: Promise<BybitCatalog> | undefined;
  private readonly lifetime = new AbortController();
  private readonly http: BybitHttp;
  private readonly streams = new Map<
    BybitCategory,
    Pick<BybitStream, "setSubscriptions" | "start" | "dispose">
  >();
  private readonly opened = new Set<BybitCategory>();
  private rows: readonly MarketRow[] = [];
  private selection: { row: MarketRow; timeframe: Timeframe } | null = null;
  private live = new Map<string, { uid: string; timeframe: Timeframe; bars: Candle[] }>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly owner: () => string,
    private readonly cache: Cache,
    private readonly events: Events,
    private readonly options: PublicMarketOptions = {}
  ) {
    this.http = options.http ?? new BybitHttp();
  }
  private signal(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
  }
  async search(
    query: string,
    kind: InstrumentSearchKind,
    signal?: AbortSignal
  ): Promise<CatalogInstrument[]> {
    if (!["all", "crypto", "future", "tokenized-stock"].includes(kind)) return [];
    const active = this.signal(signal);
    active.throwIfAborted();
    if (!this.catalog) {
      this.catalogRequest ??= loadCatalog(this.http, this.lifetime.signal)
        .then((value) => {
          this.catalog = value;
          return value;
        })
        .finally(() => {
          this.catalogRequest = undefined;
        });
      await this.waitCatalog(this.catalogRequest, active);
    }
    active.throwIfAborted();
    if (!this.catalog) return [];
    return searchCatalog(this.catalog, query, { cryptoOnly: false, limit: 300 })
      .filter(
        (item) =>
          item.status === "Trading" &&
          (item.ref.category === "spot" ||
            (item.contractType === "LinearPerpetual" && item.settleCoin === "USDT"))
      )
      .filter((item) => item.assetClass !== "unknown")
      .map(publicCatalogInstrument)
      .filter((item) => kind === "all" || item.kind === kind);
  }
  private waitCatalog(request: Promise<BybitCatalog>, signal: AbortSignal): Promise<BybitCatalog> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const reason: unknown = signal.reason;
        reject(reason instanceof Error ? reason : new DOMException("Поиск отменён", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      void request
        .then((value) => {
          if (!signal.aborted) resolve(value);
        }, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
  async verify(instrument: CatalogInstrument, signal?: AbortSignal): Promise<CatalogInstrument> {
    const values = await this.search(instrument.providerRef?.symbol ?? "", "all", signal);
    const exact = values.find((item) => item.uid === instrument.uid);
    if (!exact) throw new Error("Инструмент отсутствует в текущем полном каталоге Bybit.");
    return exact;
  }
  sync(rows: readonly MarketRow[]): void {
    if (this.lifetime.signal.aborted) return;
    this.rows = rows;
    for (const category of ["spot", "linear"] as const) {
      const symbols = rows.flatMap((row) =>
        row.providerRef?.category === category ? [row.providerRef.symbol] : []
      );
      const selected =
        this.selection?.row.providerRef?.category === category ? this.selection : null;
      if (!symbols.length && !selected) {
        this.streams.get(category)?.dispose();
        this.streams.delete(category);
        continue;
      }
      let stream = this.streams.get(category);
      if (!stream) {
        const opts: BybitStreamOptions = {
          onEvent: (event) => {
            if (this.lifetime.signal.aborted || this.cachePaused) return;
            if (event.kind === "quote") this.events.quote(event.quote);
            if (event.kind === "candles") {
              const current = this.selection;
              if (
                !current ||
                current.row.providerRef?.category !== category ||
                current.row.providerRef.symbol !== event.ref.symbol ||
                current.timeframe !== event.interval
              )
                return;
              for (const value of event.candles) {
                const bar: Candle = {
                  timestamp: value.timestamp,
                  open: value.open,
                  high: value.high,
                  low: value.low,
                  close: value.close,
                  volume: value.baseVolume
                };
                this.events.candle({
                  uid: current.row.uid!,
                  interval: TIMEFRAMES[current.timeframe].stream,
                  bar
                });
                this.queue(current.row.uid!, current.timeframe, bar);
              }
            }
          },
          onState: (state) => {
            if (state === "open") {
              if (this.opened.has(category)) this.events.reconnect(category);
              this.opened.add(category);
            }
          },
          onError: () => this.events.notice("Поток Bybit временно недоступен; источник сохранён.")
        };
        stream = this.options.stream?.(category, opts) ?? new BybitStream(category, opts);
        this.streams.set(category, stream);
        stream.setSubscriptions({
          tickers: symbols,
          candles: selected
            ? [
                {
                  symbol: selected.row.providerRef!.symbol,
                  interval: selected.timeframe as BybitInterval
                }
              ]
            : []
        });
      } else
        stream.setSubscriptions({
          tickers: symbols,
          candles: selected
            ? [
                {
                  symbol: selected.row.providerRef!.symbol,
                  interval: selected.timeframe as BybitInterval
                }
              ]
            : []
        });
      stream.start(this.lifetime.signal);
    }
  }
  async snapshot(): Promise<void> {
    for (const category of ["spot", "linear"] as const) {
      if (!this.rows.some((row) => row.providerRef?.category === category)) continue;
      try {
        for (const quote of await loadQuotes(this.http, category, undefined, this.lifetime.signal))
          if (!this.cachePaused) this.events.quote(quote);
      } catch (error) {
        if (!this.lifetime.signal.aborted)
          this.events.notice(error instanceof Error ? error.message : "Bybit недоступен");
      }
    }
  }
  select(row: MarketRow | null, timeframe: Timeframe): void {
    if (row?.providerRef) {
      nativeInterval(timeframe);
      this.selection = { row, timeframe };
    } else this.selection = null;
    this.sync(this.rows);
  }
  async candles(
    row: MarketRow,
    timeframe: Timeframe,
    range: HistoryRange,
    options: CandleOptions = {}
  ): Promise<CandleResult> {
    if (!row.providerRef || !row.uid) throw new Error("Источник Bybit недоступен.");
    nativeInterval(timeframe);
    const signal = this.signal(options.signal);
    signal.throwIfAborted();
    let bars = await this.cache.loadHistory(this.owner(), row.uid, timeframe, range.from, range.to);
    const cached = bars.length > 0;
    if (!(this.options.online?.() ?? (typeof navigator === "undefined" || navigator.onLine)))
      return {
        symbol: row.symbol,
        ticker: row.ticker,
        timeframe,
        candles: bars,
        source: "Bybit · IndexedDB · офлайн",
        cached,
        requests: 0
      };
    const coverage = await this.cache.loadCoverage(this.owner(), row.uid, timeframe);
    const closedTo = Math.max(
      range.from,
      Math.min(range.to, shiftTimeframe(Date.now(), timeframe, -2))
    );
    const gaps = subtractRanges(range.from, closedTo, coverage);
    if (closedTo < range.to) gaps.push({ from: closedTo, to: range.to });
    for (const [index, part] of gaps.entries()) {
      const rows = await loadHistory(this.http, row.providerRef, timeframe, part, signal);
      signal.throwIfAborted();
      const next = rows.map((value) => ({
        timestamp: value.timestamp,
        open: value.open,
        high: value.high,
        low: value.low,
        close: value.close,
        volume: value.baseVolume
      }));
      if (!this.cachePaused)
        await this.cache.saveHistory(this.owner(), row.uid, timeframe, next, {
          ...part,
          fetchedAt: Date.now()
        });
      signal.throwIfAborted();
      bars = mergeCandles(bars, next);
      options.onProgress?.({ candles: bars, cached, completed: index + 1, total: gaps.length });
    }
    signal.throwIfAborted();
    this.select(row, timeframe);
    return {
      symbol: row.symbol,
      ticker: row.ticker,
      timeframe,
      candles: bars.filter((bar) => bar.timestamp >= range.from && bar.timestamp <= range.to),
      source: "Bybit · напрямую · последняя сделка",
      cached,
      requests: gaps.length
    };
  }
  private queue(uid: string, timeframe: Timeframe, bar: Candle): void {
    const key = `${uid}:${timeframe}`,
      previous = this.live.get(key) ?? { uid, timeframe, bars: [] };
    previous.bars = mergeCandles(previous.bars, [bar]);
    this.live.set(key, previous);
    this.flushTimer ??= setTimeout(() => {
      void this.flush().catch(() => this.events.notice("Не удалось сохранить свечи Bybit."));
    }, 1500);
  }
  async flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const blocks = [...this.live.values()];
    this.live.clear();
    if (!this.cachePaused)
      for (const block of blocks)
        await this.cache.saveHistory(this.owner(), block.uid, block.timeframe, block.bars);
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    for (const stream of this.streams.values()) stream.dispose();
    this.streams.clear();
    await this.flush();
  }
}
