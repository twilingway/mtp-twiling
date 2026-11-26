import {
  BybitHttp,
  BybitStream,
  loadCatalog,
  loadHistory,
  loadQuotes,
  searchCatalog,
  nativeInterval
} from "./providers/bybit/index.js";
import type { BybitCatalog, BybitCategory, BybitInstrument } from "./providers/bybit/types.js";
import type { BybitStreamOptions } from "./providers/bybit/websocket.js";
import type { BybitInterval } from "./providers/bybit/market.js";
import {
  loadBybitOpenInterest,
  supportsBybitOpenInterestInterval
} from "./providers/bybit/open-interest.js";
import type { OpenInterestObservations } from "../model/technical-indicators/ta-batch-external.js";
import type { TurnoverInterval } from "../model/technical-indicators/ta-batch-volume-flow-turnover.js";
import { loadPublicQuoteTurnover } from "./market-turnover.js";
import { loadPublicIntrabarVolume } from "./market-intrabar-volume.js";
import { okxSpotTradeSource } from "./market-spot-trades.js";
import { okxNativeInterval } from "./providers/okx/market.js";
import type { OkxInstrument } from "./providers/okx/types.js";
import {
  okxCatalogInstrument,
  okxMatches,
  publicCatalogInstrument,
  publicSearchKey
} from "./market-public-mapping.js";
import type { PublicQuote } from "./market-public-mapping.js";
import { OkxMarket, PUBLIC_CATALOG_MAX_AGE_MS } from "./market-okx.js";
import type { OkxMarketOptions } from "./market-okx.js";
import { TIMEFRAMES, mergeCandles, subtractRanges } from "../model/history-codec.js";
import { shiftTimeframe } from "../model/intervals/calendar.js";
import { providerSeriesId } from "../model/market-provider.js";
import type { MarketProviderRef, OkxProviderRef } from "../model/market-provider.js";
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
  okx?: OkxMarketOptions;
  online?: () => boolean;
}
export type PublicMarketReconnect = Pick<MarketProviderRef, "provider" | "category">;

interface Events {
  quote(quote: PublicQuote): void;
  candle(event: CandleEvent): void;
  notice(message: string): void;
  reconnect(source: PublicMarketReconnect): void;
}

function supportedBybitInstrument(item: BybitInstrument): boolean {
  return (
    item.status === "Trading" &&
    (item.ref.category === "spot" ||
      (item.contractType === "LinearPerpetual" && item.settleCoin === "USDT"))
  );
}

function marketTuple(item: BybitInstrument | OkxInstrument): string {
  return JSON.stringify([
    item.ref.category,
    item.baseCoin.toUpperCase(),
    item.quoteCoin.toUpperCase(),
    item.settleCoin?.toUpperCase() ?? null
  ]);
}

function knownBybitMarkets(catalog: BybitCatalog): Set<string> {
  const categories = new Set(catalog.instruments.map((item) => item.ref.category));
  if (!catalog.complete || !categories.has("spot") || !categories.has("linear"))
    throw new Error("Полный каталог Bybit не подтверждён.");
  return new Set(catalog.instruments.filter(supportedBybitInstrument).map(marketTuple));
}

function searchBybit(catalog: BybitCatalog, query: string, kind: InstrumentSearchKind) {
  return searchCatalog(catalog, query, { cryptoOnly: false, limit: 300 })
    .filter((item) => supportedBybitInstrument(item) && item.assetClass !== "unknown")
    .map(publicCatalogInstrument)
    .filter((item) => kind === "all" || item.kind === kind);
}

function okxRefs(rows: readonly MarketRow[]): OkxProviderRef[] {
  return rows.flatMap((row) => (row.providerRef?.provider === "okx" ? [row.providerRef] : []));
}

