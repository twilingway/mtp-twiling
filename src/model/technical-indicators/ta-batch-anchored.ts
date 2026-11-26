import { assertTechnicalBars, priceSource } from "./data.js";
import { assertLength, finiteOrNull } from "./primitives.js";
import type { NumericValue, PriceSource, TechnicalBar } from "./types.js";

type Price = Exclude<PriceSource, "volume">;

/** UTC milliseconds of known first candles, in ascending order. Null means no schedule. */
export type AnchorStarts = readonly number[] | null;

interface AverageSeries {
  /** Same indices as the input candles. */
  readonly values: readonly NumericValue[];
}

export type AnchoredAverageResult = AverageSeries &
  (
    | { readonly status: "computed"; readonly anchorTimestamp: number }
    | {
        readonly status: "unavailable";
        readonly reason:
          "anchor-unavailable" | "volume-unavailable" | "source-unavailable" | "calculation-limit";
      }
  );

export interface VwapBandOptions {
  readonly mode: "percent" | "standard-deviation";
  readonly multipliers: readonly number[];
}

interface VwapOptions {
  readonly source?: Price;
  readonly bands?: VwapBandOptions;
}

export type VwapResult = AnchoredAverageResult & {
  readonly bands: readonly {
    readonly multiplier: number;
    readonly upper: readonly NumericValue[];
    readonly lower: readonly NumericValue[];
  }[];
};

export type AutoVwapAnchor =
  | { readonly mode: "period"; readonly starts: AnchorStarts }
  | { readonly mode: "highest-high" | "lowest-low" | "highest-volume"; readonly length: number };

export function automaticVwapPeriod(chartIntervalDays: number) {
  if (!Number.isFinite(chartIntervalDays) || chartIntervalDays <= 0)
    throw new RangeError("Invalid chart interval");
  if (chartIntervalDays < 1) return "session";
  if (chartIntervalDays === 1) return "month";
  if (chartIntervalDays <= 10) return "quarter";
  if (chartIntervalDays <= 60) return "year";
  return "decade";
}

function locateAnchors(bars: readonly TechnicalBar[], starts: AnchorStarts): number[] {
  const indices: number[] = [];
  let barIndex = 0;
  let previous = -1;
  for (const start of starts ?? []) {
    if (!Number.isFinite(start) || start <= previous || start < 0)
      throw new RangeError("Anchor starts must be finite and strictly increasing");
    previous = start;
    if (start < (bars[0]?.timestamp ?? Infinity)) continue;
    while (barIndex < bars.length && bars[barIndex]!.timestamp < start) barIndex++;
    if (barIndex === bars.length) continue;
    if (bars[barIndex]!.timestamp !== start)
      throw new RangeError("Anchor start must identify a loaded candle");
    indices.push(barIndex);
  }
  return indices;
}

function extremeAnchor(
  bars: readonly TechnicalBar[],
  anchor: Exclude<AutoVwapAnchor, { mode: "period" }>
): number[] {
  assertLength(anchor.length);
  const field =
    anchor.mode === "highest-high" ? "high" : anchor.mode === "lowest-low" ? "low" : "volume";
  let selected = -1;
  let extreme = anchor.mode === "lowest-low" ? Infinity : -Infinity;
  for (let index = Math.max(0, bars.length - anchor.length); index < bars.length; index++) {
    const value = bars[index]![field];
    if (value === null) continue;
    if (anchor.mode === "lowest-low" ? value <= extreme : value >= extreme) {
      selected = index;
      extreme = value;
    }
  }
  return selected === -1 ? [] : [selected];
}

