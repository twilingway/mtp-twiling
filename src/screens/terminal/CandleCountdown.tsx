import { useEffect, useState } from "react";
import { candleCloseAt, formatCountdown } from "../../model/candle-clock.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TradingCalendarDay } from "../../model/candle-clock.js";
import { useTerminal } from "./context.js";

interface CountdownPosition {
  key: string;
  top: number;
  width: number;
}

function textColor(background: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return "#fff";
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(background.slice(index, index + 2), 16)
  );
  const brightness = (channels[0]! * 299 + channels[1]! * 587 + channels[2]! * 114) / 1000;
  return brightness > 140 ? "#131722" : "#fff";
}

export function CandleCountdown() {
  const { controller, state } = useTerminal();
  const [now, setNow] = useState(Date.now());
  const [retry, setRetry] = useState(0);
  const [calendar, setCalendar] = useState<{
    key: string;
    days: readonly TradingCalendarDay[];
  } | null>(null);
  const [position, setPosition] = useState<CountdownPosition | null>(null);
  const { timeframe, chartSettings } = state.preferences;
  const uid = selectedMarketRow(state.rows, state.preferences)?.uid;
  const bar = state.candles.at(-1);
  const timestamp = bar?.timestamp;
  const enabled = chartSettings.showCandleCountdown !== false;
  const active = enabled && state.authenticated && state.status === "connected";
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
  useEffect(() => {
    if (!active || !bar) return;
    let frame = 0;
    let previous = 0;
    const update = (time: number) => {
      if (time - previous > 50) {
        const chart = controller.chart;
        const pixel = chart?.pointToPixel({ timestamp: bar.timestamp, value: bar.close });
        const size = chart?.plotSize();
        const totalWidth = document.getElementById("chart")?.clientWidth ?? 0;
        const next =
          pixel && size && pixel.y >= 0 && pixel.y + 25 < size.height
            ? { key, top: Math.round(pixel.y + 8), width: Math.max(0, totalWidth - size.width) }
            : null;
        setPosition((old) =>
          old?.key === next?.key && old?.top === next?.top && old?.width === next?.width
            ? old
            : next
        );
        previous = time;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [controller, active, bar, key]);
  const closesAt =
    active && timestamp !== undefined && calendar?.key === key
      ? candleCloseAt(timestamp, timeframe, now, calendar.days)
      : null;
  if (!closesAt || !position || position.key !== key || position.width < 38 || !bar) return null;
  const color =
    bar.close >= bar.open
      ? (chartSettings.upColor ?? "#53b987")
      : (chartSettings.downColor ?? "#eb4d5c");
  return (
    <time
      className="candle-countdown"
      role="timer"
      aria-live="off"
      aria-label={`До закрытия свечи: ${formatCountdown(closesAt - now)}`}
      dateTime={new Date(closesAt).toISOString()}
      style={{
        top: position.top,
        width: position.width,
        background: color,
        color: textColor(color)
      }}
    >
      {formatCountdown(closesAt - now)}
    </time>
  );
}
