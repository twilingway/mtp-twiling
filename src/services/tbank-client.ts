import { searchCatalog } from "./tbank-instruments.js";
import { MutationQueue } from "./mutation-queue.js";
import { persistWatchlistMove, type WatchlistMove } from "./watchlist-order.js";
import { quoteSnapshot } from "./quote-snapshot.js";
import { profileKey } from "./profile-key.js";
import { selectedMarketRow } from "../model/selected-instrument.js";
import { lastPriceSubscription } from "./market-subscriptions.js";
import { resolveWatchlist, quotation, dayChange, normaliseCandles } from "../model/market-model.js";
import { TIMEFRAMES, splitRanges, subtractRanges, mergeCandles } from "../model/history-codec.js";
import type {
  Candle,
  Catalog,
  CatalogInstrument,
  HistoryRange,
  MarketRow,
  Timeframe
} from "../model/types.js";
import {
  errorMessage,
  list,
  normaliseInstrument,
  normaliseInstruments,
  object,
  text
} from "./types.js";

import { BankError, BankTransport } from "./tbank-transport.js";
export { BankError } from "./tbank-transport.js";

import type {
  Cache,
  Subscription,
  BankState,
  BankSnapshot,
  CandleResult,
  CandleOptions,
  CandleEvent
} from "./types.js";
export type { BankSnapshot, CandleProgress, CandleResult, CandleEvent } from "./types.js";

