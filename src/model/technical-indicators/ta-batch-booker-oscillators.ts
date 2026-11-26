import { macd, rsi, stochastic } from "./calculations.js";
import { assertTechnicalBars, priceSource } from "./data.js";
import { cci } from "./momentum-volume/oscillators.js";
import { typicalPrice } from "./momentum-volume/validation.js";
import { assertLength } from "./primitives.js";
import type { NumericSeries, NumericValue, PriceSource, TechnicalBar } from "./types.js";

export type WoodiesTrend = "neutral" | "pending" | "rising" | "falling";

function woodiesCciSeries(source: NumericSeries, length: number): NumericValue[] {
  const values = cci(source, length);
  let observed = 0;
  return source.map((value, index) => {
    if (value === null) return null;
    observed++;
    return observed < length ? null : (values[index] ?? 0);
  });
}

export function woodiesCci(bars: readonly TechnicalBar[], slowLength = 14, fastLength = 6) {
  assertTechnicalBars(bars);
  const typical = bars.map(typicalPrice);
  const slow = woodiesCciSeries(typical, slowLength);
  const fast = woodiesCciSeries(typical, fastLength);
  let previousSign = 0;
  let count = 0;
  const trend = slow.map((value): WoodiesTrend | null => {
    const sign = Math.sign(value ?? 0);
    count = sign === 0 ? 0 : sign === previousSign ? count + 1 : 1;
    previousSign = sign;
    if (value === null) return null;
    if (count < 5) return "neutral";
    if (count === 5) return "pending";
    return sign > 0 ? "rising" : "falling";
  });
  return { slow, fast, histogram: slow, trend };
}

export interface RsiDivergenceOptions {
  readonly length: number;
  readonly source: PriceSource;
  readonly left: number;
  readonly right: number;
  readonly minimumDistance: number;
  readonly maximumDistance: number;
}

interface DivergencePoint {
  readonly timestamp: number;
  readonly price: number;
  readonly oscillator: number;
}

export interface RsiDivergenceEvent {
  readonly kind: "regular-bullish" | "regular-bearish" | "hidden-bullish" | "hidden-bearish";
  readonly previous: DivergencePoint;
  readonly current: DivergencePoint;
  readonly confirmedAt: number;
}

function turningPoint(
  values: NumericSeries,
  index: number,
  left: number,
  right: number
): "low" | "high" | null {
  const value = values[index];
  if (value == null) return null;
  let low = true;
  let high = true;
  for (let otherIndex = index - left; otherIndex <= index + right; otherIndex++) {
    if (otherIndex === index) continue;
    const other = values[otherIndex];
    if (other == null) return null;
    low &&= value < other;
    high &&= value > other;
    if (!low && !high) return null;
  }
  return low ? "low" : "high";
}

function divergenceKind(
  side: "low" | "high",
  previous: DivergencePoint,
  current: DivergencePoint
): RsiDivergenceEvent["kind"] | null {
  if (side === "low") {
    if (current.price < previous.price && current.oscillator > previous.oscillator)
      return "regular-bullish";
    if (current.price > previous.price && current.oscillator < previous.oscillator)
      return "hidden-bullish";
  } else {
    if (current.price > previous.price && current.oscillator < previous.oscillator)
      return "regular-bearish";
    if (current.price < previous.price && current.oscillator > previous.oscillator)
      return "hidden-bearish";
  }
  return null;
}

