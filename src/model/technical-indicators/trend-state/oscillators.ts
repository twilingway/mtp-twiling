import type { NumericValue, TechnicalBar } from "../types.js";
import { exponential, mean } from "./filters.js";
import { arrayInput, changes, finite, period, validate } from "./inputs.js";

export function tsi(
  bars: readonly TechnicalBar[],
  longLength = 25,
  shortLength = 13,
  signalLength = 13
) {
  [longLength, shortLength, signalLength].forEach(period);
  validate(bars, ["close"]);
  const delta = changes(bars.map((bar) => bar.close));
  const smooth = (source: readonly NumericValue[]) =>
    exponential(exponential(source, longLength), shortLength);
  const numerator = smooth(delta),
    denominator = smooth(delta.map((v) => (v === null ? null : Math.abs(v))));
  const raw = numerator.map((v, i) =>
    v === null || denominator[i] == null || denominator[i] === 0
      ? null
      : finite(100 * (v / denominator[i]))
  );
  const rawSignal = exponential(raw, signalLength);
  const value = raw.map((v, i) => (delta[i] === null ? null : v));
  return { value, signal: rawSignal.map((v, i) => (value[i] === null ? null : v)) };
}

export interface KstOptions {
  readonly rocLengths?: readonly [number, number, number, number];
  readonly smaLengths?: readonly [number, number, number, number];
  readonly signalLength?: number;
}
export function kstParameters(options: KstOptions = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    arrayInput(options) ||
    Object.keys(options).some((k) => !["rocLengths", "smaLengths", "signalLength"].includes(k))
  )
    throw new RangeError("Invalid KST options");
  const rocLengths =
    options.rocLengths === undefined ? ([10, 15, 20, 30] as const) : options.rocLengths;
  const smaLengths =
    options.smaLengths === undefined ? ([10, 10, 10, 15] as const) : options.smaLengths;
  if (
    !arrayInput(rocLengths) ||
    !arrayInput(smaLengths) ||
    rocLengths.length !== 4 ||
    smaLengths.length !== 4
  )
    throw new RangeError("KST requires four ROC and SMA lengths");
  for (const value of [...rocLengths, ...smaLengths]) period(value);
  const signalLength = options.signalLength === undefined ? 9 : options.signalLength;
  period(signalLength);
  return { rocLengths, smaLengths, signalLength };
}
export function kst(bars: readonly TechnicalBar[], options: KstOptions = {}) {
  const { rocLengths, smaLengths, signalLength } = kstParameters(options);
  validate(bars, ["close"]);
  const rawRocs = rocLengths.map((length) =>
    bars.map((bar, i) => {
      const previous = bars[i - length]?.close;
      if (bar.close === null || previous == null || previous === 0) return null;
      const change = finite(bar.close - previous);
      return change === null ? null : finite(100 * (change / previous));
    })
  );
  const lines = rawRocs.map((line, i) => mean(line, smaLengths[i]!));
  const raw = bars.map((_, i) => {
    if (lines.some((line) => line[i] === null)) return null;
    return finite(lines.reduce((sum, line, j) => sum + (j + 1) * line[i]!, 0));
  });
  const rawSignal = mean(raw, signalLength);
  const value = raw.map((v, i) => (rawRocs.some((line) => line[i] === null) ? null : v));
  return { value, signal: rawSignal.map((v, i) => (value[i] === null ? null : v)) };
}
