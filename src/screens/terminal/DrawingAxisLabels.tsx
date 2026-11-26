import { t } from "../../i18n/messages.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawingPoint } from "../../model/types.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";
import { drawingVisibleOnInterval } from "../../model/intervals/drawing-visibility.js";
import { chartDateFormat } from "../../i18n/format.js";
import { drawingRenderList } from "./drawing-settings-preview.js";
import {
  drawingPriceLabelPosition,
  drawingPriceTargets
} from "../../model/drawing-price-labels.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import { precision } from "../../charts/adapter.js";
import { intlLocale } from "../../i18n/preferences.js";
import { chartBackground, chartLabelText, readableChartColor } from "../../model/theme.js";

interface AxisLabel {
  timestamp: number;
  x: number;
  width: number;
}
interface PriceLabel {
  text: string;
  y: number;
  trueY: number;
  width: number;
  color: string;
}

export function DrawingAxisLabels({ drawingProjection }: { drawingProjection: EventTarget }) {
  const { controller, state } = useTerminal();
  const [labels, setLabels] = useState<AxisLabel[]>([]);
  const [prices, setPrices] = useState<PriceLabel[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const { timeframe, chartSettings } = state.preferences;
  const drawingsHidden = drawingToolbarSettings(chartSettings).drawingsHidden;
  const drawings = drawingRenderList(state);
  const visible = useMemo(() => {
    if (drawingsHidden) return [];
    return drawings.filter(
      (item) => item.visible !== false && drawingVisibleOnInterval(item.visibility, timeframe)
    );
  }, [drawings, drawingsHidden, timeframe]);
  const selected = drawingsHidden
    ? undefined
    : (state.preview ?? visible.find((item) => item.id === state.selectedObject));
  const points = selected?.points;
  const row = selectedMarketRow(state.rows, state.preferences);
  const digits = row ? precision(row) : 2;
  const locale = intlLocale(state.preferences.locale);
  const targets = useMemo(() => {
    const format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    return drawingPriceTargets(visible, selected).map((target) => ({
      ...target,
      text: format.format(target.point.value)
    }));
  }, [visible, selected, digits, locale]);
  const background = chartBackground(chartSettings);
  useEffect(() => {
    if (!points?.length && !targets.length) {
      setLabels([]);
      setPrices([]);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const chart = controller.chart;
      const { width, height } = chart?.plotSize() ?? { width: 0, height: 0 };
      const next = chart
        ? (points ?? []).flatMap((point: DrawingPoint) => {
            if (!Number.isFinite(new Date(point.timestamp).getTime())) return [];
            const pixel = chart.pointToPixel(point);
            return pixel && pixel.x >= 0 && pixel.x <= width
              ? [{ timestamp: point.timestamp, x: Math.round(pixel.x), width }]
              : [];
          })
        : [];
      setLabels((previous) =>
        previous.length === next.length &&
        previous.every((label, index) => {
          const value = next[index];
          return (
            value?.timestamp === label.timestamp &&
            value.x === label.x &&
            value.width === label.width
          );
        })
          ? previous
          : next
      );
      const axisWidth = Math.max(0, (root.current?.clientWidth ?? 0) - width);
      const current = controller.getSnapshot().candles.at(-1);
      const currentPixel =
        current && chart?.pointToPixel({ timestamp: current.timestamp, value: current.close });
      const occupied =
        currentPixel && currentPixel.y >= 0 && currentPixel.y <= height
          ? [
              currentPixel.y,
              ...(chartSettings.showCandleCountdown !== false ? [currentPixel.y + 16] : [])
            ]
          : [];
      const seen = new Set<string>();
      const nextPrices: PriceLabel[] = [];
      if (chart && axisWidth > 0)
        for (const { point, color, anchor, text } of targets) {
          const pixel = chart.pointToPixel(point);
          if (
            !pixel ||
            (anchor !== "always" && pixel.x > width) ||
            (anchor === "visible" && pixel.x < 0)
          )
            continue;
          if (seen.has(text)) continue;
          const y = drawingPriceLabelPosition(pixel.y, height, occupied);
          if (y === null) continue;
          seen.add(text);
          occupied.push(y);
          nextPrices.push({
            text,
            y: Math.round(y),
            trueY: Math.round(pixel.y),
            width: axisWidth,
            color
          });
        }
      setPrices((previous) =>
        previous.length === nextPrices.length &&
        previous.every((label, index) => {
          const next = nextPrices[index];
          return (
            next?.text === label.text &&
            next.y === label.y &&
            next.trueY === label.trueY &&
            next.width === label.width &&
            next.color === label.color
          );
        })
          ? previous
          : nextPrices
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    drawingProjection.addEventListener("change", schedule);
    schedule();
    return () => {
      drawingProjection.removeEventListener("change", schedule);
      cancelAnimationFrame(frame);
    };
  }, [controller, drawingProjection, points, targets, chartSettings.showCandleCountdown]);
  const format = chartDateFormat(state.preferences.timeframe, state.preferences);
  return (
    <div ref={root} className="drawing-axis-labels" aria-label={t("Даты точек рисунка")}>
      {labels.map((label, index) => (
        <time
          className="drawing-axis-label"
          key={index}
          dateTime={new Date(label.timestamp).toISOString()}
          style={{ left: label.x, maxWidth: label.width }}
        >
          {format.format(label.timestamp)}
        </time>
      ))}
      <div aria-label={t("Цены объектов на шкале")}>
        {prices.map(({ text, y, trueY, width, color }) => {
          const fill = readableChartColor(color, background, 3);
          return (
            <span key={text}>
              <span
                className="drawing-price-tick"
                aria-hidden="true"
                style={{ top: trueY, right: width, background: fill }}
              />
              <span
                className="drawing-price-label"
                title={text}
                style={{ top: y, width, background: fill, color: chartLabelText(fill) }}
              >
                {text}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
