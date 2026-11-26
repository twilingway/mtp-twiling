import { assertLength, ema, finiteOrNull } from "./primitives.js";
import { assertBars, typicalPrice } from "./momentum-volume/validation.js";
import type { NumericValue, TechnicalBar } from "./types.js";

export interface KlingerOptions {
  fastLength?: number;
  slowLength?: number;
  signalLength?: number;
}

/** Stephen Klinger's original volume force, including the retained trend on equal HLC. */
export function klingerOscillator(bars: readonly TechnicalBar[], options: KlingerOptions = {}) {
  const { fastLength = 34, slowLength = 55, signalLength = 13 } = options;
  assertLength(fastLength);
  assertLength(slowLength);
  assertLength(signalLength);
  assertBars(bars, ["high", "low", "close", "volume"]);
  let previousPrice: NumericValue = null;
  let previousRange: NumericValue = null;
  let accumulatedRange: NumericValue = null;
  let previousTrend: -1 | 1 | null = null;

  const force = bars.map((bar): NumericValue => {
    const price =
      bar.high === null || bar.low === null || bar.close === null
        ? null
        : (finiteOrNull((bar.high + bar.low + bar.close) / 3) ?? typicalPrice(bar));
    const range = bar.high === null || bar.low === null ? null : finiteOrNull(bar.high - bar.low);
    const trend =
      price === null || range === null || previousPrice === null || previousRange === null
        ? null
        : price === previousPrice
          ? previousTrend
          : price > previousPrice
            ? 1
            : -1;

    accumulatedRange =
      trend === null || range === null || previousRange === null
        ? null
        : trend === previousTrend && accumulatedRange !== null
          ? finiteOrNull(accumulatedRange + range)
          : finiteOrNull(previousRange + range);
    previousPrice = price;
    previousRange = range;
    previousTrend = trend;

    if (trend === null || range === null || bar.volume === null || accumulatedRange === null)
      return null;
    if (accumulatedRange === 0) return null;
    return finiteOrNull(Math.abs(2 * (range / accumulatedRange) - 1) * trend * bar.volume * 100);
  });

  const fast = ema(force, fastLength);
  const slow = ema(force, slowLength);
  const oscillator = force.map((value, index) => {
    const fastValue = fast[index]!;
    const slowValue = slow[index]!;
    return value === null || fastValue === null || slowValue === null
      ? null
      : finiteOrNull(fastValue - slowValue);
  });
  const signal = ema(oscillator, signalLength).map((value, index) =>
    oscillator[index] === null ? null : value
  );

  return { oscillator, signal };
}

export interface NetVolumePeriod {
  readonly uptickVolume: NumericValue;
  readonly downtickVolume: NumericValue;
}

export interface MarketVolumePeriod {
  readonly advancingVolume: NumericValue;
  readonly decliningVolume: NumericValue;
}

function volumeDifference(up: NumericValue, down: NumericValue): NumericValue {
  if (up !== null && (!Number.isFinite(up) || up < 0))
    throw new RangeError("Up volume must be finite and nonnegative");
  if (down !== null && (!Number.isFinite(down) || down < 0))
    throw new RangeError("Down volume must be finite and nonnegative");
  return up === null || down === null ? null : up - down;
}

export function netVolume(periods: readonly NetVolumePeriod[]): NumericValue[] {
  return periods.map(({ uptickVolume, downtickVolume }) =>
    volumeDifference(uptickVolume, downtickVolume)
  );
}

export function cumulativeVolumeIndex(
  periods: readonly MarketVolumePeriod[],
  initial: NumericValue = 0
): NumericValue[] {
  if (initial !== null && !Number.isFinite(initial))
    throw new RangeError("Initial cumulative volume must be finite");
  let total = initial;
  return periods.map(({ advancingVolume, decliningVolume }) => {
    const difference = volumeDifference(advancingVolume, decliningVolume);
    total = total === null || difference === null ? null : finiteOrNull(total + difference);
    return total;
  });
}
