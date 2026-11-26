import { assertTechnicalBars, priceSource } from "./data.js";
import { assertLength, finiteOrNull } from "./primitives.js";
import type { NumericValue, PriceSource, TechnicalBar } from "./types.js";

interface Timed {
  readonly timestamp: number;
}

interface TimedValue extends Timed {
  readonly value: NumericValue;
}

function validTimestamp(timestamp: number): boolean {
  return Number.isSafeInteger(timestamp) && timestamp >= 0;
}

function assertChronological(timestamps: readonly number[]): void {
  let previous = -1;
  for (const timestamp of timestamps) {
    if (!validTimestamp(timestamp) || timestamp <= previous)
      throw new RangeError(
        "External indicator timestamps must be strictly increasing UTC milliseconds"
      );
    previous = timestamp;
  }
}

function align<T extends Timed>(timestamps: readonly number[], rows: readonly T[]): (T | null)[] {
  assertChronological(timestamps);
  assertChronological(rows.map(({ timestamp }) => timestamp));
  let cursor = 0;
  return timestamps.map((timestamp) => {
    while (cursor < rows.length && rows[cursor]!.timestamp < timestamp) cursor++;
    const row = rows[cursor];
    return row?.timestamp === timestamp ? row : null;
  });
}

export interface MarketBreadthObservation extends Timed {
  readonly advancing: number;
  readonly declining: number;
}

const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

export function advanceDeclineBreadth(
  timestamps: readonly number[],
  observations: readonly MarketBreadthObservation[],
  initialLine = 0
) {
  if (!Number.isSafeInteger(initialLine)) throw new RangeError("Invalid advance/decline baseline");
  for (const { advancing, declining } of observations)
    if (!isCount(advancing) || !isCount(declining)) throw new RangeError("Invalid breadth count");
  const aligned = align(timestamps, observations);
  let total: NumericValue = initialLine;
  const line = aligned.map((point) => {
    if (total === null || point === null) {
      total = null;
      return total;
    }
    const next = total + (point.advancing - point.declining);
    total = Number.isSafeInteger(next) ? next : null;
    return total;
  });
  const ratio = aligned.map((point) =>
    point && point.declining > 0 ? point.advancing / point.declining : null
  );
  return { line, ratio };
}

export const ADVANCE_DECLINE_BARS_DEFAULT_LENGTH = 9;

export function advanceDeclineRatioBars(
  bars: readonly TechnicalBar[],
  length = ADVANCE_DECLINE_BARS_DEFAULT_LENGTH
): NumericValue[] {
  assertLength(length);
  assertTechnicalBars(bars);
  const signs: NumericValue[] = [];
  let advancing = 0;
  let declining = 0;
  let missing = 0;
  return bars.map(({ open, close }, index) => {
    const sign = open === null || close === null ? null : Math.sign(close - open);
    signs.push(sign);
    advancing += Number(sign === 1);
    declining += Number(sign === -1);
    missing += Number(sign === null);
    if (index >= length) {
      const expired = signs[index - length];
      advancing -= Number(expired === 1);
      declining -= Number(expired === -1);
      missing -= Number(expired === null);
    }
    return index + 1 >= length && missing === 0 && declining > 0 ? advancing / declining : null;
  });
}

export const CORRELATION_DEFAULT_LENGTH = 20;

function pearson(
  left: readonly NumericValue[],
  right: readonly NumericValue[],
  first: number,
  last: number
): NumericValue {
  let xScale = 0;
  let yScale = 0;
  for (let i = first; i <= last; i++) {
    const x = left[i] ?? null;
    const y = right[i] ?? null;
    if (x === null || y === null) return null;
    xScale = Math.max(xScale, Math.abs(x));
    yScale = Math.max(yScale, Math.abs(y));
  }
  if (!xScale || !yScale) return null;
  let meanX = 0;
  let meanY = 0;
  let varianceX = 0;
  let varianceY = 0;
  let covariance = 0;
  for (let i = first; i <= last; i++) {
    const x = left[i]! / xScale;
    const y = right[i]! / yScale;
    const size = i - first + 1;
    const dx = x - meanX;
    const dy = y - meanY;
    meanX += dx / size;
    meanY += dy / size;
    varianceX += dx * (x - meanX);
    varianceY += dy * (y - meanY);
    covariance += dx * (y - meanY);
  }
  if (varianceX <= 0 || varianceY <= 0) return null;
  return finiteOrNull(Math.min(1, Math.max(-1, covariance / Math.sqrt(varianceX * varianceY))));
}

