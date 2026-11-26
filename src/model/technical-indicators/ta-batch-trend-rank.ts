import { vwma, wma } from "./averages/windows.js";
import { directBudget, period, seriesInput } from "./channel-average/inputs.js";
import { ema, finiteOrNull, populationDeviation, rma, sma } from "./primitives.js";
import type { NumericSeries, NumericValue } from "./types.js";

export type RankCorrelationSmoothing =
  | { kind: "none" }
  | { kind: "sma" | "ema" | "rma" | "wma"; length: number }
  | { kind: "sma-bollinger"; length: number; multiplier: number }
  | { kind: "vwma"; length: number; volume: NumericSeries };

function rankSeries(source: NumericSeries, length: number): NumericValue[] {
  period(length, 2);
  directBudget(source.length, length);
  const middle = (length - 1) / 2;
  const timeSquares = (length * (length ** 2 - 1)) / 12;
  let lastMissing = -1;
  return source.map((value, index) => {
    if (value === null) lastMissing = index;
    if (index - lastMissing < length) return null;

    const start = index - length + 1;
    const sorted = source.slice(start, index + 1).map((price, position) => ({
      price: price!,
      position
    }));
    sorted.sort((a, b) => a.price - b.price);
    let rankSquares = 0;
    let cross = 0;
    for (let first = 0; first < length;) {
      let end = first + 1;
      while (end < length && sorted[end]!.price === sorted[first]!.price) end++;
      const centeredRank = (first + end - 1) / 2 - middle;
      rankSquares += (end - first) * centeredRank ** 2;
      for (let position = first; position < end; position++) {
        cross += (sorted[position]!.position - middle) * centeredRank;
      }
      first = end;
    }
    if (rankSquares === 0) return null;
    return Math.max(-100, Math.min(100, (100 * cross) / Math.sqrt(timeSquares * rankSquares)));
  });
}

export function rankCorrelationIndex(
  source: NumericSeries,
  length = 10,
  smoothing: RankCorrelationSmoothing = { kind: "none" }
) {
  seriesInput(source);
  const rci = rankSeries(source, length);
  const empty = (): NumericValue[] => rci.map(() => null);
  let average = empty();
  let upper = empty();
  let lower = empty();
  const maskGaps = (values: NumericValue[]) =>
    values.map((value, i) => (rci[i] === null ? null : value));

  switch (smoothing.kind) {
    case "none":
      break;
    case "sma":
      average = maskGaps(sma(rci, smoothing.length));
      break;
    case "ema":
      average = maskGaps(ema(rci, smoothing.length));
      break;
    case "rma":
      average = maskGaps(rma(rci, smoothing.length));
      break;
    case "wma":
      average = wma(rci, smoothing.length);
      break;
    case "vwma":
      average = vwma(rci, smoothing.volume, smoothing.length);
      break;
    case "sma-bollinger": {
      if (!Number.isFinite(smoothing.multiplier) || smoothing.multiplier < 0)
        throw new RangeError("RCI Bollinger multiplier must be finite and nonnegative");
      average = maskGaps(sma(rci, smoothing.length));
      const deviations = populationDeviation(rci, smoothing.length);
      upper = average.map((value, i) => {
        const deviation = deviations[i]!;
        return value === null || deviation === null
          ? null
          : finiteOrNull(value + deviation * smoothing.multiplier);
      });
      lower = average.map((value, i) => {
        const deviation = deviations[i]!;
        return value === null || deviation === null
          ? null
          : finiteOrNull(value - deviation * smoothing.multiplier);
      });
      break;
    }
  }

  return { rci, average, upper, lower };
}

export function rankCorrelationRibbon(source: NumericSeries, short = 9, middle = 26, long = 52) {
  seriesInput(source);
  return {
    short: rankSeries(source, short),
    middle: rankSeries(source, middle),
    long: rankSeries(source, long)
  };
}
