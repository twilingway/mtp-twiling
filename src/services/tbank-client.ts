import { searchCatalog } from "./tbank-instruments.js";
import { loadBankCatalog } from "./tbank-catalog.js";
import { catalogInstrumentKind } from "../model/currency-search.js";
import { MutationQueue } from "./mutation-queue.js";
import { persistWatchlistMove, type WatchlistMove } from "./watchlist-order.js";
import { applyLastPrice, applyQuoteSnapshot, quoteSnapshot } from "./quote-snapshot.js";
import { QuoteDayBases, MISSING_DAY_BASE } from "./quote-day-bases.js";
import { liveQuoteTimeLimit } from "./quote-day-base.js";
import { profileKey } from "./profile-key.js";
import { selectedMarketRow } from "../model/selected-instrument.js";
import { isBankIdentity } from "../model/market-provider.js";
import { assertBankRequest } from "./market-bank-cache.js";
import { lastPriceSubscription } from "./market-subscriptions.js";
import { BankCandleStream } from "./tbank-candle-stream.js";
import { resolveWatchlist, quotation, normaliseCandles } from "../model/market-model.js";
import { TIMEFRAMES, splitRanges, subtractRanges, mergeCandles } from "../model/history-codec.js";
import { historyRequestWindow, shiftTimeframe } from "../model/intervals/calendar.js";
import { nativeTimeframe } from "../model/intervals/native-timeframes.js";
import type {
  Catalog,
  CatalogInstrument,
  HistoryRange,
  InstrumentSearchKind,
  MarketRow,
  Timeframe
} from "../model/types.js";
import { errorMessage, list, normaliseInstrument, object, text } from "./types.js";

import { BankError, BankTransport } from "./tbank-transport.js";
export { BankError } from "./tbank-transport.js";

