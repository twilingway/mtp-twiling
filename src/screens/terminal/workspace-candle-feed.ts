import { mergeCandles, TIMEFRAMES, updateCandleList } from "../../model/history-codec.js";
import { historyRequestWindow } from "../../model/intervals/calendar.js";
import type { Candle, HistoryRange, Timeframe } from "../../model/types.js";
import type { MarketClient } from "../../services/market-client.js";

type CandleSource = Pick<MarketClient, "loadCandles" | "watchCandles">;
type FeedOutcome = "ready" | "empty" | "error";
interface CandleFeedOptions {
  uid: string;
  symbol: string;
  timeframe: Timeframe;
  range: HistoryRange;
  initial: Candle[];
  active: () => boolean;
  replace: (candles: Candle[], final: boolean) => void;
  update: (bar: Candle, candles: Candle[]) => void;
  settle: (outcome: FeedOutcome, hasData: boolean) => void;
}

const dayMs = 86_400_000;

export function workspaceHistoryRange(
  now: number,
  timeframe: Timeframe,
  rangeDays: number
): HistoryRange {
  const ms = TIMEFRAMES[timeframe].ms;
  // A small panel needs a bounded window, with room for a weekend on intraday markets.
  const lookback = Math.min(
    rangeDays * dayMs,
    ms === null ? Infinity : Math.max(4 * dayMs, 400 * ms)
  );
  return historyRequestWindow({ from: Math.max(0, now - lookback), to: now }, timeframe);
}

export function startWorkspaceCandleFeed(
  source: CandleSource,
  options: CandleFeedOptions
): () => void {
  const abort = new AbortController();
  const { uid, symbol, timeframe, range } = options;
  const active = () => !abort.signal.aborted && options.active();
  const live = new Map<number, Candle>();
  let history = options.initial;
  let snapshot = [...history];
  let loading = true;
  let unsubscribe: (() => void) | undefined;
  const replace = (next: Candle[], final: boolean, cached: boolean) => {
    if (!loading || !active()) return;
    history = cached ? mergeCandles(next, history) : mergeCandles(history, next);
    snapshot = mergeCandles(history, [...live.values()]);
    options.replace(snapshot, final);
  };
  void (async () => {
    try {
      // Start the stream first so a partial candle arriving during history loading wins.
      unsubscribe = source.watchCandles(
        uid,
        timeframe,
        (event) => {
          if (!active() || event.uid !== uid || event.interval !== TIMEFRAMES[timeframe].stream)
            return;
          if (loading) live.set(event.bar.timestamp, event.bar);
          snapshot = updateCandleList(snapshot, event.bar);
          options.update(event.bar, snapshot);
        },
        abort.signal
      );
      const result = await source.loadCandles(symbol, timeframe, range, {
        uid,
        signal: abort.signal,
        onProgress: ({ candles, cached, completed }) =>
          replace(candles, false, cached && completed === 0)
      });
      if (!active()) return;
      replace(result.candles, true, result.cached && result.requests === 0);
      options.settle(history.length ? "ready" : "empty", snapshot.length > 0);
    } catch {
      if (active()) options.settle("error", snapshot.length > 0);
    } finally {
      loading = false;
      history = [];
      live.clear();
    }
  })();
  return () => {
    abort.abort();
    unsubscribe?.();
  };
}
