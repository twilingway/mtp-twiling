import { assertTechnicalBars } from "./data.js";
import type { TechnicalBar } from "./types.js";

export interface VolumeProfileRow {
  readonly low: number;
  readonly high: number;
  readonly volume: number;
}

function periodPrices(bars: readonly TechnicalBar[]) {
  const open = bars[0]?.open;
  const close = bars.at(-1)?.close;
  if (open == null || close == null) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const bar of bars) {
    if (bar.high === null || bar.low === null) return null;
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
  }
  return { open, high, low, close };
}

function maximumVolumeRow(rows: readonly VolumeProfileRow[]) {
  let total = 0;
  let pocIndex = 0;
  let previous: VolumeProfileRow | undefined;
  for (const [index, row] of rows.entries()) {
    if (
      !Number.isFinite(row.low) ||
      !Number.isFinite(row.high) ||
      !Number.isFinite(row.volume) ||
      row.low >= row.high ||
      row.volume < 0 ||
      (previous && previous.high !== row.low)
    )
      throw new RangeError("Volume rows need finite contiguous prices and nonnegative volume");
    total += row.volume;
    if (row.volume > rows[pocIndex]!.volume) pocIndex = index;
    previous = row;
  }
  return { total, pocIndex };
}

function areaBounds(rows: readonly VolumeProfileRow[], pocIndex: number, target: number) {
  let left = pocIndex;
  let right = pocIndex;
  let included = rows[pocIndex]!.volume;
  while (included < target) {
    const lower = rows[left - 1]?.volume;
    const upper = rows[right + 1]?.volume;
    if (lower === undefined && upper === undefined) break;
    const chooseUpper =
      lower === undefined ||
      (upper !== undefined &&
        (upper > lower || (upper === lower && right - pocIndex <= pocIndex - left)));
    const combined = included + (chooseUpper ? upper! : lower);
    if (combined > target && combined - target > target * Number.EPSILON) break;
    included = combined;
    if (chooseUpper) right++;
    else left--;
  }
  return { vah: rows[right]!.high, val: rows[left]!.low };
}

function profileLevels(rows: readonly VolumeProfileRow[], fraction: number) {
  const { total, pocIndex } = maximumVolumeRow(rows);
  if (total <= 0 || !Number.isFinite(total)) return null;
  const row = rows[pocIndex]!;
  const poc = row.low / 2 + row.high / 2;
  if (fraction === 1) return { poc, vah: rows.at(-1)!.high, val: rows[0]!.low };
  return { poc, ...areaBounds(rows, pocIndex, total * fraction) };
}

/** Each call represents one period. Provide the volume bins independently of its candles. */
export function autoKeyLevelsForPeriod(
  bars: readonly TechnicalBar[],
  profileRows: readonly VolumeProfileRow[] = [],
  valueAreaFraction = 0.7
) {
  if (!Number.isFinite(valueAreaFraction) || valueAreaFraction <= 0 || valueAreaFraction > 1)
    throw new RangeError("Value area fraction must be in (0, 1]");
  assertTechnicalBars(bars);
  return { prices: periodPrices(bars), profile: profileLevels(profileRows, valueAreaFraction) };
}
