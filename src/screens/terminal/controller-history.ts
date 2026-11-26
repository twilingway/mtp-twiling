import * as storage from "../../services/storage-v2.js";
import { loadChartView } from "../../services/chart-camera.js";
import { activeMtpPeriods } from "../../model/mtp.js";
import { volumeAverageWarmup } from "../../model/volume-average.js";
import { mergeCandles, TIMEFRAMES } from "../../model/history-codec.js";
import { historyWindowStart, olderHistoryStart } from "../../model/intervals/calendar.js";
import type { Candle, ChartEngine, Timeframe } from "../../model/types.js";
import {
  HISTORY_FALLBACK_FIRST,
  historyFirstDate,
  historyRangeCovered,
  historyViewBackfillFrom,
  historyViewCachedWindow,
  historyViewCoverage,
  historyViewNeedsWidth,
  planHistoryViewRange
} from "../../model/history-view-range.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { MarketClient } from "../../services/market-client.js";
import { errorText, isAbort, viewKey } from "./controller-bridge.js";
import type { HistoryBridge } from "./controller-bridge.js";
import { readWorkspaceAnnotations } from "./workspace-annotations.js";

export class TerminalHistory {
  private abort: AbortController | null = null;
  private requestId = 0;
  private cursor: number | null = null;
  private startReached = false;
  private olderBusy = false;
  private olderTimer: ReturnType<typeof setTimeout> | null = null;
  private source: {
    symbol: string;
    timeframe: Timeframe;
    engine: ChartEngine;
    uid: string;
    rangeDays: number;
  } | null = null;
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
  private current(id: number, client: MarketClient, owner: string): boolean {
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
      source.engine === state.preferences.engine &&
      source.rangeDays === state.preferences.rangeDays &&
      source.uid === selectedMarketRow(state.rows, state.preferences)?.uid
    );
  }
  private async plotWidth(
    current: () => boolean,
    signal: AbortSignal,
    owner: string,
    key: string,
    uid: string
  ): Promise<number> {
    const deadline = Date.now() + 5000;
    while (current()) {
      signal.throwIfAborted();
      const chart = this.bridge.getChart(),
        source = chart?.source;
      if (
        chart &&
        (!source || (source.owner === owner && source.viewKey === key && source.uid === uid))
      ) {
        const width = chart.plotSize().width;
        if (Number.isFinite(width) && width > 0) return width;
      }
      if (Date.now() >= deadline)
        throw new Error(
          "Сохранённое окно ожидает доступную область графика; история ещё не восстановлена."
        );
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", aborted);
          resolve();
        }, 32);
        signal.addEventListener("abort", aborted, { once: true });
      });
    }
    throw new DOMException("Aborted", "AbortError");
  }
  async load(refresh = false): Promise<void> {
    const state = this.bridge.getState(),
      client = this.bridge.getClient();
    const row = selectedMarketRow(state.rows, state.preferences);
    if (
      !this.bridge.isAlive() ||
      !client ||
      !row?.uid ||
      (state.loading && !refresh) ||
      this.clearing
    )
      return;
    this.reset();
    const id = this.requestId,
      owner = state.owner,
      p = state.preferences,
      until = Date.now();
    const period = Math.max(
      0,
      ...activeMtpPeriods(p.indicators),
      p.indicators.ma ? 20 : 0,
      p.indicators.ema ? 50 : 0
    );
    this.source = {
      symbol: p.symbol,
      timeframe: p.timeframe,
      engine: p.engine,
      uid: row.uid,
      rangeDays: p.rangeDays
    };
    const abort = new AbortController();
    this.abort = abort;
    const current = () => this.current(id, client, owner) && !abort.signal.aborted,
      key = viewKey(p),
      chart = this.bridge.getChart(),
      source = chart?.source,
      liveView =
        refresh &&
        !chart?.retired &&
        chart?.persistView !== false &&
        (!source || (source.owner === owner && source.viewKey === key && source.uid === row.uid))
          ? chart?.getView()
          : null;
    let available: Candle[] = refresh ? [...state.candles] : [],
      restoring = true;
    this.bridge.update({
      loading: true,
      historyViewReady: false,
      historyViewFallback: false,
      historyHelp: "Загружаем историю…"
    });
    try {
      const savedView = await loadChartView(owner, key);
      if (!current()) return;
      const view = liveView ?? savedView,
        width = historyViewNeedsWidth(view)
          ? await this.plotWidth(current, abort.signal, owner, key, row.uid)
          : undefined;
      if (!current()) return;
      const plan = planHistoryViewRange({
        until,
        rangeDays: p.rangeDays,
        intervalMs: TIMEFRAMES[p.timeframe].ms,
        period,
        first: historyFirstDate(row, p.timeframe),
        view,
        width
      });
      restoring = plan.mode !== "none";
      let from = plan.from;
      const { drawings, images } = await readWorkspaceAnnotations(owner, p.symbol);
      if (!current()) return;
      this.bridge.update({
        drawings,
        images: [...images].sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0)),
        historyViewReady: !restoring
      });
      const result = await client.candles(
        p.symbol,
        p.timeframe,
        { from, to: until },
        {
          uid: row.uid,
          signal: abort.signal,
          onProgress: (progress) => {
            if (!current()) return;
            available = mergeCandles(available, progress.candles);
            if (!restoring && progress.cached && progress.candles.length)
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
      if (!current()) return;
      available = mergeCandles(available, result.candles);
      const provider =
          row.providerRef?.provider === "okx" ? "OKX" : row.providerRef ? "Bybit" : "Т‑Банк",
        probeSpotStart =
          !plan.knownFirst &&
          row.providerRef?.category === "spot" &&
          (p.timeframe === "1d" || p.timeframe === "1w" || p.timeframe === "1M");
      let coverage = historyViewCoverage(plan, available, from),
        requests = result.requests,
        rangeCovered = result.requestedRangeCovered === true,
        emptySpan = available.length ? 0 : until - from,
        backfillMultiplier = 1,
        historyViewFallback = false,
        exhausted = false,
        incomplete = "";
      while (!coverage.complete) {
        if (!navigator.onLine) {
          incomplete = "Офлайн: сохранённому окну не хватает свечей.";
          break;
        }
        if (from <= plan.earliest) {
          exhausted = true;
          const first = available[0];
          if (probeSpotStart && rangeCovered && first) {
            coverage = { ...coverage, complete: true };
            historyViewFallback =
              plan.visibleTo < first.timestamp ||
              (plan.mode === "anchor" && plan.target < first.timestamp);
            if (historyViewFallback)
              incomplete = `Сохранённое окно раньше первой свечи ${provider}. Показана доступная история.`;
          } else {
            incomplete = "Достигнута граница истории, но сохранённое окно покрыто не полностью.";
          }
          break;
        }
        if (!plan.knownFirst && emptySpan >= 365 * 86400000) {
          exhausted = true;
          incomplete = "Источник не дал свечей за год: сохранённое окно ещё не восстановлено.";
          break;
        }
        const nextFrom = Math.max(
            plan.earliest,
            probeSpotStart && rangeCovered && available.length
              ? plan.earliest
              : historyViewBackfillFrom(plan, from, coverage.missingBars, backfillMultiplier)
          ),
          previousFrom = from;
        this.bridge.update({ historyHelp: "Восстанавливаем левый край сохранённого окна…" });
        const older = await client.candles(
          p.symbol,
          p.timeframe,
          { from: nextFrom, to: from - 1 },
          { uid: row.uid, signal: abort.signal }
        );
        if (!current()) return;
        from = nextFrom;
        requests += older.requests;
        rangeCovered &&= older.requestedRangeCovered === true;
        const earlier = older.candles.filter((bar) => bar.timestamp < previousFrom);
        available = mergeCandles(earlier, available);
        coverage = historyViewCoverage(plan, available, from);
        if (earlier.length) {
          emptySpan = 0;
          backfillMultiplier = 1;
        } else {
          emptySpan += previousFrom - from;
          backfillMultiplier *= 2;
        }
      }
      if (exhausted && !coverage.complete && available.length && navigator.onLine) {
        historyViewFallback = true;
        incomplete = "Не удалось восстановить сохранённое окно. Показаны доступные свечи.";
      }
      if (restoring && coverage.complete && !navigator.onLine) {
        const ranges = await storage.loadCoverage(owner, row.uid, p.timeframe);
        if (!current()) return;
        const cachedWindow = historyViewCachedWindow(plan, available);
        if (!historyRangeCovered(ranges, cachedWindow.from, cachedWindow.to)) {
          coverage = { ...coverage, complete: false };
          historyViewFallback = false;
          incomplete = "Офлайн: покрытие сохранённого окна в кеше не подтверждено.";
        }
      }
      this.cursor = from;
      this.startReached = from <= plan.earliest;
      const candles = refresh ? mergeCandles(available, this.bridge.getState().candles) : available;
      this.bridge.update({
        candles,
        historyViewReady: coverage.complete || historyViewFallback,
        historyViewFallback,
        historyHelp:
          incomplete ||
          `${candles.length} свечей · ${requests ? provider : "IndexedDB"} · ${requests} новых запросов`
      });
      if (historyViewFallback) this.bridge.notify(incomplete);
    } catch (error) {
      if (!isAbort(error) && current()) {
        this.bridge.notify(errorText(error));
        this.bridge.update({
          ...(available.length ? { candles: available } : {}),
          historyViewReady: !restoring,
          historyHelp: restoring
            ? `Сохранённое окно не восстановлено: ${errorText(error)}`
            : this.bridge.getState().candles.length
              ? "Сохранённая история · сеть недоступна"
              : errorText(error)
        });
      }
    } finally {
      if (this.current(id, client, owner)) {
        this.bridge.update({ loading: false });
        if (this.bridge.getState().historyViewReady) this.scheduleOlder(true);
      }
    }
  }
  private volumeAverageDeficit(): number {
    const { candles, preferences: p } = this.bridge.getState();
    const period = p.indicators.volume ? volumeAverageWarmup(p.chartSettings, true) : 0;
    return Math.max(0, period - candles.length);
  }
  scheduleOlder(volumeAverage = false): void {
    const state = this.bridge.getState();
    if (
      !this.bridge.isAlive() ||
      state.loading ||
      this.olderBusy ||
      this.startReached ||
      this.clearing ||
      !state.candles.length ||
      (volumeAverage &&
        (!state.historyViewReady || !navigator.onLine || !this.volumeAverageDeficit()))
    )
      return;
    if (this.olderTimer !== null) clearTimeout(this.olderTimer);
    this.olderTimer = setTimeout(() => {
      this.olderTimer = null;
      void this.loadOlder(volumeAverage);
    }, 350);
  }
  private async loadOlder(volumeAverage: boolean): Promise<void> {
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
    const missing = volumeAverage ? this.volumeAverageDeficit() : 0;
    if (volumeAverage && (!navigator.onLine || !missing)) return;

    const earliest = historyFirstDate(row, p.timeframe) ?? HISTORY_FALLBACK_FIRST;
    const from = Math.max(
      earliest,
      volumeAverage
        ? historyWindowStart(until, 0, p.timeframe, missing)
        : olderHistoryStart(until, p.timeframe)
    );
    if (from >= until) {
      this.startReached = true;
      return;
    }
    this.olderBusy = true;
    this.bridge.update({ historyHelp: "Подгружаем более ранние свечи…" });
    let addedEarlier = false;
    try {
      const options = { uid: row.uid, ...(this.abort ? { signal: this.abort.signal } : {}) };
      const result = await client.candles(p.symbol, p.timeframe, { from, to: until }, options);
      if (!this.current(id, client, owner) || this.clearing) return;
      this.cursor = from;
      this.startReached = from <= earliest || (!navigator.onLine && !result.candles.length);
      const loaded = this.bridge.getState().candles,
        candles = mergeCandles(result.candles, loaded);
      addedEarlier = candles.length > loaded.length;
      this.bridge.update({
        candles,
        historyHelp: `${candles.length} свечей · история слева · ${result.requests} новых запросов`
      });
    } catch (error) {
      if (!isAbort(error) && this.current(id, client, owner)) this.bridge.notify(errorText(error));
    } finally {
      if (this.current(id, client, owner)) {
        this.olderBusy = false;
        if (addedEarlier) this.scheduleOlder(true);
      }
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
