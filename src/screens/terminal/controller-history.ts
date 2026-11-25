import * as storage from "../../services/storage.js";
import { activeMtpPeriods } from "../../model/mtp.js";
import { mergeCandles, TIMEFRAMES } from "../../model/history-codec.js";
import type { Timeframe } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TBankClient } from "../../services/tbank-client.js";
import { errorText, isAbort } from "./controller-bridge.js";
import type { HistoryBridge } from "./controller-bridge.js";

export class TerminalHistory {
  private abort: AbortController | null = null;
  private requestId = 0;
  private cursor: number | null = null;
  private startReached = false;
  private olderBusy = false;
  private olderTimer: ReturnType<typeof setTimeout> | null = null;
  private source: { symbol: string; timeframe: Timeframe; uid: string; rangeDays: number } | null =
    null;
  private readonly clearingOwners = new Map<string, number>();
  constructor(private readonly bridge: HistoryBridge) {}
  get clearing(): boolean {
    return (this.clearingOwners.get(this.bridge.getState().owner) ?? 0) > 0;
  }
  reset(): void {
    this.abort?.abort();
    this.abort = null;
    this.requestId++;
    if (this.olderTimer !== null) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    this.source = null;
    this.cursor = null;
    this.startReached = false;
    this.olderBusy = false;
  }
  private current(id: number, client: TBankClient, owner: string): boolean {
    const state = this.bridge.getState(),
      source = this.source;
    return (
      this.bridge.isAlive() &&
      id === this.requestId &&
      client === this.bridge.getClient() &&
      owner === state.owner &&
      source !== null &&
      source.symbol === state.preferences.symbol &&
      source.timeframe === state.preferences.timeframe &&
      source.rangeDays === state.preferences.rangeDays &&
      source.uid === selectedMarketRow(state.rows, state.preferences)?.uid
    );
  }
  async load(refresh = false): Promise<void> {
    const state = this.bridge.getState(),
      client = this.bridge.getClient();
    const row = selectedMarketRow(state.rows, state.preferences);
    if (!this.bridge.isAlive() || !client || !row?.uid || state.loading || this.clearing) return;
    this.reset();
    const id = this.requestId,
      owner = state.owner,
      p = state.preferences,
      until = Date.now();
    const period = Math.max(0, ...activeMtpPeriods(p.indicators));
    const warmupDays =
      Math.ceil(((period * TIMEFRAMES[p.timeframe].ms) / 86400000) * 1.65) + (period ? 14 : 0);
    const from = Math.floor((until - (p.rangeDays + warmupDays) * 86400000) / 86400000) * 86400000;
    this.source = {
      symbol: p.symbol,
      timeframe: p.timeframe,
      uid: row.uid,
      rangeDays: p.rangeDays
    };
    const abort = new AbortController();
    this.abort = abort;
    this.bridge.update({ loading: true, historyHelp: "Загружаем историю…" });
    try {
      const [drawings, images] = await Promise.all([
        storage.loadDrawings(owner, p.symbol),
        storage.loadImages(owner, p.symbol)
      ]);
      if (!this.current(id, client, owner)) return;
      this.bridge.update({
        drawings,
        images: images.sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0))
      });
      const result = await client.candles(
        p.symbol,
        p.timeframe,
        { from, to: until },
        {
          uid: row.uid,
          signal: abort.signal,
          onProgress: (progress) => {
            if (!this.current(id, client, owner)) return;
            if (progress.cached && progress.candles.length)
              this.bridge.update({
                candles: refresh
                  ? mergeCandles(progress.candles, this.bridge.getState().candles)
                  : progress.candles
              });
            this.bridge.update({
              historyHelp: `Загружено ${progress.completed}/${progress.total} частей`
            });
          }
        }
      );
      if (!this.current(id, client, owner)) return;
      this.cursor = from;
      const candles = refresh
        ? mergeCandles(result.candles, this.bridge.getState().candles)
        : result.candles;
      this.bridge.update({
        candles,
        historyHelp: `${candles.length} свечей · ${result.cached ? "IndexedDB" : "Т‑Банк"} · ${result.requests} новых запросов`
      });
    } catch (error) {
      if (!isAbort(error) && this.current(id, client, owner)) {
        this.bridge.notify(errorText(error));
        this.bridge.update({
          historyHelp: this.bridge.getState().candles.length
            ? "Сохранённая история · сеть недоступна"
            : errorText(error)
        });
      }
    } finally {
      if (this.current(id, client, owner)) this.bridge.update({ loading: false });
    }
  }
  scheduleOlder(): void {
    const state = this.bridge.getState();
    if (
      !this.bridge.isAlive() ||
      state.loading ||
      this.olderBusy ||
      this.startReached ||
      this.clearing ||
      !state.candles.length
    )
      return;
    if (this.olderTimer !== null) clearTimeout(this.olderTimer);
    this.olderTimer = setTimeout(() => {
      this.olderTimer = null;
      void this.loadOlder();
    }, 350);
  }
  private async loadOlder(): Promise<void> {
    const state = this.bridge.getState(),
      client = this.bridge.getClient(),
      first = state.candles[0];
    const row = selectedMarketRow(state.rows, state.preferences);
    if (
      !this.bridge.isAlive() ||
      !client ||
      !row?.uid ||
      !first ||
      this.olderBusy ||
      state.loading ||
      this.clearing
    )
      return;
    const id = this.requestId,
      owner = state.owner,
      p = state.preferences;
    const until = Math.min(this.cursor ?? first.timestamp, first.timestamp);
    const days: Record<Timeframe, number> = {
      "1m": 3,
      "5m": 14,
      "15m": 30,
      "30m": 60,
      "1h": 120,
      "1d": 730,
      "1w": 1460
    };
    const parsed = Date.parse(
      (["1d", "1w"].includes(p.timeframe) ? row.first1dayCandleDate : row.first1minCandleDate) ??
        row.firstTradeDate ??
        "1990-01-01"
    );
    const earliest = Number.isFinite(parsed) ? parsed : Date.parse("1990-01-01");
    const from = Math.max(earliest, until - days[p.timeframe] * 86400000);
    if (from >= until) {
      this.startReached = true;
      return;
    }
    this.olderBusy = true;
    this.bridge.update({ historyHelp: "Подгружаем более ранние свечи…" });
    try {
      const options = { uid: row.uid, ...(this.abort ? { signal: this.abort.signal } : {}) };
      const result = await client.candles(p.symbol, p.timeframe, { from, to: until }, options);
      if (!this.current(id, client, owner) || this.clearing) return;
      this.cursor = from;
      this.startReached = from <= earliest || (!navigator.onLine && !result.candles.length);
      const candles = mergeCandles(result.candles, this.bridge.getState().candles);
      this.bridge.update({
        candles,
        historyHelp: `${candles.length} свечей · история слева · ${result.requests} новых запросов`
      });
    } catch (error) {
      if (!isAbort(error) && this.current(id, client, owner)) this.bridge.notify(errorText(error));
    } finally {
      if (this.current(id, client, owner)) this.olderBusy = false;
    }
  }
  async clear(uid: string | null, timeframe: Timeframe | null): Promise<void> {
    const owner = this.bridge.getState().owner,
      client = this.bridge.getClient();
    this.clearingOwners.set(owner, (this.clearingOwners.get(owner) ?? 0) + 1);
    this.reset();
    const id = this.requestId;
    if (client) client.cachePaused = true;
    try {
      await client?.flush();
      await storage.clearHistory(owner, { uid, timeframe });
      if (this.bridge.isAlive() && owner === this.bridge.getState().owner)
        this.bridge.notify("Котировки очищены. Новые свечи продолжат сохраняться.");
    } finally {
      const pending = (this.clearingOwners.get(owner) ?? 1) - 1;
      if (pending) this.clearingOwners.set(owner, pending);
      else this.clearingOwners.delete(owner);
      if (client) client.cachePaused = pending > 0;
      if (
        this.bridge.isAlive() &&
        id === this.requestId &&
        owner === this.bridge.getState().owner &&
        client === this.bridge.getClient()
      ) {
        this.abort = new AbortController();
        this.bridge.update({ loading: false });
      }
    }
  }
}
