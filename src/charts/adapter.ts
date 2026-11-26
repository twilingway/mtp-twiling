import type {
  Candle,
  ChartSettings,
  ChartView,
  DrawingPoint,
  IndicatorFlags,
  IndicatorPaneLayout,
  MarketRow,
  PixelPoint,
  Timeframe
} from "../model/types.js";
export { logicalForTime, timeForLogical } from "../model/intervals/projected-time.js";
import type { DisplayPreferences } from "../i18n/preferences.js";
import { chartPriceFormat } from "./price-format.js";
import type { PriceMetadata } from "./price-format.js";
import type { TechnicalIndicatorInstance } from "../model/technical-indicators/types.js";
import type {
  TechnicalPaneLayout,
  TechnicalPaneCaptureContext,
  TechnicalPanePreference
} from "../model/technical-indicator-layout.js";

export interface TechnicalPaneMetric {
  /** price, legacy:volume or the key returned by technicalPaneKey. */
  key: string;
  top: number;
  height: number;
  width: number;
}

export interface ChartAdapter {
  source?: { owner: string; viewKey: string; uid: string };
  persistView?: boolean;
  /** Permanently excludes a superseded instance from capture and updates. */
  retired?: boolean;
  setData(data: Candle[], fit: boolean): void;
  updateBar(bar: Candle): void;
  updatePriceFormat?(metadata: PriceMetadata): void;
  updateTechnicalIndicators?(
    instances: readonly TechnicalIndicatorInstance[],
    layout?: readonly TechnicalPanePreference[]
  ): void;
  technicalPaneMetrics?(): readonly TechnicalPaneMetric[];
  /** Global X-axis location can differ from the price-pane bottom. */
  timeAxisTop?(): number;
  getView(): ChartView | null;
  setView(view: ChartView): void;
  fit(): void;
  zoom?(direction: -1 | 1): void;
  /** Fractional repeat follows beginPan; a missing fraction keeps the one-shot Y freeze. */
  scroll?(direction: -1 | 1, fraction?: number): void;
  resetView?(): void;
  beginViewInteraction?(changed?: boolean, held?: boolean): void;
  endViewInteraction?(held?: boolean): void;
  beginPan?(start?: PixelPoint): void;
  endPan?(): void;
  focusPoints?(points: readonly DrawingPoint[]): void;
  redrawDrawings(): void;
  pointToPixel(point: DrawingPoint): PixelPoint | null;
  pixelToPoint(x: number, y: number): DrawingPoint | null;
  plotSize(): { width: number; height: number };
  destroy(): void;
}
export interface ChartOptions extends DisplayPreferences {
  technicalIndicators?: readonly TechnicalIndicatorInstance[];
  technicalPaneLayout?: readonly TechnicalPanePreference[];
  onTechnicalPaneLayout?:
    ((layout: TechnicalPaneLayout, capture: TechnicalPaneCaptureContext) => void) | undefined;
  onTechnicalPaneMetrics?: ((metrics: readonly TechnicalPaneMetric[]) => void) | undefined;
  onCameraIntent?: (() => void) | undefined;
  onCameraChange?: ((view: ChartView) => void) | undefined;
  onCameraIdle?: ((reason: "unchanged" | "cancelled" | "unavailable") => void) | undefined;
  indicatorPaneLayout?: IndicatorPaneLayout | undefined;
  onIndicatorLayout?: ((layout: IndicatorPaneLayout) => void) | undefined;
  container: HTMLDivElement;
  row: MarketRow;
  timeframe: Timeframe;
  rangeDays: number;
  indicators: IndicatorFlags;
  settings: ChartSettings;
  paint: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    project: (point: DrawingPoint) => PixelPoint | null,
    layer: "back" | "front"
  ) => void;
  onNearStart: () => void;
  onCrosshair: (bar: Candle | null) => void;
}
export function movingAverage(
  data: Candle[],
  period: number,
  exponential = false
): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  let sum = 0,
    ema: number | undefined;
  data.forEach((bar, i) => {
    sum += bar.close;
    if (i >= period) sum -= data[i - period]!.close;
    if (i >= period - 1) {
      ema =
        exponential && ema != null
          ? (bar.close * 2) / (period + 1) + ema * (1 - 2 / (period + 1))
          : sum / period;
      result.push({ time: Math.floor(bar.timestamp / 1000), value: ema });
    }
  });
  return result;
}
export function precision(row: MarketRow): number {
  return chartPriceFormat(row).precision;
}
