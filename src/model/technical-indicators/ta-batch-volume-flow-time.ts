import { assertLength, finiteOrNull } from "./primitives.js";
import type { NumericValue } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface TimedVolume {
  readonly timestamp: number;
  readonly volume: NumericValue;
}

export interface TurnoverBar extends TimedVolume {
  readonly price?: NumericValue;
  /** Target currency units per quote currency unit. */
  readonly currencyRate?: NumericValue;
}

export interface TurnoverOptions {
  readonly volumeUnit: "base" | "quote";
  /** Earliest timestamp since which the caller knows all lower bars are represented. */
  readonly coverageStart: number;
  readonly convertCurrency?: boolean;
}

function nonnegative(value: NumericValue, name: string): NumericValue {
  if (value !== null && (!Number.isFinite(value) || value < 0))
    throw new RangeError(`${name} must be finite and nonnegative`);
  return value;
}

export function volume24Hours(
  bars: readonly TurnoverBar[],
  options: TurnoverOptions
): NumericValue[] {
  const { volumeUnit, coverageStart, convertCurrency = false } = options;
  if (!Number.isSafeInteger(coverageStart)) throw new RangeError("Invalid window coverage start");
  if (volumeUnit !== "base" && volumeUnit !== "quote") throw new RangeError("Invalid volume unit");

  let lastTime = -Infinity;
  const turnover = bars.map((bar) => {
    if (
      !Number.isSafeInteger(bar.timestamp) ||
      bar.timestamp < coverageStart ||
      bar.timestamp <= lastTime
    )
      throw new RangeError("Turnover bars must ascend within coverage");
    lastTime = bar.timestamp;
    const volume = nonnegative(bar.volume, "Volume");
    if (volume === 0) return 0;
    const price = volumeUnit === "base" ? nonnegative(bar.price ?? null, "Price") : 1;
    const rate = convertCurrency ? nonnegative(bar.currencyRate ?? null, "Currency rate") : 1;
    return volume === null || price === null || rate === null || rate === 0
      ? null
      : finiteOrNull(volume * price * rate);
  });

  let first = 0;
  let total = 0;
  let correction = 0;
  let missing = 0;
  const add = (value: number) => {
    const next = total + value;
    if (Number.isFinite(next)) {
      correction +=
        Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    }
    total = next;
  };
  return turnover.map((value, index) => {
    const cutoff = bars[index]!.timestamp - DAY_MS;
    const hadOverflow = !Number.isFinite(total);
    const previousFirst = first;
    while (first < index && bars[first]!.timestamp <= cutoff) {
      const expired = turnover[first++]!;
      if (expired === null) missing--;
      else add(-expired);
    }
    if (hadOverflow && first !== previousFirst) {
      total = 0;
      correction = 0;
      for (let position = first; position < index; position++) add(turnover[position] ?? 0);
    }
    if (first === index) {
      total = 0;
      correction = 0;
    }
    if (value === null) missing++;
    else add(value);
    return cutoff < coverageStart || missing > 0
      ? null
      : finiteOrNull(Math.max(0, total + correction));
  });
}

export interface RelativeVolumePeriod {
  readonly anchorTimestamp: number;
  /** True when all bars in the supplied span from the anchor are represented. */
  readonly hasAnchorCoverage: boolean;
  readonly bars: readonly TimedVolume[];
}

export interface RelativeVolumeOptions {
  readonly length?: number;
  readonly mode?: "regular" | "cumulative";
}

interface OffsetVolume {
  readonly offset: number;
  readonly volume: NumericValue;
}

export function relativeVolumeAtTime(
  periods: readonly RelativeVolumePeriod[],
  options: RelativeVolumeOptions = {}
): NumericValue[] {
  const { length = 10, mode = "cumulative" } = options;
  assertLength(length);
  if (mode !== "regular" && mode !== "cumulative") throw new RangeError("Unknown volume mode");

  const history: OffsetVolume[][] = [];
  let lastTime = -Infinity;
  const ratios: NumericValue[] = [];
  for (const period of periods) {
    if (!Number.isSafeInteger(period.anchorTimestamp) || period.anchorTimestamp <= lastTime)
      throw new RangeError("Volume anchor periods must ascend");
    lastTime = period.anchorTimestamp;
    const currentPeriod: OffsetVolume[] = [];
    const cursors = history.map(() => -1);
    let cumulative: NumericValue = 0;
    for (const bar of period.bars) {
      if (
        !Number.isSafeInteger(bar.timestamp) ||
        bar.timestamp < lastTime ||
        (bar.timestamp === lastTime && currentPeriod.length > 0)
      )
        throw new RangeError("Volume bars must ascend within their anchor period");
      lastTime = bar.timestamp;
      const offset = bar.timestamp - period.anchorTimestamp;
      let volume = nonnegative(bar.volume, "Volume");
      if (mode === "cumulative") {
        cumulative =
          cumulative === null || volume === null ? null : finiteOrNull(cumulative + volume);
        volume = cumulative;
      }
      if (!period.hasAnchorCoverage) volume = null;
      currentPeriod.push({ offset, volume });

      let mean = 0;
      let complete = history.length === length;
      for (const [index, previous] of history.entries()) {
        let position = cursors[index]!;
        while (position + 1 < previous.length && previous[position + 1]!.offset <= offset)
          position++;
        cursors[index] = position;
        const sampledVolume = previous[position]?.volume ?? null;
        if (sampledVolume === null) complete = false;
        else mean += (sampledVolume - mean) / (index + 1);
      }
      ratios.push(!complete || volume === null || mean === 0 ? null : finiteOrNull(volume / mean));
    }
    history.push(currentPeriod);
    if (history.length > length) history.shift();
  }
  return ratios;
}
