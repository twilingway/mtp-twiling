import type { IPriceLine } from "lightweight-charts";
import { lastPriceLabelColors, lastPriceStyle } from "../model/last-price-style.js";
import type {
  Candle,
  ChartSettings,
  DrawingPoint,
  PixelPoint,
  PriceAxisLabelColors
} from "../model/types.js";
import { matchingCountdown } from "./last-price-label.js";
import type { CandleCountdownLabel } from "./last-price-label.js";
import type { DrawingAxisLabels } from "./drawing-axis-labels.js";
import type { ChartPriceFormat } from "./price-format.js";
import type { LightweightMainSeries } from "./lightweight-main-series.js";
import { lightweightLastPriceLabel } from "./lightweight-last-price-label.js";

export function lightweightAxisLabels(
  series: LightweightMainSeries,
  settings: ChartSettings,
  getData: () => readonly Candle[],
  format: () => ChartPriceFormat,
  project: (point: DrawingPoint) => PixelPoint | null,
  projectTime: (timestamp: number) => number | null,
  size: () => { width: number; height: number }
) {
  let line: IPriceLine | null = null;
  let colors = lastPriceLabelColors(settings);
  let countdown: CandleCountdownLabel | null = null;
  let drawings: DrawingAxisLabels | null = null;
  const fontSize = settings.scaleFontSize ?? 11;
  const primitive = lightweightLastPriceLabel(
    () => {
      const bar = getData().at(-1);
      const timer = matchingCountdown(countdown, bar);
      const y = bar ? series.priceToCoordinate(bar.close) : null;
      return bar && timer && y !== null
        ? {
            y,
            price: bar.close.toFixed(format().precision),
            countdown: timer,
            ...lastPriceStyle(settings, bar.close >= bar.open, colors),
            fontSize
          }
        : null;
    },
    () => {
      const bar = getData().at(-1);
      const y = bar ? series.priceToCoordinate(bar.close) : null;
      const dimensions = size();
      return {
        labels: drawings,
        project,
        projectTime,
        plotWidth: dimensions.width,
        plotHeight: dimensions.height,
        occupied:
          y === null || !Number.isFinite(y) || y < 0 || y > dimensions.height
            ? []
            : [y, ...(matchingCountdown(countdown, bar) ? [y + fontSize + 6] : [])],
        fontSize
      };
    }
  );
  const refresh = () => {
    const bar = getData().at(-1);
    if (!bar) {
      if (line) series.removePriceLine(line);
      line = null;
      return;
    }
    const { color, fill, text } = lastPriceStyle(settings, bar.close >= bar.open, colors);
    const label = {
      price: bar.close,
      color,
      axisLabelColor: fill,
      axisLabelTextColor: text,
      axisLabelVisible: matchingCountdown(countdown, bar) === null,
      lineVisible: settings.priceLine !== false,
      lineWidth: 1 as const,
      lineStyle: 2,
      title: ""
    };
    if (line) line.applyOptions(label);
    else line = series.createPriceLine(label);
  };
  return {
    primitive: primitive.primitive,
    refresh,
    setCountdown(next: CandleCountdownLabel | null) {
      if (next?.timestamp === countdown?.timestamp && next?.text === countdown?.text) return;
      const bar = getData().at(-1);
      const wasComposite = matchingCountdown(countdown, bar) !== null;
      countdown = next;
      if (wasComposite !== (matchingCountdown(countdown, bar) !== null)) refresh();
      primitive.update();
    },
    setColors(next: PriceAxisLabelColors | null) {
      if (next?.fill === colors?.fill && next?.text === colors?.text) return;
      colors = next;
      refresh();
    },
    setDrawings(next: DrawingAxisLabels | null) {
      if (drawings === next) return;
      drawings = next;
      primitive.update();
    }
  };
}
