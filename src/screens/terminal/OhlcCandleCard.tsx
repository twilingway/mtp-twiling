import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { precision } from "../../charts/adapter.js";
import { t } from "../../i18n/messages.js";
import { currentDisplayPreferences } from "../../i18n/preferences.js";
import {
  createOhlcLegend,
  formatOhlcValue,
  ohlcCandleIndex,
  placeOhlcCard
} from "../../model/ohlc-legend.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { chartPalette } from "../../model/theme.js";
import { useTerminal } from "./context.js";

const priceFields = [
  ["open", "Открытие"],
  ["high", "Максимум"],
  ["low", "Минимум"],
  ["close", "Закрытие"]
] as const;
const volumeNumber = {
  ru: new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 16 }),
  en: new Intl.NumberFormat("en-US", { maximumSignificantDigits: 16 })
};

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
  const anchorPrice = [bar?.close, bar?.open, bar?.high, bar?.low].find(
    (value): value is number => value !== undefined && Number.isFinite(value)
  );

  useLayoutEffect(() => {
    const card = node.current;
    const body = card?.parentElement;
    const host = body?.parentElement;
    if (!card || !body || !host || anchorPrice === undefined) return;
    let frame = 0;
    const position = () => {
      frame = 0;
      const chart = controller.chart;
      const anchor = chart?.pointToPixel({ timestamp, value: anchorPrice });
      const plot = chart?.plotSize();
      const hostTop = host.getBoundingClientRect().top + host.clientTop;
      const scrollOffset = hostTop - body.getBoundingClientRect().top;
      const visibleTop = Math.max(0, scrollOffset);
      const panelBottom = Math.min(body.clientHeight, scrollOffset + host.clientHeight);
      const priceBottom = Math.min(plot?.height ?? 0, panelBottom);
      const availableWidth = host.clientWidth;
      const priceWidth = Math.min(plot?.width ?? 0, availableWidth);
      if (
        !anchor ||
        !Number.isFinite(anchor.x) ||
        !Number.isFinite(anchor.y) ||
        anchor.x < 0 ||
        anchor.x > priceWidth ||
        priceWidth <= 0 ||
        priceBottom <= visibleTop
      ) {
        card.style.visibility = "hidden";
        return;
      }
      card.style.maxWidth = `${availableWidth}px`;
      card.style.maxHeight = `${panelBottom - visibleTop}px`;
      card.toggleAttribute("data-compact", availableWidth < 165 || panelBottom - visibleTop < 118);
      const { width, height } = card.getBoundingClientRect();
      const { x, y } = placeOhlcCard(
        { x: anchor.x, y: Math.max(visibleTop, Math.min(priceBottom, anchor.y)) },
        {
          width: Math.max(priceWidth, width),
          height: Math.max(priceBottom, visibleTop + height),
          top: visibleTop
        },
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
  }, [controller, anchorPrice, timestamp, drawingProjection]);

  if (!bar) return null;
  const settings = state.preferences.chartSettings;
  const { background, text, muted, border } = chartPalette(settings);
  const legend = createOhlcLegend(bar, state.candles[index - 1]?.close, settings);
  const locale = currentDisplayPreferences().locale;
  const volume =
    Number.isFinite(bar.volume) && bar.volume >= 0
      ? volumeNumber[locale].format(bar.volume === 0 ? 0 : bar.volume)
      : "—";
  const style: CSSProperties & Record<`--ohlc-card-${string}`, string> = {
    backgroundColor: background,
    color: text,
    borderColor: border,
    "--ohlc-card-muted": muted,
    "--ohlc-card-change": legend.change === null ? muted : legend.color
  };
  return (
    <div
      ref={node}
      className="ohlc-candle-card"
      role="group"
      aria-label={t("Выбранная свеча")}
      style={style}
    >
      <dl className="ohlc-card-fields">
        {priceFields.map(([key, label]) => (
          <div key={key}>
            <dt>{t(label)}</dt>
            <dd>{formatOhlcValue(legend.values[key], digits)}</dd>
          </div>
        ))}
        <div className="ohlc-card-change">
          <dt>{t("Изменение:").replace(/:$/, "")}</dt>
          <dd>
            <span>{formatOhlcValue(legend.change, digits, true)}</span>
            {legend.change !== null && (
              <span>
                ({legend.percent === null ? "—" : `${formatOhlcValue(legend.percent, 2, true)}%`})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("Объём")}</dt>
          <dd>{volume}</dd>
        </div>
      </dl>
    </div>
  );
}