function vwapFromAnchors(
  bars: readonly TechnicalBar[],
  anchors: readonly number[],
  options: VwapOptions
): VwapResult {
  const settings = options.bands;
  if (settings && settings.multipliers.length > 3)
    throw new RangeError("VWAP supports up to three bands");
  const bands = (settings?.multipliers ?? []).map((multiplier) => {
    if (!Number.isFinite(multiplier) || multiplier < 0)
      throw new RangeError("Invalid VWAP band multiplier");
    return {
      multiplier,
      upper: Array<NumericValue>(bars.length).fill(null),
      lower: Array<NumericValue>(bars.length).fill(null)
    };
  });
  const values = Array<NumericValue>(bars.length).fill(null);
  if (anchors.length === 0)
    return { status: "unavailable", reason: "anchor-unavailable", values, bands };

  const prices = priceSource(bars, options.source ?? "hlc3");
  let nextAnchor = 0;
  let weight = 0;
  let average = 0;
  let variance: NumericValue = 0;
  let positiveVolume = false;
  let pairedObservation = false;
  let hasValue = false;
  for (let index = anchors[0]!; index < bars.length; index++) {
    if (index === anchors[nextAnchor]) {
      weight = 0;
      average = 0;
      variance = 0;
      nextAnchor++;
    }
    const { volume } = bars[index]!;
    const price = prices[index]!;
    if (volume === null) continue;
    if (volume > 0) positiveVolume = true;
    if (price === null || volume + weight === 0) continue;
    if (volume > 0) {
      pairedObservation = true;
      const total = weight + volume;
      if (!Number.isFinite(total)) {
        weight = total;
        continue;
      }
      const oldFraction = weight / total;
      const newFraction = volume / total;
      if (settings?.mode === "standard-deviation" && variance !== null) {
        const scale = Math.sqrt(oldFraction * newFraction);
        const scaledDifference = price * scale - average * scale;
        variance = finiteOrNull(oldFraction * variance + scaledDifference ** 2);
      }
      average = oldFraction * average + newFraction * price;
      weight = total;
    }
    if (!Number.isFinite(weight) || !Number.isFinite(average)) continue;
    values[index] = average;
    hasValue = true;
    const distance =
      settings?.mode === "percent"
        ? Math.abs(average) / 100
        : variance === null
          ? null
          : Math.sqrt(variance);
    if (distance === null) continue;
    for (const band of bands) {
      const offset = distance * band.multiplier;
      band.upper[index] = finiteOrNull(average + offset);
      band.lower[index] = finiteOrNull(average - offset);
    }
  }
  if (!hasValue) {
    const reason = !positiveVolume
      ? "volume-unavailable"
      : !pairedObservation
        ? "source-unavailable"
        : "calculation-limit";
    return { status: "unavailable", reason, values, bands };
  }
  return { status: "computed", anchorTimestamp: bars[anchors.at(-1)!]!.timestamp, values, bands };
}

export function vwap(
  bars: readonly TechnicalBar[],
  starts: AnchorStarts,
  options: VwapOptions = {}
): VwapResult {
  assertTechnicalBars(bars);
  return vwapFromAnchors(bars, locateAnchors(bars, starts), options);
}

export function autoAnchoredVwap(
  bars: readonly TechnicalBar[],
  anchor: AutoVwapAnchor,
  options: VwapOptions = {}
): VwapResult {
  assertTechnicalBars(bars);
  const anchors =
    anchor.mode === "period"
      ? locateAnchors(bars, anchor.starts).slice(-1)
      : extremeAnchor(bars, anchor);
  return vwapFromAnchors(bars, anchors, options);
}

function nextAverage(average: number, value: number, count: number): number {
  return (1 - 1 / count) * average + value / count;
}

/** Each loaded candle represents one observation of the same nominal interval. */
export function twap(
  bars: readonly TechnicalBar[],
  starts: AnchorStarts,
  source: Price = "ohlc4"
): AnchoredAverageResult {
  assertTechnicalBars(bars);
  const anchors = locateAnchors(bars, starts);
  const values = Array<NumericValue>(bars.length).fill(null);
  if (anchors.length === 0) return { status: "unavailable", reason: "anchor-unavailable", values };

  const prices = priceSource(bars, source);
  let nextAnchor = 0;
  let observations = 0;
  let average = 0;
  let hasValue = false;
  for (let index = anchors[0]!; index < bars.length; index++) {
    if (index === anchors[nextAnchor]) {
      observations = 0;
      average = 0;
      nextAnchor++;
    }
    const price = prices[index]!;
    if (price === null) continue;
    average = nextAverage(average, price, ++observations);
    values[index] = finiteOrNull(average);
    if (values[index] !== null) hasValue = true;
  }
  if (!hasValue) return { status: "unavailable", reason: "source-unavailable", values };
  return { status: "computed", anchorTimestamp: bars[anchors.at(-1)!]!.timestamp, values };
}

export interface VisibleAverageRange {
  readonly from: number;
  readonly to: number;
}

export type VisibleAverageResult =
  | {
      readonly status: "computed";
      readonly value: number;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "viewport-unavailable" | "source-unavailable";
    };

export function visibleAveragePrice(
  bars: readonly TechnicalBar[],
  range: VisibleAverageRange | null,
  source: Price = "close"
): VisibleAverageResult {
  assertTechnicalBars(bars);
  if (range === null) return { status: "unavailable", reason: "viewport-unavailable" };
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > range.to)
    throw new RangeError("Invalid visible range");

  const visible = bars.filter((bar) => range.from <= bar.timestamp && bar.timestamp <= range.to);
  if (visible.length === 0) return { status: "unavailable", reason: "viewport-unavailable" };
  let average = 0;
  let observations = 0;
  for (const price of priceSource(visible, source))
    if (price !== null) average = nextAverage(average, price, ++observations);
  if (observations === 0 || !Number.isFinite(average))
    return { status: "unavailable", reason: "source-unavailable" };
  return {
    status: "computed",
    value: average,
    from: visible[0]!.timestamp,
    to: visible.at(-1)!.timestamp
  };
}
