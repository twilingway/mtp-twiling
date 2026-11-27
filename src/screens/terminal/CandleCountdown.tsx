import { t } from "../../i18n/messages.js";
import { useEffect, useLayoutEffect, useState } from "react";
import { candleCloseAt, formatCountdown } from "../../model/candle-clock.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TradingCalendarDay } from "../../model/candle-clock.js";
import { useTerminal } from "./context.js";

export function CandleCountdown({ drawingProjection }: { drawingProjection: EventTarget }) {
  const { controller, state } = useTerminal();
  const [now, setNow] = useState(Date.now());
  const [retry, setRetry] = useState(0);
  const [calendar, setCalendar] = useState<{
    key: string;
    days: readonly TradingCalendarDay[];
  } | null>(null);
  const { timeframe, chartSettings } = state.preferences;
  const uid = selectedMarketRow(state.rows, state.preferences)?.uid;
  const bar = state.candles.at(-1);
  const timestamp = bar?.timestamp;
  const enabled = chartSettings.showCandleCountdown !== false;
  const active =
    enabled &&
    state.authenticated &&
    state.status === "connected" &&
    !selectedMarketRow(state.rows, state.preferences)?.providerRef;
  const day = Math.floor(now / 86400000);
  const key = `${state.owner}:${uid ?? ""}:${timeframe}:${timestamp ?? ""}:${day}`;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(controller.marketNow()), 1000);
    setNow(controller.marketNow());
    return () => clearInterval(id);
  }, [controller, active]);
  useEffect(() => {
    if (!active || !uid || timestamp === undefined) return;
    const abort = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const requestedAt = controller.marketNow();
    void controller
      .loadCandleCalendar(uid, timestamp, timeframe, requestedAt, abort.signal)
      .then((days) => {
        if (!abort.signal.aborted) {
          setCalendar({ key, days });
          retryTimer = setTimeout(
            () => setRetry((value) => value + 1),
            days.length ? 300000 : 60000
          );
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setCalendar(null);
          retryTimer = setTimeout(() => setRetry((value) => value + 1), 60000);
        }
      });
    return () => {
      abort.abort();
      clearTimeout(retryTimer);
    };
  }, [controller, active, uid, timestamp, timeframe, key, retry]);
  const closesAt =
    active && timestamp !== undefined && calendar?.key === key
      ? candleCloseAt(timestamp, timeframe, now, calendar.days)
      : null;
  const countdown = closesAt ? formatCountdown(closesAt - now).replace("д", t("д")) : null;
  useLayoutEffect(() => {
    let attached: typeof controller.chart = null;
    const update = () => {
      const chart = controller.chart;
      if (!chart || chart.retired || attached === chart) return;
      attached = chart;
      chart.setCandleCountdown?.(
        timestamp !== undefined && countdown ? { timestamp, text: countdown } : null
      );
    };
    drawingProjection.addEventListener("change", update);
    update();
    return () => drawingProjection.removeEventListener("change", update);
  }, [controller, drawingProjection, timestamp, countdown, state.chartRevision]);
  useEffect(() => () => controller.chart?.setCandleCountdown?.(null), [controller]);
  if (!closesAt || !countdown) return null;
  return (
    <time
      className="candle-countdown"
      role="timer"
      aria-live="off"
      aria-label={t("До закрытия свечи: ") + countdown}
      dateTime={new Date(closesAt).toISOString()}
    >
      {countdown}
    </time>
  );
}