export class PublicMarket {
  cachePaused = false;
  private catalog: BybitCatalog | undefined;
  private catalogReceivedAt: number | undefined;
  private catalogRequest: Promise<BybitCatalog> | undefined;
  private readonly lifetime = new AbortController();
  private readonly http: BybitHttp;
  private readonly okx: OkxMarket;
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
    this.okx = new OkxMarket(
      this.lifetime.signal,
      {
        onQuote: (quote) => this.emitQuote(quote),
        onCandles: (ref, timeframe, bars) => this.receiveCandles(ref, timeframe, bars),
        onReconnect: () => {
          const ref = this.selection?.row.providerRef;
          if (ref?.provider === "okx" && !this.lifetime.signal.aborted && !this.cachePaused)
            this.events.reconnect({ provider: "okx", category: ref.category });
        },
        onError: (error) => {
          if (!this.lifetime.signal.aborted) this.events.notice(error.message);
        }
      },
      options.okx
    );
  }
  private signal(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
  }
  loadSpotTradeHistory(row: MarketRow, range: HistoryRange, signal: AbortSignal) {
    const source = okxSpotTradeSource(row);
    return source && !this.cachePaused
      ? this.okx.spotTrades(source.ref, range, this.signal(signal))
      : Promise.resolve(null);
  }
  loadIntrabarVolume(
    row: MarketRow,
    interval: TurnoverInterval,
    range: HistoryRange,
    signal: AbortSignal
  ) {
    if (this.cachePaused) return Promise.resolve(null);
    return loadPublicIntrabarVolume(
      row,
      interval,
      range,
      this.signal(signal),
      (ref, timeframe, part, active) => loadHistory(this.http, ref, timeframe, part, active),
      (ref, timeframe, part, active) => this.okx.history(ref, timeframe, part, active)
    );
  }
  loadQuoteTurnover(
    row: MarketRow,
    interval: TurnoverInterval,
    range: HistoryRange,
    signal: AbortSignal
  ) {
    if (this.cachePaused) return Promise.resolve(null);
    return loadPublicQuoteTurnover(
      row,
      interval,
      range,
      this.signal(signal),
      (ref, timeframe, part, active) => loadHistory(this.http, ref, timeframe, part, active),
      (ref, timeframe, part, active) => this.okx.history(ref, timeframe, part, active)
    );
  }
  loadOpenInterest(
    row: MarketRow,
    timeframe: Timeframe,
    range: HistoryRange,
    signal: AbortSignal,
    onPage?: (page: OpenInterestObservations) => void
  ): Promise<OpenInterestObservations | null> {
    const ref = row.providerRef;
    if (
      ref?.provider !== "bybit" ||
      ref.category !== "linear" ||
      !row.baseCoin ||
      !supportsBybitOpenInterestInterval(timeframe)
    )
      return Promise.resolve(null);
    return loadBybitOpenInterest(
      this.http,
      ref,
      row.baseCoin,
      timeframe,
      range,
      this.signal(signal),
      onPage
    );
  }
  async search(
    query: string,
    kind: InstrumentSearchKind,
    signal?: AbortSignal
  ): Promise<CatalogInstrument[]> {
    const needle = publicSearchKey(query);
    if (!needle || !["all", "crypto", "future", "tokenized-stock"].includes(kind)) return [];
    const active = this.signal(signal);
    let catalog: BybitCatalog;
    try {
      catalog = await this.bybitCatalog(active);
    } catch (error) {
      active.throwIfAborted();
      const previous = this.catalog ? searchBybit(this.catalog, query, kind) : [];
      if (!previous.length) throw error;
      this.events.notice("Каталог Bybit не обновился. Показаны ранее найденные инструменты Bybit.");
      return previous;
    }
    active.throwIfAborted();
    const bybit = searchBybit(catalog, query, kind);
    if (kind !== "all" && kind !== "crypto") return bybit;
    try {
      const known = knownBybitMarkets(catalog);
      const okx = await this.waitCatalog(this.okx.catalog(), active);
      return [
        ...bybit,
        ...okx
          .filter((item) => okxMatches(item, needle) && !known.has(marketTuple(item)))
          .map(okxCatalogInstrument)
      ];
    } catch (error) {
      active.throwIfAborted();
      if (!bybit.length) throw error;
      this.events.notice(error instanceof Error ? error.message : "Каталог OKX недоступен.");
      return bybit;
    }
  }

  private bybitCatalog(signal: AbortSignal, refresh = false): Promise<BybitCatalog> {
    signal.throwIfAborted();
    if (this.catalogRequest) return this.waitCatalog(this.catalogRequest, signal);
    if (
      !refresh &&
      this.catalog &&
      this.catalogReceivedAt !== undefined &&
      Date.now() - this.catalogReceivedAt < PUBLIC_CATALOG_MAX_AGE_MS
    )
      return Promise.resolve(this.catalog);
    this.catalogRequest = loadCatalog(this.http, this.lifetime.signal)
      .then((catalog) => {
        this.catalog = catalog;
        this.catalogReceivedAt = Date.now();
        return catalog;
      })
      .finally(() => {
        this.catalogRequest = undefined;
      });
    return this.waitCatalog(this.catalogRequest, signal);
  }

  private waitCatalog<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
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
    const active = this.signal(signal),
      ref = instrument.providerRef;
    const catalog = await this.bybitCatalog(active, ref?.provider === "okx");
    if (ref?.provider === "okx") {
      const known = knownBybitMarkets(catalog);
      const okx = await this.waitCatalog(this.okx.catalog(true), active);
      const item = okx.find((value) => providerSeriesId(value.ref) === instrument.uid);
      if (!item || instrument.uid !== providerSeriesId(ref))
        throw new Error("Инструмент отсутствует в текущем каталоге OKX.");
      if (known.has(marketTuple(item)))
        throw new Error("Эта пара появилась на Bybit. Обновите поиск инструментов.");
      return okxCatalogInstrument(item);
    }
    const exact = catalog.instruments.find(
      (item) =>
        supportedBybitInstrument(item) &&
        item.assetClass !== "unknown" &&
        item.seriesId === instrument.uid &&
        item.ref.symbol === ref?.symbol &&
        item.ref.category === ref.category
    );
    if (!exact) throw new Error("Инструмент отсутствует в текущем полном каталоге Bybit.");
    return publicCatalogInstrument(exact);
  }
  sync(rows: readonly MarketRow[]): void {
    if (this.lifetime.signal.aborted) return;
    this.rows = rows;
    const ref = this.selection?.row.providerRef;
    this.okx.sync(
      okxRefs(rows),
      ref?.provider === "okx" && this.selection
        ? { ref, timeframe: this.selection.timeframe }
        : null
    );
    for (const category of ["spot", "linear"] as const) {
      const symbols = rows.flatMap((row) =>
        row.providerRef?.provider === "bybit" && row.providerRef.category === category
          ? [row.providerRef.symbol]
          : []
      );
      const selected =
        ref?.provider === "bybit" && ref.category === category ? this.selection : null;
      if (!symbols.length && !selected) {
        this.streams.get(category)?.dispose();
        this.streams.delete(category);
        this.opened.delete(category);
        continue;
      }
      let stream = this.streams.get(category);
      if (!stream) {
        const opts: BybitStreamOptions = {
          onEvent: (event) => {
            if (event.kind === "quote") this.emitQuote(event.quote);
            if (event.kind === "candles")
              this.receiveCandles(event.ref, event.interval, event.candles);
          },
          onState: (state) => {
            if (state === "open" && !this.lifetime.signal.aborted) {
              if (this.opened.has(category)) this.events.reconnect({ provider: "bybit", category });
              this.opened.add(category);
            }
          },
          onError: () => this.events.notice("Поток Bybit временно недоступен; источник сохранён.")
        };
        stream = this.options.stream?.(category, opts) ?? new BybitStream(category, opts);
        this.streams.set(category, stream);
      }
      stream.setSubscriptions({
        tickers: symbols,
        candles:
          selected && ref
            ? [{ symbol: ref.symbol, interval: selected.timeframe as BybitInterval }]
            : []
      });
      stream.start(this.lifetime.signal);
    }
  }
  async snapshot(): Promise<void> {
    await Promise.all([this.snapshotBybit(), this.okx.snapshot(okxRefs(this.rows))]);
  }
  private async snapshotBybit(): Promise<void> {
    for (const category of ["spot", "linear"] as const) {
      if (
        !this.rows.some(
          (row) => row.providerRef?.provider === "bybit" && row.providerRef.category === category
        )
      )
        continue;
      try {
        for (const quote of await loadQuotes(this.http, category, undefined, this.lifetime.signal))
          this.emitQuote(quote);
      } catch (error) {
        if (!this.lifetime.signal.aborted)
          this.events.notice(error instanceof Error ? error.message : "Bybit недоступен");
      }
    }
  }
  select(row: MarketRow | null, timeframe: Timeframe): void {
    if (row?.providerRef) {
      (row.providerRef.provider === "okx" ? okxNativeInterval : nativeInterval)(timeframe);
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
    const ref = row.providerRef;
    if (!ref || !row.uid) throw new Error("Источник криптокотировок недоступен.");
    const okx = ref.provider === "okx",
      name = okx ? "OKX" : "Bybit";
    (okx ? okxNativeInterval : nativeInterval)(timeframe);
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
        source: `${name} · IndexedDB · офлайн`,
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
      const rows =
        ref.provider === "okx"
          ? await this.okx.history(ref, timeframe, part, signal)
          : await loadHistory(this.http, ref, timeframe, part, signal);
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
      source: `${name} · напрямую · последняя сделка`,
      cached,
      requests: gaps.length,
      requestedRangeCovered: true
    };
  }

  private emitQuote(quote: PublicQuote): void {
    if (!this.lifetime.signal.aborted && !this.cachePaused) this.events.quote(quote);
  }

  private receiveCandles(
    ref: MarketProviderRef,
    timeframe: string,
    bars: readonly (Omit<Candle, "volume"> & { baseVolume: number })[]
  ): void {
    const current = this.selection,
      uid = providerSeriesId(ref);
    if (
      this.lifetime.signal.aborted ||
      this.cachePaused ||
      current?.row.uid !== uid ||
      current.timeframe !== timeframe
    )
      return;
    for (const value of bars) {
      const bar: Candle = {
        timestamp: value.timestamp,
        open: value.open,
        high: value.high,
        low: value.low,
        close: value.close,
        volume: value.baseVolume
      };
      this.events.candle({ uid, interval: TIMEFRAMES[current.timeframe].stream, bar });
      this.queue(uid, current.timeframe, bar);
    }
  }

  private queue(uid: string, timeframe: Timeframe, bar: Candle): void {
    const key = `${uid}:${timeframe}`,
      previous = this.live.get(key) ?? { uid, timeframe, bars: [] };
    previous.bars = mergeCandles(previous.bars, [bar]);
    this.live.set(key, previous);
    this.flushTimer ??= setTimeout(() => {
      void this.flush().catch(() => this.events.notice("Не удалось сохранить свечи криптобиржи."));
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
    this.okx.close();
    for (const stream of this.streams.values()) stream.dispose();
    this.streams.clear();
    await this.flush();
  }
}