export function correlationCoefficient(
  primary: readonly TechnicalBar[],
  comparison: readonly TechnicalBar[],
  length = CORRELATION_DEFAULT_LENGTH,
  source: PriceSource = "close"
): NumericValue[] {
  assertLength(length);
  if (length < 2) throw new RangeError("Correlation requires at least two observations");
  assertTechnicalBars(primary);
  assertTechnicalBars(comparison);
  const left = priceSource(primary, source);
  const right = align(
    primary.map(({ timestamp }) => timestamp),
    priceSource(comparison, source).map((value, index) => ({
      timestamp: comparison[index]!.timestamp,
      value
    }))
  ).map((row) => row?.value ?? null);
  return left.map((_, index) =>
    index + 1 < length ? null : pearson(left, right, index - length + 1, index)
  );
}

export type OpenInterestUnit =
  | { readonly kind: "contracts" }
  | { readonly kind: "base" | "quote" | "notional"; readonly currency: string };

export interface OpenInterestObservations {
  readonly instrumentKey: string;
  readonly unit: OpenInterestUnit;
  readonly rows: readonly TimedValue[];
}

export function openInterestSeries(
  instrumentKey: string,
  timestamps: readonly number[],
  observations: OpenInterestObservations
) {
  if (!instrumentKey || instrumentKey !== observations.instrumentKey)
    throw new RangeError("Open interest instrument mismatch");
  if (observations.unit.kind !== "contracts" && !observations.unit.currency.trim())
    throw new RangeError("Missing open interest currency");
  for (const { value } of observations.rows)
    if (value !== null && (!Number.isFinite(value) || value < 0))
      throw new RangeError("Invalid open interest observation");
  return {
    unit: observations.unit,
    values: align(timestamps, observations.rows).map((row) => row?.value ?? null)
  };
}

export interface PriceTargetForecast {
  readonly instrumentKey: string;
  readonly currency: string;
  readonly publicationTimestamp: number;
  readonly horizonTimestamp: number;
  readonly low: number;
  readonly mean: number;
  readonly high: number;
  readonly analystCount: number | null;
}

export interface PriceTargetReferenceClose extends Timed {
  readonly instrumentKey: string;
  readonly currency: string;
  readonly close: number;
}

export function priceTargetLevels(
  forecast: PriceTargetForecast | null,
  reference: PriceTargetReferenceClose | null,
  asOf: number
) {
  if (!forecast || !reference || !validTimestamp(asOf)) return null;
  const {
    instrumentKey,
    currency,
    publicationTimestamp,
    horizonTimestamp,
    low,
    mean,
    high,
    analystCount
  } = forecast;
  if (
    !instrumentKey ||
    instrumentKey !== reference.instrumentKey ||
    !currency.trim() ||
    currency.toUpperCase() !== reference.currency.toUpperCase() ||
    !validTimestamp(publicationTimestamp) ||
    !validTimestamp(horizonTimestamp) ||
    !validTimestamp(reference.timestamp) ||
    publicationTimestamp > asOf ||
    reference.timestamp > asOf ||
    horizonTimestamp <= Math.max(publicationTimestamp, reference.timestamp) ||
    ![low, mean, high, reference.close].every((price) => Number.isFinite(price) && price > 0) ||
    low > mean ||
    mean > high ||
    (analystCount !== null && (!isCount(analystCount) || analystCount === 0))
  )
    return null;
  const level = (price: number) => ({
    price,
    changePercent: finiteOrNull(((price - reference.close) / reference.close) * 100)
  });
  return {
    currency: currency.toUpperCase(),
    publicationTimestamp,
    horizonTimestamp,
    analystCount,
    origin: { timestamp: reference.timestamp, price: reference.close },
    levels: { low: level(low), mean: level(mean), high: level(high) }
  };
}
