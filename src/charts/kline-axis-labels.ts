import type { Chart } from "klinecharts";
import type {
  Candle,
  ChartSettings,
  DrawingPoint,
  PixelPoint,
  PriceAxisLabelColors
} from "../model/types.js";
import type { ChartPriceFormat } from "./price-format.js";
import type { CandleCountdownLabel } from "./last-price-label.js";
import { matchingCountdown } from "./last-price-label.js";
import type { DrawingAxisLabels } from "./drawing-axis-labels.js";
import { klineLastPriceLabel } from "./kline-last-price-label.js";
import { klineDrawingAxisLabels } from "./kline-drawing-axis-labels.js";
import type { klineLastPrice } from "./kline-last-price.js";

export function klineAxisLabels(
  chart: Chart,
  lastPrice: ReturnType<typeof klineLastPrice>,
  settings: ChartSettings,
  getData: () => readonly Candle[],
  format: () => ChartPriceFormat,
  project: (point: DrawingPoint) => PixelPoint | null,
  projectTime: (timestamp: number) => number | null,
  size: () => { width: number; height: number },
  paintFront: () => void
) {
  let countdown: CandleCountdownLabel | null = null;
  let drawings: DrawingAxisLabels | null = null;
  const fontSize = settings.scaleFontSize ?? 11;
  const composite = klineLastPriceLabel(chart);
  const drawingAxis = klineDrawingAxisLabels(chart, () => {
    const dimensions = size();
    const bar = getData().at(-1);
    const y = bar ? project({ timestamp: bar.timestamp, value: bar.close })?.y : undefined;
    return {
      labels: drawings,
      project,
      projectTime,
      plotWidth: dimensions.width,
      plotHeight: dimensions.height,
      occupied:
        y === undefined || !Number.isFinite(y) || y < 0 || y > dimensions.height
          ? []
          : [y, ...(matchingCountdown(countdown, bar) ? [y + fontSize + 6] : [])],
      fontSize
    };
  });
  const refresh = () => {
    const bar = getData().at(-1);
    const timer = matchingCountdown(countdown, bar);
    lastPrice.update(chart, bar);
    const style = lastPrice.direction(bar);
    const enabled = composite.update(
      bar && timer
        ? {
            timestamp: bar.timestamp,
            value: bar.close,
            price: bar.close.toFixed(format().precision),
            countdown: timer,
            fill: style.fill,
            text: style.text,
            lineColor: style.color,
            lineVisible: settings.priceLine !== false,
            fontSize
          }
        : null
    );
    if (lastPrice.setComposite(chart, enabled)) paintFront();
  };
  return {
    refresh,
    setCountdown(next: CandleCountdownLabel | null) {
      if (next?.timestamp === countdown?.timestamp && next?.text === countdown?.text) return;
      countdown = next;
      refresh();
    },
    setColors(colors: PriceAxisLabelColors | null) {
      if (!lastPrice.configure(chart, colors, getData().at(-1))) return;
      refresh();
      paintFront();
    },
    setDrawings(next: DrawingAxisLabels | null) {
      if (drawings === next) return;
      drawings = next;
      drawingAxis.update();
    },
    dispose() {
      composite.dispose();
      drawingAxis.dispose();
    }
  };
}
