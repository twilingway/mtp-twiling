import type { NumericSeries, TechnicalBar } from "./types.js";
import { barsInput, finite, period } from "./channel-average/inputs.js";
import { assertMultiplier } from "./volatility-momentum/validation.js";
import { RollingMoments } from "./volatility-momentum/windows.js";

export const bbTrendDefaults = Object.freeze({
  shortLength: 20,
  longLength: 50,
  multiplier: 2
} as const);

export interface BbTrendOptions {
  readonly shortLength?: number;
  readonly longLength?: number;
  readonly multiplier?: number;
}

export function bbTrend(
  bars: readonly TechnicalBar[],
  options: BbTrendOptions = {}
): NumericSeries {
  const {
    shortLength = bbTrendDefaults.shortLength,
    longLength = bbTrendDefaults.longLength,
    multiplier = bbTrendDefaults.multiplier
  } = options;
  period(shortLength);
  period(longLength);
  assertMultiplier(multiplier);
  barsInput(bars);
  const shortWindow = new RollingMoments(shortLength);
  const longWindow = new RollingMoments(longLength);
  return bars.map(({ close }) => {
    if (close === null) {
      shortWindow.reset();
      longWindow.reset();
      return null;
    }
    const short = shortWindow.push(close);
    const long = longWindow.push(close);
    if (short === null || long === null || short.mean === 0) return null;
    const scale = Math.max(short.scale, long.scale);
    const difference = short.mean - long.mean;
    const center = Number.isFinite(difference)
      ? difference / scale
      : short.mean / scale - long.mean / scale;
    const width =
      multiplier *
      (short.normalizedDeviation * (short.scale / scale) -
        long.normalizedDeviation * (long.scale / scale));
    if (center === 0 || width === 0) return 0;
    // |center - width| - |center + width|, without subtracting two nearly equal absolutes.
    const delta =
      -Math.sign(center) * Math.sign(width) * Math.min(Math.abs(center), Math.abs(width));
    return finite((delta / (short.mean / scale)) * 200);
  });
}

export interface BollingerBar {
  readonly high: number;
  readonly bodyTop: number;
  readonly bodyBottom: number;
  readonly low: number;
  readonly direction: "up" | "down" | "flat";
}

export function bollingerBars(bars: readonly TechnicalBar[]): readonly (BollingerBar | null)[] {
  barsInput(bars, "open");
  return bars.map(({ high, low, open, close }) => {
    if (high === null || low === null || open === null || close === null) return null;
    if (open < low || open > high) throw new RangeError("Open outside range");
    return {
      high,
      bodyTop: Math.max(open, close),
      bodyBottom: Math.min(open, close),
      low,
      direction: close > open ? "up" : close < open ? "down" : "flat"
    };
  });
}
