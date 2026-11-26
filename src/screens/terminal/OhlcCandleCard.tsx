import { useLayoutEffect, useRef } from "react";
import { precision } from "../../charts/adapter.js";
import { ohlcCandleIndex, placeOhlcCard } from "../../model/ohlc-legend.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { chartBackground } from "../../model/theme.js";
import { OhlcLegend } from "./OhlcLegend.js";
import { useTerminal } from "./context.js";

export function OhlcCandleCard({
  timestamp,
  drawingProjection
}: {
  timestamp: number;
  drawingProjection: EventTarget | undefined;
}) {
  const { state, controller } = useTerminal();
  const node = useRef<HTMLDivElement>(null);
  const index = ohlcCandleIndex(state.candles, timestamp);
  const bar = state.candles[index];
  const row = selectedMarketRow(state.rows, state.preferences);
  const digits = row ? precision(row) : 2;

  useLayoutEffect(() => {
    const card = node.current;
    const body = card?.parentElement;
    const host = body?.parentElement;
    if (!card || !body || !host || !bar) return;
    let frame = 0;
    const position = () => {
      frame = 0;
      const chart = controller.chart;
      const anchor = chart?.pointToPixel({ timestamp, value: bar.close });
      const plot = chart?.plotSize();
      const top = body.getBoundingClientRect().top;
      const hostRect = host.getBoundingClientRect();
      const visibleTop = Math.max(0, hostRect.top - top);
      const visibleBottom = Math.min(plot?.height ?? 0, hostRect.bottom - top);
      if (
        !plot ||
        !anchor ||
        anchor.x < 0 ||
        anchor.x > plot.width ||
        visibleBottom <= visibleTop
      ) {
        card.style.visibility = "hidden";
        return;
      }
      card.style.maxWidth = `${Math.min(plot.width, host.clientWidth)}px`;
      card.style.maxHeight = `${visibleBottom - visibleTop}px`;
      const { width, height } = card.getBoundingClientRect();
      const { x, y } = placeOhlcCard(
        { x: anchor.x, y: Math.max(visibleTop, Math.min(visibleBottom, anchor.y)) },
        { width: Math.min(plot.width, host.clientWidth), height: visibleBottom, top: visibleTop },
        { width, height }
      );
      card.style.transform = `translate(${x}px, ${y}px)`;
      card.style.visibility = "visible";
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(position);
    };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    observer.observe(card);
    drawingProjection?.addEventListener("change", schedule);
    host.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      drawingProjection?.removeEventListener("change", schedule);
      host.removeEventListener("scroll", schedule);
    };
  }, [controller, bar, timestamp, drawingProjection]);

  if (!bar) return null;
  return (
    <div
      ref={node}
      className="ohlc-candle-card"
      style={{ backgroundColor: chartBackground(state.preferences.chartSettings) }}
    >
      <OhlcLegend
        bar={bar}
        previousClose={state.candles[index - 1]?.close}
        digits={digits}
        settings={state.preferences.chartSettings}
      />
    </div>
  );
}
