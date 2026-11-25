import type { Candle, DrawingPoint, IndicatorFlags, PixelPoint } from "./types.js";
import { activeMtpPeriods } from "./mtp.js";
import type { MagnetMode } from "./drawing-toolbar.js";

const series = new WeakMap<readonly Candle[], { sums: Float64Array; ema: Float64Array }>();
function averages(data: readonly Candle[]) {
  let result = series.get(data);
  if (!result) {
    const sums = new Float64Array(data.length + 1),
      ema = new Float64Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const close = data[i]!.close;
      sums[i + 1] = sums[i]! + close;
      ema[i] =
        i < 49 ? NaN : i === 49 ? sums[i + 1]! / 50 : close * (2 / 51) + ema[i - 1]! * (49 / 51);
    }
    result = { sums, ema };
    series.set(data, result);
  }
  return result;
}
export function snapDrawingPoint(
  raw: DrawingPoint,
  pixel: PixelPoint,
  data: readonly Candle[],
  project: (point: DrawingPoint) => PixelPoint | null,
  mode: MagnetMode,
  indicators?: IndicatorFlags,
  threshold = 10
): DrawingPoint {
  if (mode === "off" || !data.length) return raw;
  let lo = 0,
    hi = data.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (data[mid]!.timestamp < raw.timestamp) lo = mid + 1;
    else hi = mid;
  }
  const index =
    lo > 0 &&
    Math.abs(data[lo - 1]!.timestamp - raw.timestamp) <
      Math.abs(data[lo]!.timestamp - raw.timestamp)
      ? lo - 1
      : lo;
  const bar = data[index]!;
  const values = [bar.open, bar.high, bar.low, bar.close];
  if (indicators) {
    const { sums, ema } = averages(data);
    const periods = activeMtpPeriods(indicators);
    if (indicators.ma) periods.push(20);
    for (const period of periods)
      if (index + 1 >= period) values.push((sums[index + 1]! - sums[index + 1 - period]!) / period);
    if (indicators.ema && index >= 49) values.push(ema[index]!);
  }
  let closest: DrawingPoint | undefined,
    distance = Infinity;
  for (const value of values) {
    const point = { timestamp: bar.timestamp, value },
      mapped = project(point);
    if (!mapped || !Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) continue;
    const next = Math.hypot(mapped.x - pixel.x, mapped.y - pixel.y);
    if (next < distance) {
      closest = point;
      distance = next;
    }
  }
  return closest && (mode === "strong" || distance <= threshold) ? closest : raw;
}
