import type { NumericValue } from "../types.js";

/** Extended exponent is internal arithmetic, never a public numeric result. */
export interface Scalar {
  readonly unit: number;
  readonly exponent: number;
}
export const ZERO: Scalar = { unit: 0, exponent: 0 };
export function scalar(unit: number, exponent = 0): Scalar {
  if (unit === 0) return ZERO;
  const shift = Math.min(1023, Math.floor(Math.log2(Math.abs(unit))));
  return { unit: unit / 2 ** shift, exponent: exponent + shift };
}
export function add(a: Scalar, b: Scalar): Scalar {
  if (a.unit === 0) return b;
  if (b.unit === 0) return a;
  const exponent = Math.max(a.exponent, b.exponent);
  return scalar(
    a.unit * 2 ** (a.exponent - exponent) + b.unit * 2 ** (b.exponent - exponent),
    exponent
  );
}
export const times = (a: Scalar, factor: number): Scalar =>
  factor === 0 ? ZERO : scalar(a.unit * factor, a.exponent);
export const subtract = (a: Scalar, b: Scalar): Scalar => add(a, times(b, -1));
export const multiply = (a: Scalar, b: Scalar): Scalar =>
  scalar(a.unit * b.unit, a.exponent + b.exponent);
export function blend(a: Scalar, b: Scalar, weight: number): Scalar {
  if (a.unit === b.unit && a.exponent === b.exponent) return a;
  return add(times(a, 1 - weight), times(b, weight));
}
export function root(a: Scalar): Scalar {
  const odd = Math.abs(a.exponent % 2) === 1;
  return scalar(Math.sqrt(a.unit * (odd ? 2 : 1)), (a.exponent - (odd ? 1 : 0)) / 2);
}
export function number(a: Scalar): NumericValue {
  // Split multiplication avoids 2**1024 overflow when the final result is finite.
  const value =
    a.exponent > 1023
      ? a.unit * 2 ** (a.exponent - 1023) * 2 ** 1023
      : a.exponent < -1022
        ? a.unit * 2 ** (a.exponent + 1022) * 2 ** -1022
        : a.unit * 2 ** a.exponent;
  return Number.isFinite(value) ? value : null;
}
export function ratio(a: Scalar, b: Scalar, multiplier = 1): NumericValue {
  if (b.unit === 0) return null;
  return number(times(scalar(a.unit / b.unit, a.exponent - b.exponent), multiplier));
}
export const difference = (a: number, b: number): Scalar => subtract(scalar(a), scalar(b));
