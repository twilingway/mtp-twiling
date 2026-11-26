import { ema, finiteOrNull, sma } from "../primitives.js";
import type { NumericSeries, NumericValue, TechnicalBar } from "../types.js";
import { accumulationDistribution } from "../momentum-volume/volume.js";
import { assertBars, relativeChange } from "../momentum-volume/validation.js";
import { averageType, boundedInteger, type VolumeAverage } from "./parameters.js";

/** Same-length mean ratio equals sum ratio; each mean independently ignores na. */
export function cmf(bars: readonly TechnicalBar[], length = 20): NumericValue[] {
  boundedInteger(length, 2000);
  assertBars(bars, ["high", "low", "close", "volume"]);
  const flow = bars.map((bar): NumericValue => {
    // The public script checks a zero range before multiplying by volume.
    if (bar.high !== null && bar.low !== null && bar.high === bar.low) return 0;
    if (bar.high === null || bar.low === null || bar.close === null || bar.volume === null)
      return null;
    const scale = Math.max(Math.abs(bar.high), Math.abs(bar.low), Math.abs(bar.close));
    const range = bar.high - bar.low;
    const upper = bar.close - bar.low,
      lower = bar.high - bar.close;
    const numerator =
      (Number.isFinite(upper) ? upper / scale : bar.close / scale - bar.low / scale) -
      (Number.isFinite(lower) ? lower / scale : bar.high / scale - bar.close / scale);
    const denominator = Number.isFinite(range) ? range / scale : bar.high / scale - bar.low / scale;
    return finiteOrNull((numerator / denominator) * bar.volume);
  });
  const meanFlow = sma(flow, length),
    meanVolume = sma(
      bars.map((bar) => bar.volume),
      length
    );
  return meanFlow.map((value, index) => {
    const volume = meanVolume[index]!;
    return value === null || volume === null || volume === 0 ? null : finiteOrNull(value / volume);
  });
}

export function chaikinOscillator(
  bars: readonly TechnicalBar[],
  fastLength = 3,
  slowLength = 10
): NumericValue[] {
  boundedInteger(fastLength, 2000);
  boundedInteger(slowLength, 2000);
  const adl = accumulationDistribution(bars),
    fast = ema(adl, fastLength),
    slow = ema(adl, slowLength);
  let overflow = false;
  return adl.map((value, index) => {
    const bar = bars[index]!;
    if (
      value === null &&
      bar.high !== null &&
      bar.low !== null &&
      bar.close !== null &&
      bar.volume !== null
    )
      overflow = true;
    const a = fast[index]!,
      b = slow[index]!;
    return overflow || a === null || b === null ? null : finiteOrNull(a - b);
  });
}

export function elderForceIndex(bars: readonly TechnicalBar[], length = 13): NumericValue[] {
  boundedInteger(length, 2000);
  assertBars(bars, ["close", "volume"]);
  return ema(
    bars.map((bar, index) => {
      const previous = bars[index - 1]?.close;
      return bar.close === null || previous == null || bar.volume === null
        ? null
        : finiteOrNull((bar.close - previous) * bar.volume);
    }),
    length
  );
}

export function easeOfMovement(
  bars: readonly TechnicalBar[],
  length = 14,
  divisor = 10000
): NumericValue[] {
  boundedInteger(length, 2000);
  boundedInteger(divisor, 1000000000);
  assertBars(bars, ["high", "low", "volume"]);
  const midpoints = bars.map((bar) =>
    bar.high === null || bar.low === null ? null : bar.high / 2 + bar.low / 2
  );
  return sma(
    bars.map((bar, index) => {
      const current = midpoints[index]!,
        previous = midpoints[index - 1];
      if (
        current === null ||
        previous == null ||
        bar.high === null ||
        bar.low === null ||
        bar.volume === null ||
        bar.volume === 0
      )
        return null;
      return finiteOrNull((divisor * (current - previous) * (bar.high - bar.low)) / bar.volume);
    }),
    length
  );
}

export interface VolumeOscillatorOptions {
  readonly fastLength?: number;
  readonly slowLength?: number;
  readonly signalLength?: number;
  readonly oscillatorAverage?: VolumeAverage;
  readonly signalAverage?: VolumeAverage;
}

/** Current STD;Volume%1Oscillator is PVO, including its signal and histogram. */
export function volumeOscillator(
  bars: readonly TechnicalBar[],
  options: VolumeOscillatorOptions = {}
) {
  const fastLength = boundedInteger(options.fastLength ?? 12, 10000),
    slowLength = boundedInteger(options.slowLength ?? 26, 10000),
    signalLength = boundedInteger(options.signalLength ?? 9, 10000),
    oscillatorAverage = averageType(options.oscillatorAverage ?? "EMA"),
    signalAverage = averageType(options.signalAverage ?? "EMA");
  assertBars(bars, ["volume"]);
  const average = (source: NumericSeries, length: number, type: VolumeAverage) =>
    type === "EMA" ? ema(source, length) : sma(source, length);
  const volume = bars.map((bar) => bar.volume),
    fast = average(volume, fastLength, oscillatorAverage),
    slow = average(volume, slowLength, oscillatorAverage);
  const oscillator = fast.map((value, index) => {
    const base = slow[index]!;
    return value === null || base === null || base === 0
      ? null
      : finiteOrNull(((value - base) / base) * 100);
  });
  const signal = average(oscillator, signalLength, signalAverage);
  const histogram = oscillator.map((value, index) => {
    const base = signal[index]!;
    return value === null || base === null ? null : finiteOrNull(value - base);
  });
  return { oscillator, signal, histogram };
}

function volumeIndex(bars: readonly TechnicalBar[], emaLength: number, positive: boolean) {
  boundedInteger(emaLength, 10000);
  assertBars(bars, ["close", "volume"]);
  let previousIndex = 1,
    overflow = false;
  const index = bars.map((bar, position): NumericValue => {
    if (overflow) return null;
    // Pine reference resets a zero previous index to 1 before evaluating the current bar.
    if (previousIndex === 0) previousIndex = 1;
    const previous = bars[position - 1];
    const previousVolume = previous?.volume ?? 0;
    const active =
      bar.volume !== null && (positive ? bar.volume > previousVolume : bar.volume < previousVolume);
    if (
      bar.close !== null &&
      bar.close !== 0 &&
      previous?.close != null &&
      previous.close !== 0 &&
      active
    ) {
      const change = relativeChange(bar.close, previous.close);
      const next = change === null ? null : finiteOrNull(previousIndex + change * previousIndex);
      if (next === null) overflow = true;
      else previousIndex = next;
    }
    const displayed = overflow ? null : finiteOrNull(previousIndex * 1000);
    if (displayed === null) overflow = true;
    return displayed;
  });
  // Do not let the EMA's na-hold turn a poisoned cumulative value into a known output.
  const average = ema(index, emaLength).map((value, position) =>
    index[position] === null ? null : value
  );
  return { index, average };
}

export function negativeVolumeIndex(bars: readonly TechnicalBar[], emaLength = 255) {
  return volumeIndex(bars, emaLength, false);
}

export function positiveVolumeIndex(bars: readonly TechnicalBar[], emaLength = 255) {
  return volumeIndex(bars, emaLength, true);
}
