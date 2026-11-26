import type { NumericSeries, NumericValue, PriceSource, TechnicalBar } from "./types.js";
import type { ChannelResult } from "./channel-average/channels.js";
import { average, trueRange } from "./channel-average/filters.js";
import {
  addScaled,
  barsInput,
  bounded,
  convex,
  directBudget,
  period,
  prices
} from "./channel-average/inputs.js";

export const envelopeDefaults = Object.freeze({
  length: 20,
  percent: 10,
  source: "close",
  useExponentialMa: false
} as const);

export interface EnvelopeOptions {
  readonly length?: number;
  readonly percent?: number;
  readonly source?: PriceSource;
  readonly useExponentialMa?: boolean;
}

export function envelope(
  bars: readonly TechnicalBar[],
  options: EnvelopeOptions = {}
): ChannelResult {
  const {
    length = envelopeDefaults.length,
    percent = envelopeDefaults.percent,
    source = envelopeDefaults.source,
    useExponentialMa = envelopeDefaults.useExponentialMa
  } = options;
  period(length);
  bounded(percent, 0, 1000000);
  if (typeof useExponentialMa !== "boolean") throw new RangeError("Invalid Envelope average type");
  barsInput(bars, source, false);
  const basis = average(prices(bars, source), length, useExponentialMa ? "EMA" : "SMA");
  const fraction = percent / 100;
  return {
    basis,
    upper: basis.map((value) => (value === null ? null : addScaled(value, value, fraction))),
    lower: basis.map((value) => (value === null ? null : addScaled(value, value, -fraction)))
  };
}

export const medianChannelDefaults = Object.freeze({
  length: 3,
  source: "hl2",
  atrLength: 14,
  multiplier: 2
} as const);

export interface MedianChannelOptions {
  readonly length?: number;
  readonly source?: PriceSource;
  readonly atrLength?: number;
  readonly multiplier?: number;
}

export interface MedianChannelResult extends ChannelResult {
  readonly average: NumericSeries;
}

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rollingMedian(source: NumericSeries, length: number): NumericValue[] {
  let sorted: number[] = [];
  let segmentStart = 0;
  const upper = Math.floor(length / 2);
  const lower = Math.floor((length - 1) / 2);
  return source.map((value, index) => {
    if (value === null) {
      sorted.length = 0;
      segmentStart = index + 1;
      return null;
    }
    if (index - segmentStart + 1 < length) return null;
    if (sorted.length === 0) {
      sorted = source
        .slice(segmentStart, index + 1)
        .map((price) => price!)
        .sort((a, b) => a - b);
    } else {
      sorted.splice(lowerBound(sorted, source[index - length]!), 1);
      sorted.splice(lowerBound(sorted, value), 0, value);
    }
    return convex(sorted[lower]!, sorted[upper]!, 0.5);
  });
}

export function medianChannel(
  bars: readonly TechnicalBar[],
  options: MedianChannelOptions = {}
): MedianChannelResult {
  const {
    length = medianChannelDefaults.length,
    source = medianChannelDefaults.source,
    atrLength = medianChannelDefaults.atrLength,
    multiplier = medianChannelDefaults.multiplier
  } = options;
  period(length);
  period(atrLength);
  bounded(multiplier, 0, 1000000);
  barsInput(bars, source);
  directBudget(bars.length, length);
  const basis = rollingMedian(prices(bars, source), length);
  const atr = average(trueRange(bars), atrLength, "RMA");
  const band = (value: NumericValue, i: number, factor: number) => {
    const range = atr[i]!;
    return value === null || range === null ? null : addScaled(value, range, factor);
  };
  return {
    basis,
    average: average(basis, length, "EMA"),
    upper: basis.map((value, i) => band(value, i, multiplier)),
    lower: basis.map((value, i) => band(value, i, -multiplier))
  };
}
