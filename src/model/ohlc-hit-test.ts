import { ohlcCandleIndex } from "./ohlc-legend.js";
import type { Candle, ChartEngine, ChartSettings, DrawingPoint, PixelPoint } from "./types.js";

type Project = (point: DrawingPoint) => PixelPoint | null;

export function ohlcHitTimestamp(
  candles: readonly Candle[],
  pointer: PixelPoint,
  sample: DrawingPoint,
  project: Project,
  settings: ChartSettings,
  engine: ChartEngine,
  touch: boolean
): number | null {
  const index = ohlcCandleIndex(candles, sample.timestamp);
  const bar = candles[index];
  if (!bar || !Number.isFinite(sample.value)) return null;
  const { timestamp, open, high, low, close } = bar;
  const center = project({ timestamp, value: close });
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  const dx = pointer.x - center.x;
  const radius = touch ? 3 : 1.25;
  const type = settings.chartType ?? "candles";

  if (type === "line" || type === "area") {
    const adjacent = candles[index + (dx < 0 ? -1 : 1)];
    const next = adjacent && project({ timestamp: adjacent.timestamp, value: adjacent.close });
    const delta = next ? next.x - center.x : 0;
    const fraction = delta ? dx / delta : -1;
    if (next && fraction >= 0 && fraction <= 1) {
      const lineY = center.y + (next.y - center.y) * fraction;
      return Math.abs(pointer.y - lineY) <= radius ? timestamp : null;
    }
    return Math.abs(dx) <= radius && Math.abs(pointer.y - center.y) <= radius ? timestamp : null;
  }

  const nearPriceRange = (a: number, b: number, margin: number) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    if (sample.value >= min && sample.value <= max) return true;
    const nearest = sample.value < min ? min : max;
    const edge = nearest === close ? center : project({ timestamp, value: nearest });
    return !!edge && Math.abs(pointer.y - edge.y) <= margin;
  };
  const neighbor = () => {
    const adjacent = candles[index + 1] ?? candles[index - 1];
    return adjacent && project({ timestamp: adjacent.timestamp, value: close });
  };
  const markHalfWidth = (proportion: number) => {
    const adjacent = neighbor();
    return adjacent ? Math.max(0.5, Math.abs(adjacent.x - center.x) * proportion) : 0.5;
  };

  if (type === "bars") {
    if (Math.abs(dx) <= radius && nearPriceRange(low, high, radius)) return timestamp;
    const tick = dx < 0 ? open : close;
    const proportion = engine === "kline" ? 0.44 : 0.45;
    return nearPriceRange(tick, tick, radius) && Math.abs(dx) <= markHalfWidth(proportion) + radius
      ? timestamp
      : null;
  }

  const body = settings.bodyVisible !== false || settings.borderVisible !== false;
  if (settings.wickVisible !== false && Math.abs(dx) <= radius) {
    const top = Math.max(open, close);
    const bottom = Math.min(open, close);
    const wickHit = body
      ? nearPriceRange(low, high, radius)
      : (high > top && nearPriceRange(high, top, radius)) ||
        (low < bottom && nearPriceRange(low, bottom, radius));
    if (wickHit) return timestamp;
  }
  if (!body || !nearPriceRange(open, close, radius)) return null;
  const proportion = engine === "kline" ? 0.44 : 0.4;
  const horizontalMargin = touch ? 2 : 0.75;
  return Math.abs(dx) <= markHalfWidth(proportion) + horizontalMargin ? timestamp : null;
}
