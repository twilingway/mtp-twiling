import { smma } from "./averages/composed.js";
import { extrema } from "./channel-average/filters.js";
import { assertTechnicalBars, priceSource } from "./data.js";
import { assertLength } from "./primitives.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "./types.js";

export interface ShiftedIndicatorLine {
  /** Calculated in original candle order. The offset only affects drawing. */
  readonly values: NumericSeries;
  readonly barOffset: number;
}

export interface IchimokuParameters {
  readonly conversionLength: number;
  readonly baseLength: number;
  readonly spanBLength: number;
  /** Count including the calculation candle. A displacement of 1 leaves the line in place. */
  readonly displacement: number;
}

export const ICHIMOKU_DEFAULTS: IchimokuParameters = {
  conversionLength: 9,
  baseLength: 26,
  spanBLength: 52,
  displacement: 26
};

function midpointWindows(
  highs: NumericSeries,
  lows: NumericSeries,
  length: number
): NumericValue[] {
  assertLength(length);
  const maximum = extrema(highs, length, true);
  const minimum = extrema(lows, length, false);
  let known = 0;
  return maximum.map((high, index) => {
    known = highs[index] === null ? 0 : known + 1;
    return known < length ? null : high! / 2 + minimum[index]! / 2;
  });
}

export function ichimokuCloud(
  bars: readonly TechnicalBar[],
  options: Partial<IchimokuParameters> = {}
): Readonly<Record<"conversion" | "base" | "spanA" | "spanB" | "lagging", ShiftedIndicatorLine>> {
  assertTechnicalBars(bars);
  const settings = { ...ICHIMOKU_DEFAULTS, ...options };
  assertLength(settings.displacement);
  const high = bars.map((bar) => (bar.low === null ? null : bar.high));
  const low = bars.map((bar) => (bar.high === null ? null : bar.low));
  const conversion = midpointWindows(high, low, settings.conversionLength);
  const base = midpointWindows(high, low, settings.baseLength);
  const spanB = midpointWindows(high, low, settings.spanBLength);
  const shift = settings.displacement - 1;

  return {
    conversion: { values: conversion, barOffset: 0 },
    base: { values: base, barOffset: 0 },
    spanA: {
      values: conversion.map((value, index) => {
        const baseValue = base[index]!;
        return value === null || baseValue === null ? null : value / 2 + baseValue / 2;
      }),
      barOffset: shift
    },
    spanB: { values: spanB, barOffset: shift },
    lagging: { values: priceSource(bars, "close"), barOffset: shift === 0 ? 0 : -shift }
  };
}

export interface AlligatorParameters {
  readonly jawLength: number;
  readonly teethLength: number;
  readonly lipsLength: number;
  readonly jawOffset: number;
  readonly teethOffset: number;
  readonly lipsOffset: number;
}

export const ALLIGATOR_DEFAULTS: AlligatorParameters = {
  jawLength: 13,
  teethLength: 8,
  lipsLength: 5,
  jawOffset: 8,
  teethOffset: 5,
  lipsOffset: 3
};

function alligatorLine(
  median: NumericSeries,
  length: number,
  offset: number
): ShiftedIndicatorLine {
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 10000)
    throw new RangeError("Invalid Alligator offset");
  return { values: smma(median, length), barOffset: offset };
}

export function williamsAlligator(
  bars: readonly TechnicalBar[],
  options: Partial<AlligatorParameters> = {}
): Readonly<Record<"jaw" | "teeth" | "lips", ShiftedIndicatorLine>> {
  assertTechnicalBars(bars);
  const settings = { ...ALLIGATOR_DEFAULTS, ...options };
  const median = priceSource(bars, "hl2");
  return {
    jaw: alligatorLine(median, settings.jawLength, settings.jawOffset),
    teeth: alligatorLine(median, settings.teethLength, settings.teethOffset),
    lips: alligatorLine(median, settings.lipsLength, settings.lipsOffset)
  };
}
