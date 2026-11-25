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
import { monthPosition, shiftUtcMonths } from "../model/intervals/calendar.js";
import type { DisplayPreferences } from "../i18n/preferences.js";

export interface ChartAdapter {
  source?: { owner: string; viewKey: string; uid: string };
  persistView?: boolean;
  /** Permanently excludes a superseded instance from capture and updates. */
  retired?: boolean;
  setData(data: Candle[], fit: boolean): void;
  updateBar(bar: Candle): void;
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
export function logicalForTime(
  data: Candle[],
  timestamp: number,
  intervalMs: number | null
): number {
  const first = data[0],
    last = data.at(-1);
  if (!first || !last) return 0;
  const distance = (anchor: number) =>
    intervalMs === null
      ? monthPosition(timestamp) - monthPosition(anchor)
      : (timestamp - anchor) / intervalMs;
  if (timestamp < first.timestamp) return distance(first.timestamp);
  if (timestamp > last.timestamp) return data.length - 1 + distance(last.timestamp);
  let lo = 0,
    hi = data.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (data[mid]!.timestamp < timestamp) lo = mid + 1;
    else hi = mid;
  }
  if (!lo) return 0;
  const before = data[lo - 1]!,
    after = data[lo]!;
  return lo - 1 + (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
}
export function timeForLogical(
  data: Candle[],
  index: number,
  intervalMs: number | null
): number | null {
  const first = data[0],
    last = data.at(-1);
  if (!first || !last) return null;
  const i = Math.round(index);
  const offset = (timestamp: number, count: number) =>
    intervalMs === null ? shiftUtcMonths(timestamp, count) : timestamp + count * intervalMs;
  return i < 0
    ? offset(first.timestamp, i)
    : i >= data.length
      ? offset(last.timestamp, i - data.length + 1)
      : data[i]!.timestamp;
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
  return row.step && row.step > 0
    ? Math.min(6, Math.max(2, String(row.step).split(".")[1]?.length ?? 0))
    : row.symbol === "NG"
      ? 3
      : 2;
}
