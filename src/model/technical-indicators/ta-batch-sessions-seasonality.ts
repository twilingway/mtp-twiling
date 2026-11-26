import { finiteOrNull } from "./primitives.js";
import type { NumericValue } from "./types.js";

export interface SeasonalityMonth {
  readonly year: number;
  readonly month: number;
  readonly close: NumericValue;
  readonly complete: boolean;
}

export interface SeasonalityOptions {
  readonly startYear: number;
  readonly ignoredMonths?: readonly string[];
}

export interface SeasonalStatistics {
  readonly count: number;
  readonly average: NumericValue;
  readonly standardDeviation: NumericValue;
  readonly percentPositive: NumericValue;
}

export interface SeasonalityCell extends SeasonalityMonth {
  readonly changePercent: NumericValue;
  readonly projection: {
    readonly referenceClose: number;
    readonly expectedClose: NumericValue;
    readonly historical: SeasonalStatistics;
  } | null;
}

interface Accumulator {
  count: number;
  mean: number;
  sumOfSquaredDifferences: number;
  positive: number;
}

function summarize(sample: Accumulator): SeasonalStatistics {
  const { count, mean, sumOfSquaredDifferences, positive } = sample;
  return {
    count,
    average: count > 0 ? finiteOrNull(mean) : null,
    standardDeviation:
      count > 0 ? finiteOrNull(Math.sqrt(Math.max(0, sumOfSquaredDifferences) / count)) : null,
    percentPositive: count > 0 ? (positive / count) * 100 : null
  };
}

function observe(sample: Accumulator, change: number): void {
  sample.count++;
  const deviation = change - sample.mean;
  sample.mean += deviation / sample.count;
  sample.sumOfSquaredDifferences += deviation * (change - sample.mean);
  if (change > 0) sample.positive++;
}

export function seasonalChanges(
  months: readonly SeasonalityMonth[],
  { startYear, ignoredMonths = [] }: SeasonalityOptions
): {
  readonly cells: readonly SeasonalityCell[];
  readonly statistics: readonly SeasonalStatistics[];
} {
  if (!Number.isInteger(startYear) || startYear < 1 || startYear > 9999)
    throw new RangeError("Invalid seasonality starting year");
  if (ignoredMonths.some((month) => !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)))
    throw new RangeError("Invalid ignored month, expected YYYY-MM");
  const ignored = new Set(ignoredMonths);
  const perMonth = Array.from({ length: 12 }, (): Accumulator => ({
    count: 0,
    mean: 0,
    sumOfSquaredDifferences: 0,
    positive: 0
  }));
  const cells: SeasonalityCell[] = [];
  let previous: SeasonalityMonth | undefined;
  let previousKey = 0;
  for (const bar of months) {
    const { year, month, close, complete } = bar;
    const key = year * 12 + month;
    if (
      !Number.isInteger(year) ||
      year < 1 ||
      year > 9999 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      (close !== null && !Number.isFinite(close)) ||
      key <= previousKey ||
      (previous && !previous.complete)
    )
      throw new RangeError("Invalid ordered monthly history");
    const excluded = ignored.has(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
    );
    const referenceClose = key === previousKey + 1 && previous?.close ? previous.close : null;
    previous = bar;
    previousKey = key;
    if (year < startYear) continue;
    const sample = perMonth[month - 1]!;
    const historical = summarize(sample);
    const projection =
      !excluded && referenceClose !== null && historical.average !== null
        ? {
            referenceClose,
            expectedClose: finiteOrNull(referenceClose * (1 + historical.average / 100)),
            historical
          }
        : null;
    const changePercent =
      !excluded && referenceClose !== null && close !== null
        ? finiteOrNull(((close - referenceClose) / referenceClose) * 100)
        : null;
    cells.push({ ...bar, projection, changePercent });
    if (complete && changePercent !== null) observe(sample, changePercent);
  }
  return { cells, statistics: perMonth.map(summarize) };
}
