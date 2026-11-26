import { TBankClient } from "./tbank-client.js";
import { bankCacheView, assertBankRequest } from "./market-bank-cache.js";
import { PublicMarket } from "./market-public.js";
import type { PublicMarketOptions } from "./market-public.js";
import { publicMarketRow, applyPublicQuote } from "./market-public-mapping.js";
import { MutationQueue } from "./mutation-queue.js";
import { persistWatchlistMove } from "./watchlist-order.js";
import type { WatchlistMove } from "./watchlist-order.js";
import { profileKey } from "./profile-key.js";
import { isBankIdentity, validProviderIdentity } from "../model/market-provider.js";
import { selectedMarketRow } from "../model/selected-instrument.js";
import type {
  MarketRow,
  CatalogInstrument,
  InstrumentSearchKind,
  Timeframe,
  HistoryRange
} from "../model/types.js";
import type { Cache, CandleOptions, CandleResult, CandleEvent, BankSnapshot } from "./types.js";
import type { OpenInterestObservations } from "../model/technical-indicators/ta-batch-external.js";
import type { TurnoverInterval } from "../model/technical-indicators/ta-batch-volume-flow-turnover.js";
export interface MarketSnapshot extends Omit<BankSnapshot, "status"> {
  marketReady: boolean;
  status: string;
}
export interface MarketClientOptions extends PublicMarketOptions {
  bankFactory?: (token: string, name: string, cache: Cache) => TBankClient;
  owner?: string;
}
/** The only ordered mixed watchlist writer. Bank adapters see an explicitly filtered cache view. */
export class MarketClient extends EventTarget {
  private values: MarketRow[] = [];
  owner: string;
  readonly name: string;
  private readonly bank: TBankClient | null;
  private readonly publicMarket: PublicMarket;
  private readonly mutations = new MutationQueue();
  private closedValue = false;
  private ready = false;
  private starting: Promise<MarketSnapshot> | undefined;
  private quoteTimer: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private offline = false;
  private readonly online: () => boolean;
  constructor(
    private readonly token: string | null,
    name: string,
    private readonly cache: Cache,
    options: MarketClientOptions = {}
  ) {
    super();
    this.owner = options.owner ?? "public";
    this.name = name;
    this.online =
      options.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.bank = token
      ? (options.bankFactory?.(token, name, bankCacheView(cache)) ??
        new TBankClient(token, name, bankCacheView(cache)))
      : null;
    this.publicMarket = new PublicMarket(
      () => this.owner,
      cache,
      {
        quote: (quote) => {
          const row = this.values.find((row) => row.uid === quote.seriesId);
          if (!row || !applyPublicQuote(row, quote)) return;
          this.notify();
          this.scheduleSave();
        },
        candle: (event) => this.emit<CandleEvent>("candle", event),
        notice: (message) => this.emit("notice", message),
        reconnect: (source) => this.emit("market-reconnect", source)
      },
      options
    );
    this.bank?.addEventListener("state", () => {
      if (this.closed) return;
      this.mergeBankQuotes();
      this.notify();
      this.scheduleSave();
    });
    this.bank?.addEventListener("notice", (event) =>
      this.emit("notice", (event as CustomEvent<string>).detail)
    );
    this.bank?.addEventListener("candle", (event) =>
      this.emit("candle", (event as CustomEvent<CandleEvent>).detail)
    );
  }
  get rows(): MarketRow[] {
    return this.values;
  }
  set rows(rows: MarketRow[]) {
    if (rows.some((row) => !validProviderIdentity(row)))
      throw new Error("Некорректная идентичность инструмента.");
    this.values = rows;
    if (this.bank) this.bank.rows = rows.filter(isBankIdentity);
    if (this.ready) this.publicMarket.sync(rows);
  }
  get authenticated(): boolean {
    return this.bank?.authenticated ?? false;
  }
  get bankClient(): TBankClient | null {
    return this.bank;
  }
  get closed(): boolean {
    return this.closedValue;
  }
  get cachePaused(): boolean {
    return this.paused;
  }
  set cachePaused(value: boolean) {
    this.paused = value;
    this.publicMarket.cachePaused = value;
    if (this.bank) this.bank.cachePaused = value;
  }
  async prepareOwner(): Promise<string> {
    if (this.token) this.owner = await profileKey(this.token);
    return this.owner;
  }
  serverNow(): number {
    return this.bank?.serverNow() ?? Date.now();
  }
  request(
    service: string,
    method: string,
    body: object = {},
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    assertBankRequest(body);
    if (!this.bank || !this.authenticated)
      return Promise.reject(new Error("Подключите личный ключ Т‑Банка."));
    return this.bank.request(service, method, body, signal);
  }
  snapshot(): MarketSnapshot {
    const bank = this.bank?.snapshot();
    return {
      authenticated: this.authenticated,
      marketReady: this.ready,
      accountName: this.name,
      profileKey: this.owner,
      rows: this.values,
      status: this.offline ? "offline" : (bank?.status ?? "offline"),
      error: this.offline ? null : (bank?.error ?? null),
      updatedAt: bank?.updatedAt ?? null,
      transport: "websocket"
    };
  }
  private emit<T>(type: string, detail: T): void {
    if (!this.closed) this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  private notify(): void {
    this.emit("state", this.snapshot());
  }
  private mergeBankQuotes(): void {
    if (!this.bank) return;
    const byId = new Map(this.bank.rows.map((row) => [row.uid, row]));
    this.values = this.values.map((row) =>
      isBankIdentity(row) ? (byId.get(row.uid) ?? row) : row
    );
  }
  start(): Promise<MarketSnapshot> {
    if (this.closed) return Promise.reject(new DOMException("Источник отключён", "AbortError"));
    this.starting ??= this.startNow().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async startNow(): Promise<MarketSnapshot> {
    await this.prepareOwner();
    if (this.closed) throw new DOMException("Источник отключён", "AbortError");
    const rows = await this.cache.loadWatchlist(this.owner),
      cached = await this.cache.loadMarket(this.owner);
    if (this.closed) throw new DOMException("Источник отключён", "AbortError");
    this.rows = rows ?? cached?.rows ?? [];
    if (this.bank) {
      let bank;
      try {
        bank = await this.bank.start();
        this.offline = false;
      } catch (error) {
        if (this.online() || (rows === undefined && cached === undefined)) throw error;
        this.bank.authenticated = true;
        this.bank.rows = this.values.filter(isBankIdentity);
        this.offline = true;
        bank = this.bank.snapshot();
      }
      if (this.closed) throw new DOMException("Источник отключён", "AbortError");
      const ids = new Set(this.values.filter(isBankIdentity).map((row) => row.uid));
      this.values = [...this.values, ...bank.rows.filter((row) => !ids.has(row.uid))];
      this.mergeBankQuotes();
    }
    this.ready = true;
    this.publicMarket.sync(this.values);
    await this.cache.saveWatchlistSnapshot(this.owner, this.values);
    this.notify();
    void this.publicMarket.snapshot();
    return this.snapshot();
  }
  async searchInstruments(
    query: string,
    kind: InstrumentSearchKind = "all",
    signal?: AbortSignal
  ): Promise<CatalogInstrument[]> {
    signal?.throwIfAborted();
    const [bank, publicResult] = await Promise.allSettled([
      this.authenticated && kind !== "crypto" && kind !== "tokenized-stock"
        ? this.bank!.searchInstruments(query, kind, signal)
        : Promise.resolve([]),
      this.publicMarket.search(query, kind, signal)
    ]);
    signal?.throwIfAborted();
    const rows = [
      ...(bank.status === "fulfilled" ? bank.value : []),
      ...(publicResult.status === "fulfilled" ? publicResult.value : [])
    ];
    const error: unknown =
      publicResult.status === "rejected"
        ? publicResult.reason
        : bank.status === "rejected"
          ? bank.reason
          : undefined;
    if (error && !rows.length)
      throw error instanceof Error ? error : new Error("Источник котировок недоступен.");
    if (error) this.emit("notice", "Один из источников недоступен; показаны доступные результаты.");
    return rows.slice(0, 160);
  }
  addInstrument(instrument: CatalogInstrument): Promise<MarketRow> {
    return this.mutations.run(async () => {
      if (this.closed) throw new DOMException("Источник отключён", "AbortError");
      const uid = instrument.uid ?? instrument.instrumentUid;
      const old = this.values.find((row) => row.uid === uid);
      if (old) return old;
      if (this.values.length >= 300) throw new Error("В списке поддерживается до300 инструментов.");
      let row: MarketRow;
      if (instrument.providerRef) row = publicMarketRow(await this.publicMarket.verify(instrument));
      else {
        if (!this.bank || !this.authenticated)
          throw new Error("Для инструмента Т‑Банка нужен личный ключ.");
        row = await this.bank.addInstrument(instrument);
      }
      if (this.closed) throw new DOMException("Источник отключён", "AbortError");
      await this.commit([...this.values, row]);
      void this.publicMarket.snapshot();
      return row;
    });
  }
  removeInstrument(reference: Pick<MarketRow, "uid" | "symbol">): Promise<void> {
    return this.mutations.run(async () => {
      const row = this.values.find(
        (row) => row.uid === reference.uid && row.symbol === reference.symbol
      );
      if (!row) return;
      if (isBankIdentity(row)) await this.bank?.removeInstrument(reference);
      await this.commit(this.values.filter((item) => item !== row));
    });
  }
  reorderWatchlist(move: WatchlistMove): Promise<boolean> {
    return this.mutations.run(() =>
      persistWatchlistMove(
        this,
        this.cache,
        () => {
          this.rows = this.values;
          this.notify();
        },
        move
      )
    );
  }
  private async commit(rows: MarketRow[]): Promise<void> {
    await this.cache.saveWatchlistSnapshot(this.owner, rows);
    this.rows = rows;
    this.notify();
  }
  settleMutations(): Promise<void> {
    return this.mutations.run(async () => {});
  }
  loadQuoteTurnover(
    uid: string,
    interval: TurnoverInterval,
    range: HistoryRange,
    signal: AbortSignal
  ) {
    if (this.closed || signal.aborted) return Promise.resolve(null);
    const row = this.values.find((item) => item.uid === uid);
    return row
      ? this.publicMarket.loadQuoteTurnover(row, interval, range, signal)
      : Promise.resolve(null);
  }
  loadOpenInterest(
    uid: string,
    timeframe: Timeframe,
    range: HistoryRange,
    signal: AbortSignal,
    onPage?: (page: OpenInterestObservations) => void
  ): Promise<OpenInterestObservations | null> {
    if (this.closed || signal.aborted) return Promise.resolve(null);
    const row = this.values.find((item) => item.uid === uid);
    return row
      ? this.publicMarket.loadOpenInterest(row, timeframe, range, signal, onPage)
      : Promise.resolve(null);
  }
  async candles(
    symbol: string,
    timeframe: Timeframe,
    range: HistoryRange,
    options: CandleOptions = {}
  ): Promise<CandleResult> {
    const row = selectedMarketRow(this.values, { symbol, instrumentUid: options.uid });
    this.publicMarket.select(null, timeframe);
    if (row?.providerRef) {
      this.bank?.unsubscribeCandles();
      return this.publicMarket.candles(row, timeframe, range, options);
    }
    if (!this.bank || !this.authenticated) {
      if (!row?.uid) throw new Error("Инструмент недоступен.");
      const candles = await this.cache.loadHistory(
        this.owner,
        row.uid,
        timeframe,
        range.from,
        range.to
      );
      return {
        symbol,
        ticker: row.ticker,
        timeframe,
        candles,
        cached: true,
        requests: 0,
        source: "Т‑Банк · кеш устройства; нужен ключ для обновления"
      };
    }
    return this.bank.candles(symbol, timeframe, range, options);
  }
  subscribeCandles(uid: string, timeframe: Timeframe): void {
    const row = this.values.find((row) => row.uid === uid);
    if (row?.providerRef) {
      this.bank?.unsubscribeCandles();
      this.publicMarket.select(row, timeframe);
    } else {
      this.publicMarket.select(null, timeframe);
      this.bank?.subscribeCandles(uid, timeframe);
    }
  }
  private scheduleSave(): void {
    if (!this.ready || this.paused || this.quoteTimer) return;
    this.quoteTimer = setTimeout(() => {
      this.quoteTimer = undefined;
      void this.flush().catch(() => this.emit("notice", "Не удалось сохранить котировки."));
    }, 1500);
  }
  async flush(): Promise<void> {
    clearTimeout(this.quoteTimer);
    this.quoteTimer = undefined;
    await this.publicMarket.flush();
    await this.bank?.flush();
    if (!this.paused && !this.mutations.active)
      await this.cache.saveMarket(this.owner, { rows: this.values, at: Date.now() });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closedValue = true;
    clearTimeout(this.quoteTimer);
    await this.publicMarket.close();
    await this.bank?.close();
    if (!this.paused)
      await this.cache.saveMarket(this.owner, { rows: this.values, at: Date.now() });
  }
}