export function rsiDivergence(bars: readonly TechnicalBar[], options: RsiDivergenceOptions) {
  assertTechnicalBars(bars);
  const { left, right, minimumDistance, maximumDistance } = options;
  for (const length of [left, right, minimumDistance, maximumDistance]) assertLength(length);
  if (minimumDistance > maximumDistance) throw new RangeError("Invalid divergence distance");
  const source = priceSource(bars, options.source);
  const oscillator = rsi(source, options.length).map((value, index) =>
    source[index] === null ? null : value
  );
  const previous: Partial<Record<"low" | "high", { index: number; point: DivergencePoint }>> = {};
  const events: RsiDivergenceEvent[] = [];
  for (let index = left; index + right < bars.length; index++) {
    const bar = bars[index]!;
    const value = oscillator[index]!;
    if (value === null || bar.low === null) delete previous.low;
    if (value === null || bar.high === null) delete previous.high;
    const side = turningPoint(oscillator, index, left, right);
    if (side === null || value === null || bar[side] === null) continue;
    const point = { timestamp: bar.timestamp, price: bar[side], oscillator: value };
    const before = previous[side];
    previous[side] = { index, point };
    if (!before || index - before.index < minimumDistance || index - before.index > maximumDistance)
      continue;
    const kind = divergenceKind(side, before.point, point);
    if (kind !== null)
      events.push({
        kind,
        previous: before.point,
        current: point,
        confirmedAt: bars[index + right]!.timestamp
      });
  }
  return { oscillator, events };
}

export interface BookerOscillatorThresholds {
  readonly overbought: number;
  readonly oversold: number;
}

function assertThresholds({ overbought, oversold }: BookerOscillatorThresholds): void {
  if (
    !Number.isFinite(overbought) ||
    !Number.isFinite(oversold) ||
    oversold < 0 ||
    oversold >= overbought ||
    overbought > 100
  )
    throw new RangeError("Invalid oscillator thresholds");
}

export interface BookerReversalOptions extends BookerOscillatorThresholds {
  readonly fastLength: number;
  readonly slowLength: number;
  readonly kLength: number;
  readonly slowing: number;
}

export interface BookerReversalEvent {
  readonly timestamp: number;
  readonly direction: "bullish" | "bearish";
  readonly price: number;
}

export function bookerReversal(bars: readonly TechnicalBar[], options: BookerReversalOptions) {
  assertTechnicalBars(bars);
  assertThresholds(options);
  const { fastLength, slowLength, kLength, slowing, oversold, overbought } = options;
  const line = macd(priceSource(bars, "close"), fastLength, slowLength).macd;
  const { raw, k } = stochastic(bars, kLength, slowing, 1);
  const events: BookerReversalEvent[] = [];
  let lastMissingCandle = -1;
  let lastUnavailableK = -1;
  for (let index = 0; index < bars.length; index++) {
    const { timestamp, close, high, low } = bars[index]!;
    const before = line[index - 1];
    const current = line[index];
    const value = k[index];
    if (close === null || high === null || low === null) lastMissingCandle = index;
    if (raw[index] === null) lastUnavailableK = index;
    if (
      before == null ||
      current == null ||
      value == null ||
      high === null ||
      low === null ||
      bars[index - 1]?.close == null ||
      index - lastMissingCandle < kLength + slowing - 1 ||
      index - lastUnavailableK < slowing
    )
      continue;
    if (before <= 0 && current > 0 && value < oversold)
      events.push({ timestamp, direction: "bullish", price: low });
    if (before >= 0 && current < 0 && value > overbought)
      events.push({ timestamp, direction: "bearish", price: high });
  }
  return events;
}

export interface KnoxvillePoint {
  readonly price: number;
  readonly momentum: number;
  readonly rsi: number;
}

export function knoxvilleCondition(
  previous: KnoxvillePoint,
  current: KnoxvillePoint,
  thresholds: BookerOscillatorThresholds
): "bullish" | "bearish" | null {
  assertThresholds(thresholds);
  for (const { price, momentum, rsi } of [previous, current])
    if (!Number.isFinite(price) || !Number.isFinite(momentum) || !(rsi >= 0 && rsi <= 100))
      throw new RangeError("Invalid Knoxville divergence point");
  if (
    current.price > previous.price &&
    current.momentum < previous.momentum &&
    current.rsi > thresholds.overbought
  )
    return "bearish";
  if (
    current.price < previous.price &&
    current.momentum > previous.momentum &&
    current.rsi < thresholds.oversold
  )
    return "bullish";
  return null;
}