import type {
  Cache,
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
  private readonly candleStream: BankCandleStream;
  private socketOpened = false;
  private readonly transport: BankTransport;
  private readonly mutations = new MutationQueue();
  private readonly dayBases: QuoteDayBases;
  constructor(
    private readonly token: string,
    public readonly name: string,
    private readonly cache: Cache
  ) {
    super();
    this.candleStream = new BankCandleStream(
      (body) => this.send(body),
      (...args) => this.cache.saveHistory(...args),
      () => this.owner,
      () => this.flush(),
      () => this.emit("notice", "Не удалось сохранить новые свечи. Проверьте свободное место.")
    );
    this.dayBases = new QuoteDayBases(
      this,
      () => this.serverNow(),
      (row) => !this.closed && this.rows.includes(row),
      () => this.notify(),
      () => this.emit("notice", MISSING_DAY_BASE)
    );
    this.transport = new BankTransport(token, {
      connecting: () => {
        this.state = "connecting";
        this.error = null;
        this.notify();
      },
      open: () => {
        this.dayBases.retryMissing();
        const ids = this.rows.flatMap((row) => (row.uid ? [row.uid] : []));
        if (ids.length) this.send(lastPriceSubscription("subscribe", ids));
        else {
          this.state = "connected";
          this.notify();
        }
        this.send({ pingSettings: { pingDelayMs: 10000 } });
        this.candleStream.open();
        if (this.socketOpened) this.emit("reconnect", undefined);
        this.socketOpened = true;
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
    const catalog = await loadBankCatalog(this.cache, (service, method, body) =>
      this.request(service, method, body)
    );
    this.catalog = catalog;
    const watchlist = await this.cache.loadWatchlist(this.owner);
    this.rows =
      watchlist !== undefined
        ? watchlist
        : resolveWatchlist(catalog.shares, catalog.futures, catalog.indicatives);
    this.candleStream.keepRows(new Set(this.rows.flatMap((row) => (row.uid ? [row.uid] : []))));
    const catalogByUid = new Map(
      [
        ...catalog.shares,
        ...catalog.futures,
        ...catalog.indicatives,
        ...(catalog.currencies ?? []).map((item) => ({ ...item, kind: "currency" as const }))
      ].map((item) => [item.uid ?? item.instrumentUid, item])
    );
    for (const row of this.rows) {
      const item = row.uid ? catalogByUid.get(row.uid) : undefined;
      if (!item) continue;
      if (item.kind === "currency") row.type = "currency";
      for (const key of ["classCode", "exchange", "realExchange"] as const)
        if (item[key] !== undefined) row[key] = item[key];
      if (item.brand !== undefined) row.brand = item.brand;
      row.first1minCandleDate = item.first1minCandleDate ?? row.first1minCandleDate;
      row.first1dayCandleDate = item.first1dayCandleDate ?? row.first1dayCandleDate;
      row.firstTradeDate = item.firstTradeDate ?? row.firstTradeDate;
    }
    await this.cache.saveWatchlist(this.owner, this.rows);
    const ids = this.rows.flatMap((row) => (row.uid ? [row.uid] : []));
    if (!ids.length) {
      await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
      this.connect();
      return this.snapshot();
    }
    const [prices, close] = await quoteSnapshot(this, ids);
    if (prices.status === "rejected") throw prices.reason;
    this.dayBases.clear();
    this.dayBases.seed(close.status === "fulfilled" ? close.value.closePrices : []);
    applyQuoteSnapshot(this.rows, cached?.rows ?? [], prices.value.lastPrices, this.serverNow());
    for (const row of this.rows) this.dayBases.update(row);
    await this.dayBases.settled();
    this.updatedAt = new Date().toISOString();
    this.notify();
    await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
    this.connect();
    return this.snapshot();
  }
  applyPrice(input: unknown, notify = true): void {
    const now = this.serverNow(),
      acceptedThrough = notify ? liveQuoteTimeLimit(now) : now,
      row = applyLastPrice(this.rows, input, acceptedThrough);
    if (!row) return;
    this.dayBases.update(row, acceptedThrough);
    this.updatedAt = new Date().toISOString();
    if (notify) this.notify();
  }
  async searchInstruments(
    query: string,
    type: InstrumentSearchKind = "all",
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
    if (!isBankIdentity(instrument))
      throw new BankError("Источник инструмента не является Т‑Банком.", 400);
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
      ...(full.classCode ? { classCode: full.classCode } : {}),
      ...(full.exchange ? { exchange: full.exchange } : {}),
      ...(full.realExchange ? { realExchange: full.realExchange } : {}),
      name: full.name,
      currency: full.currency || "rub",
      type:
        catalogInstrumentKind(full) === "currency"
          ? "currency"
          : instrument.kind === "future"
            ? "future"
            : instrument.kind === "index"
              ? "index"
              : undefined,
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
      const [prices, close] = await quoteSnapshot(this, [uid]);
      if (prices.status === "rejected") throw prices.reason;
      this.dayBases.seed(close.status === "fulfilled" ? close.value.closePrices : []);
      for (const price of list(prices.value.lastPrices)) this.applyPrice(price, false);
      await this.dayBases.settled();
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
      if (unsubscribe) {
        this.send(lastPriceSubscription("unsubscribe", [unsubscribe]));
        this.candleStream.remove(unsubscribe);
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
      if (
        bar &&
        uid &&
        interval &&
        !this.cachePaused &&
        this.candleStream.receive(uid, interval, bar)
      )
        this.emit<CandleEvent>("candle", { uid, interval, bar });
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
    assertBankRequest(data);
    this.transport.send(data);
  }
  subscribeCandles(uid: string, timeframe: Timeframe): void {
    this.candleStream.select(uid, timeframe);
  }
  unsubscribeCandles(): void {
    this.candleStream.clearPrimary();
  }
  retainCandle(uid: string, timeframe: Timeframe): () => void {
    return this.candleStream.retain(uid, timeframe);
  }
  async flush(): Promise<void> {
    await this.candleStream.flush();
    if (this.rows.length && !this.mutations.active)
      await this.cache.saveMarket(this.owner, { rows: this.rows, at: Date.now() });
  }
  async candles(
    symbol: string,
    timeframe: Timeframe,
    range: HistoryRange,
    { signal, onProgress, uid }: CandleOptions = {},
    select = true
  ): Promise<CandleResult> {
    signal?.throwIfAborted();
    nativeTimeframe(timeframe);
    range = historyRequestWindow(range, timeframe);
    const row = selectedMarketRow(this.rows, { symbol, instrumentUid: uid });
    if (!row?.uid || !isBankIdentity(row))
      throw new BankError("Инструмент недоступен у банка.", 404);
    const config = TIMEFRAMES[timeframe];
    if (!config) throw new BankError("Неизвестный таймфрейм.", 400);
    const cached = await this.cache.loadHistory(
      this.owner,
      row.uid,
      timeframe,
      range.from,
      range.to
    );
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    const closedTo = Math.min(range.to, shiftTimeframe(Date.now(), timeframe, -2));
    const gaps = subtractRanges(range.from, Math.max(range.from, closedTo), coverage);
    const recent = coverage.find(
      (covered) =>
        covered.from <= closedTo &&
        covered.to >= shiftTimeframe(range.to, timeframe, -1) &&
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
      signal?.throwIfAborted();
      if (!this.cachePaused) {
        await this.cache.saveHistory(this.owner, row.uid, timeframe, next, {
          ...part,
          fetchedAt: Date.now()
        });
        signal?.throwIfAborted();
      }
      bars = mergeCandles(bars, next);
      onProgress?.({
        candles: bars,
        cached: !!cached.length,
        completed: index + 1,
        total: pieces.length
      });
    }
    signal?.throwIfAborted();
    if (select) this.subscribeCandles(row.uid, timeframe);
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
    return this.flush();
  }
}