export class TBankClient extends EventTarget {
  rows: MarketRow[] = [];
  owner = "";
  state: BankState = "connecting";
  error: string | null = null;
  updatedAt: string | null = null;
  authenticated = false;
  cachePaused = false;
  catalog: Catalog | undefined;
  private candleSubscription: Subscription | null = null;
  private liveBuffer = new Map<string, Subscription & { bars: Candle[] }>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly transport: BankTransport;
  private readonly mutations = new MutationQueue();
  constructor(
    private readonly token: string,
    public readonly name: string,
    private readonly cache: Cache
  ) {
    super();
    this.transport = new BankTransport(token, {
      connecting: () => {
        this.state = "connecting";
        this.error = null;
        this.notify();
      },
      open: () => {
        const ids = this.rows.flatMap((row) => (row.uid ? [row.uid] : []));
        if (ids.length) this.send(lastPriceSubscription("subscribe", ids));
        else {
          this.state = "connected";
          this.notify();
        }
        this.send({ pingSettings: { pingDelayMs: 10000 } });
        this.sendCandleSubscription("SUBSCRIPTION_ACTION_SUBSCRIBE");
      },
      data: (message) => this.receive(message),
      error: (message) => {
        this.state = "error";
        this.error = message;
        this.notify();
      }
    });
  }
  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  snapshot(): BankSnapshot {
    return {
      authenticated: this.authenticated,
      accountName: this.name,
      profileKey: this.owner,
      rows: this.rows,
      status: this.state,
      error: this.error,
      updatedAt: this.updatedAt,
      transport: "websocket"
    };
  }
  private notify(): void {
    this.emit("state", this.snapshot());
  }
  get closed(): boolean {
    return this.transport.closed;
  }
  serverNow(): number {
    return this.transport.serverNow();
  }
  request(
    service: string,
    method: string,
    body: object = {},
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    return this.transport.request(service, method, body, signal);
  }
  async start(): Promise<BankSnapshot> {
    this.owner = await profileKey(this.token);
    await this.request("MarketDataService", "GetLastPrices", { instrumentId: ["SBER_TQBR"] });
    this.authenticated = true;
    const cached = await this.cache.loadMarket(this.owner);
    if (cached?.rows.length) {
      this.rows = cached.rows;
      this.state = "connecting";
      this.notify();
    }
    let catalog = await this.cache.loadCatalog();
    if (!catalog || Date.now() - catalog.at > 86400000) {
      const results = await Promise.allSettled([
        this.request("InstrumentsService", "Shares", { instrumentStatus: "INSTRUMENT_STATUS_ALL" }),
        this.request("InstrumentsService", "Futures", {
          instrumentStatus: "INSTRUMENT_STATUS_BASE"
        }),
        this.request("InstrumentsService", "Indicatives")
      ]);
      const shares = results[0];
      if (!shares || shares.status === "rejected")
        throw shares?.reason ?? new BankError("Каталог банка недоступен.", "RESPONSE");
      const instruments = (index: number) => {
        const result = results[index];
        return result?.status === "fulfilled" ? normaliseInstruments(result.value.instruments) : [];
      };
      catalog = {
        at: Date.now(),
        shares: instruments(0),
        futures: instruments(1),
        indicatives: instruments(2)
      };
      await this.cache.saveCatalog(catalog);
    }
    this.catalog = catalog;
    const watchlist = await this.cache.loadWatchlist(this.owner);
    this.rows =
      watchlist !== undefined
        ? watchlist
        : resolveWatchlist(catalog.shares, catalog.futures, catalog.indicatives);
    if (
      this.candleSubscription &&
      !this.rows.some((row) => row.uid === this.candleSubscription?.uid)
    )
      this.candleSubscription = null;
    await this.cache.saveWatchlist(this.owner, this.rows);
    const catalogByUid = new Map(
      [...catalog.shares, ...catalog.futures, ...catalog.indicatives].map((item) => [
        item.uid ?? item.instrumentUid,
        item
      ])
    );
    for (const row of this.rows) {
      const item = row.uid ? catalogByUid.get(row.uid) : undefined;
      if (!item) continue;
      if (item.brand !== undefined) row.brand = item.brand;
      row.first1minCandleDate = item.first1minCandleDate ?? row.first1minCandleDate;
      row.first1dayCandleDate = item.first1dayCandleDate ?? row.first1dayCandleDate;
      row.firstTradeDate = item.firstTradeDate ?? row.firstTradeDate;
    }
    const ids = this.rows.flatMap((row) => (row.uid ? [row.uid] : []));
    if (!ids.length) {
      await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
      this.connect();
      return this.snapshot();
    }
    const [prices, close] = await quoteSnapshot(this, ids);
    if (prices.status === "rejected") throw prices.reason;
    const closes = close.status === "fulfilled" ? list(close.value.closePrices).map(object) : [];
    for (const row of this.rows) {
      const previous = closes.find((price) => price?.instrumentUid === row.uid);
      row.previousClose = quotation(previous?.price);
      row.closeTime = text(previous?.time) ?? null;
    }
    for (const price of list(prices.value.lastPrices)) this.applyPrice(price, false);
    this.updatedAt = new Date().toISOString();
    this.notify();
    await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
    this.connect();
    return this.snapshot();
  }
  applyPrice(input: unknown, notify = true): void {
    const price = object(input);
    if (!price) return;
    const row = this.rows.find(
      (row) => row.uid === price.instrumentUid || (row.figi && row.figi === price.figi)
    );
    if (!row) return;
    const value = quotation(price.price);
    if (value === null || value <= 0) return;
    row.price = value;
    row.time = text(price.time) ?? null;
    row.availability = "available";
    Object.assign(row, dayChange(value, row.previousClose));
    this.updatedAt = new Date().toISOString();
    if (notify) this.notify();
  }
  async searchInstruments(
    query: string,
    type: "all" | "share" | "future" | "index" = "all",
    signal?: AbortSignal
  ): Promise<CatalogInstrument[]> {
    const catalog = this.catalog ?? (await this.cache.loadCatalog());
    return searchCatalog(
      catalog,
      query,
      type,
      (query, signal) =>
        this.request("InstrumentsService", "FindInstrument", { query }, signal).then(
          (response) => response.instruments
        ),
      signal
    );
  }
  addInstrument(instrument: CatalogInstrument): Promise<MarketRow> {
    return this.mutations.run(() => this.addInstrumentNow(instrument));
  }
  private async addInstrumentNow(instrument: CatalogInstrument): Promise<MarketRow> {
    if (this.rows.length >= 300)
      throw new BankError("В одном списке поддерживается до 300 инструментов.", 400);
    const uid = instrument.uid ?? instrument.instrumentUid;
    if (!uid) throw new BankError("Инструмент недоступен у банка.", 404);
    const previous = this.rows.find((row) => row.uid === uid);
    if (previous) return previous;
    let full = instrument;
    if (!full.minPriceIncrement) {
      const response = await this.request("InstrumentsService", "GetInstrumentBy", {
        idType: "INSTRUMENT_ID_TYPE_UID",
        id: uid
      });
      const detail = normaliseInstrument(response.instrument);
      if (detail) full = { ...instrument, ...detail };
    }
    const row: MarketRow = {
      symbol: full.ticker,
      ticker: full.ticker,
      uid: full.uid ?? full.instrumentUid ?? uid,
      figi: full.figi ?? null,
      name: full.name,
      currency: full.currency || "rub",
      type:
        instrument.kind === "future" ? "future" : instrument.kind === "index" ? "index" : undefined,
      color: instrument.kind === "future" ? "#31a8de" : "#5476bc",
      mark: full.name.slice(0, 1).toUpperCase(),
      step: quotation(full.minPriceIncrement),
      brand: full.brand ?? null,
      expirationDate: full.expirationDate ?? null,
      first1minCandleDate: full.first1minCandleDate,
      first1dayCandleDate: full.first1dayCandleDate,
      price: null,
      previousClose: null,
      availability: "pending"
    };
    const rows = [...this.rows, row];
    await this.cache.saveWatchlistSnapshot(this.owner, rows);
    this.rows = rows;
    this.notify();
    this.send({
      subscribeLastPriceRequest: {
        subscriptionAction: "SUBSCRIPTION_ACTION_SUBSCRIBE",
        instruments: [{ instrumentId: row.uid }]
      }
    });
    try {
      const [prices, close] = await Promise.all([
        this.request("MarketDataService", "GetLastPrices", {
          instrumentId: [row.uid],
          lastPriceType: "LAST_PRICE_EXCHANGE"
        }),
        this.request("MarketDataService", "GetClosePrices", {
          instruments: [{ instrumentId: row.uid }]
        })
      ]);
      const previous = object(list(close.closePrices)[0]);
      row.previousClose = quotation(previous?.price);
      row.closeTime = text(previous?.time) ?? null;
      for (const price of list(prices.lastPrices)) this.applyPrice(price, false);
      await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
      this.notify();
    } catch (error) {
      this.emit("notice", errorMessage(error));
    }
    return row;
  }
  removeInstrument(reference: Pick<MarketRow, "uid" | "symbol">): Promise<void> {
    return this.mutations.run(async () => {
      const target = this.rows.find((row) =>
        reference.uid
          ? row.uid === reference.uid
          : row.uid === null && row.symbol === reference.symbol
      );
      if (!target) return;
      await this.flush();
      const rows = this.rows.filter((row) => row !== target);
      await this.cache.saveWatchlistSnapshot(this.owner, rows);
      this.rows = rows;
      const unsubscribe =
        target.uid && !rows.some((row) => row.uid === target.uid) ? target.uid : null;
      if (unsubscribe) this.send(lastPriceSubscription("unsubscribe", [unsubscribe]));
      if (unsubscribe && this.candleSubscription?.uid === target.uid) {
        this.sendCandleSubscription("SUBSCRIPTION_ACTION_UNSUBSCRIBE");
        this.candleSubscription = null;
      }
      this.notify();
    });
  }
  reorderWatchlist(move: WatchlistMove): Promise<boolean> {
    return this.mutations.run(() =>
      persistWatchlistMove(this, this.cache, () => this.notify(), move)
    );
  }
  connect(): void {
    this.transport.connect();
  }
  private receive(data: Record<string, unknown>): void {
    const prices = object(data.subscribeLastPriceResponse);
    if (prices) {
      const rejected = list(prices.lastPriceSubscriptions).some(
        (value) => object(value)?.subscriptionStatus !== "SUBSCRIPTION_STATUS_SUCCESS"
      );
      this.state = rejected ? "error" : "connected";
      this.error = rejected ? "Банк отклонил часть подписок." : null;
      this.notify();
    }
    if (data.lastPrice) this.applyPrice(data.lastPrice);
    const raw = object(data.candle);
    if (raw) {
      const bar = normaliseCandles([raw])[0],
        uid = text(raw.instrumentUid),
        interval = text(raw.interval);
      if (bar && uid && interval) {
        this.emit<CandleEvent>("candle", { uid, interval, bar });
        const sub = this.candleSubscription;
        if (sub && uid === sub.uid) this.queueLiveBar(sub, bar);
      }
    }
    const candles = object(data.subscribeCandlesResponse);
    if (
      candles &&
      list(candles.candlesSubscriptions).some(
        (value) => object(value)?.subscriptionStatus !== "SUBSCRIPTION_STATUS_SUCCESS"
      )
    )
      this.emit(
        "notice",
        "Банк не поддержал поток свечей выбранного интервала; история остаётся доступной."
      );
  }
  private send(data: object): void {
    this.transport.send(data);
  }
  private sendCandleSubscription(action: string): void {
    const sub = this.candleSubscription;
    if (!sub) return;
    this.send({
      subscribeCandlesRequest: {
        subscriptionAction: action,
        instruments: [{ instrumentId: sub.uid, interval: TIMEFRAMES[sub.timeframe].stream }],
        waitingClose: false
      }
    });
  }
  subscribeCandles(uid: string, timeframe: Timeframe): void {
    if (this.candleSubscription?.uid === uid && this.candleSubscription.timeframe === timeframe)
      return;
    this.sendCandleSubscription("SUBSCRIPTION_ACTION_UNSUBSCRIBE");
    this.candleSubscription = { uid, timeframe };
    this.sendCandleSubscription("SUBSCRIPTION_ACTION_SUBSCRIBE");
  }
  private queueLiveBar(sub: Subscription, bar: Candle): void {
    if (this.cachePaused) return;
    const key = `${sub.uid}:${sub.timeframe}`,
      previous = this.liveBuffer.get(key) ?? { ...sub, bars: [] };
    previous.bars = mergeCandles(previous.bars, [bar]);
    this.liveBuffer.set(key, previous);
    if (!this.flushTimer)
      this.flushTimer = setTimeout(() => {
        void this.flush().catch(() =>
          this.emit("notice", "Не удалось сохранить новые свечи. Проверьте свободное место.")
        );
      }, 1500);
  }
  async flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const blocks = [...this.liveBuffer.values()];
    this.liveBuffer.clear();
    await Promise.all(
      blocks.map((block) =>
        this.cache.saveHistory(this.owner, block.uid, block.timeframe, block.bars)
      )
    );
    if (this.rows.length && !this.mutations.active)
      await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
  }
  async candles(
    symbol: string,
    timeframe: Timeframe,
    range: HistoryRange,
    { signal, onProgress, uid }: CandleOptions = {}
  ): Promise<CandleResult> {
    const row = selectedMarketRow(this.rows, { symbol, instrumentUid: uid });
    if (!row?.uid) throw new BankError("Инструмент недоступен у банка.", 404);
    const config = TIMEFRAMES[timeframe];
    if (!config) throw new BankError("Неизвестный таймфрейм.", 400);
    const cached = await this.cache.loadHistory(
      this.owner,
      row.uid,
      timeframe,
      range.from,
      range.to
    );
    if (!navigator.onLine)
      return {
        symbol,
        ticker: row.ticker,
        timeframe,
        candles: cached,
        source: "IndexedDB · офлайн",
        cached: true,
        requests: 0
      };
    const coverage = await this.cache.loadCoverage(this.owner, row.uid, timeframe);
    const closedTo = Math.min(range.to, Date.now() - 2 * config.ms);
    const gaps = subtractRanges(range.from, Math.max(range.from, closedTo), coverage);
    const recent = coverage.find(
      (covered) =>
        covered.from <= closedTo &&
        covered.to >= range.to - config.ms &&
        Date.now() - (covered.fetchedAt ?? 0) < 15000
    );
    if (closedTo < range.to && !recent)
      gaps.push({ from: Math.max(range.from, closedTo), to: range.to });
    const pieces = splitRanges(gaps, timeframe);
    let bars = cached;
    if (cached.length)
      onProgress?.({ candles: bars, cached: true, completed: 0, total: pieces.length });
    for (const [index, part] of pieces.entries()) {
      const response = await this.request(
        "MarketDataService",
        "GetCandles",
        {
          instrumentId: row.uid,
          from: new Date(part.from).toISOString(),
          to: new Date(part.to).toISOString(),
          interval: config.interval,
          limit: config.limit
        },
        signal
      );
      const next = normaliseCandles(response.candles);
      await this.cache.saveHistory(this.owner, row.uid, timeframe, next, {
        ...part,
        fetchedAt: Date.now()
      });
      bars = mergeCandles(bars, next);
      onProgress?.({
        candles: bars,
        cached: !!cached.length,
        completed: index + 1,
        total: pieces.length
      });
    }
    signal?.throwIfAborted();
    this.subscribeCandles(row.uid, timeframe);
    return {
      symbol,
      ticker: row.ticker,
      timeframe,
      candles: bars.filter((bar) => bar.timestamp >= range.from && bar.timestamp <= range.to),
      source: "Т‑Инвестиции · напрямую",
      cached: !!cached.length,
      requests: pieces.length
    };
  }
  close(): Promise<void> {
    this.transport.close();
    clearTimeout(this.flushTimer);
    return this.flush();
  }
}
