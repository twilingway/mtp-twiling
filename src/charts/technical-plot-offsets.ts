import { TIMEFRAMES } from "../model/history-codec.js";
import { isNativeIntervalId } from "../model/intervals/registry.js";
import { timeForLogical } from "../model/intervals/projected-time.js";
import type {
  NumericSeries,
  NumericValue,
  TechnicalCalculationContext,
  TechnicalIndicatorResult
} from "../model/technical-indicators/types.js";

/** Place outputs on the chart's candle slots without changing any calculation input or value. */
export function technicalPlotData(
  result: Pick<TechnicalIndicatorResult, "timestamps" | "series" | "barOffsets">,
  context?: TechnicalCalculationContext
): { timestamps: readonly number[]; series: Readonly<Record<string, NumericSeries>> } {
  const { timestamps, series, barOffsets } = result;
  if (
    !timestamps.length ||
    !barOffsets ||
    Object.values(barOffsets).every((offset) => offset === 0)
  )
    return { timestamps, series };

  const interval = context?.chartInterval;
  const intervalMs = isNativeIntervalId(interval) ? TIMEFRAMES[interval].ms : undefined;
  const length = timestamps.length;
  let count = length;
  for (const [key, offset] of Object.entries(barOffsets)) {
    if (!Number.isSafeInteger(offset) || offset < -10000 || offset > 500)
      throw new RangeError("Technical plot offset out of bounds");
    const values = series[key];
    if (offset > 0 && values && intervalMs !== undefined)
      for (let i = values.length - 1; i >= Math.max(0, length - offset); i--)
        if (values[i] !== null && values[i] !== undefined) {
          count = Math.max(count, i + offset + 1);
          break;
        }
  }
  const future: number[] = [];
  if (count > length && intervalMs !== undefined) {
    // Only the final observed candle is needed to project future logical slots.
    const anchor = [{ timestamp: timestamps.at(-1)! }];
    for (let i = length; i < count; i++)
      future.push(timeForLogical(anchor, i - length + 1, intervalMs)!);
  }
  const placed = Object.fromEntries(
    Object.entries(series).map(([key, values]) => {
      const offset = barOffsets[key] ?? 0;
      if (!offset && length === count) return [key, values];
      const slots = Array<NumericValue>(count).fill(null);
      // A negative destination before the loaded domain has no known chart candle.
      for (let i = Math.max(0, -offset); i < Math.min(length, count - offset); i++)
        slots[i + offset] = values[i] ?? null;
      return [key, slots];
    })
  );
  return { timestamps: future.length ? [...timestamps, ...future] : timestamps, series: placed };
}
