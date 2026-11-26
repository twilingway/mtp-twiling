import type { HistoryRange, MarketRow } from "../../types.js";
import { civilClock, DAY_MS, timestampIsValid } from "../ta-batch-sessions-calendar.js";
import { finiteOrNull } from "../primitives.js";
import { performanceTable } from "../ta-batch-sessions-performance.js";
import type { PerformanceCell } from "../ta-batch-sessions-performance.js";
import { seasonalChanges } from "../ta-batch-sessions-seasonality.js";
import type { SeasonalityMonth, SeasonalityOptions } from "../ta-batch-sessions-seasonality.js";
import type { TechnicalBar } from "../types.js";
import type { TechnicalPriceRegion } from "./calendar-geometry.js";

export interface CalendarHistoryBar {
  timestamp: number;
  close: number | null;
  confirmed?: boolean;
}

export interface CalendarHistorySource {
  uid: string;
  symbol: string;
}

export type CalendarHistoryLoader = (
  row: CalendarHistorySource,
  timeframe: "1d" | "1M",
  range: HistoryRange,
  signal: AbortSignal
) => Promise<readonly CalendarHistoryBar[]>;

export interface SeasonalityHistory {
  timeZone: string;
  months: readonly SeasonalityMonth[];
}

export interface DailyPerformanceDataset {
  timeZone: string;
  latestDay?: number;
  latestOpen?: number;
  latestConfirmed?: true;
  cells: readonly PerformanceCell[];
}

export type CalendarTarget =
  | { label: string; row: MarketRow & { uid: string } }
  | { label: string; error: "unknown" | "ambiguous" };

export const calendarList = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const upper = (text: string) => text.trim().toUpperCase();

function canonicalSources(row: MarketRow): string[] {
  const source = row.providerRef?.provider ?? row.exchange;
  return [
    row.uid ?? "",
    row.symbol,
    row.ticker,
    ...(source ? [`${source}:${row.ticker}`, `${source}:${row.symbol}`] : [])
  ]
    .filter(Boolean)
    .map(upper);
}

export function performanceTargets(
  includeChart: boolean,
  symbols: string,
  selected: MarketRow | undefined,
  rows: readonly MarketRow[]
): CalendarTarget[] {
  const available = new Map<string, MarketRow & { uid: string }>();
  for (const row of rows) if (row.uid) available.set(row.uid, { ...row, uid: row.uid });
  if (selected?.uid && !available.has(selected.uid))
    available.set(selected.uid, { ...selected, uid: selected.uid });
  const tokens = [...new Set(calendarList(symbols).map(upper))];
  const result: CalendarTarget[] = [];
  const used = new Set<string>();
  const add = (label: string, row: MarketRow & { uid: string }) => {
    if (used.has(row.uid)) return;
    used.add(row.uid);
    result.push({ label, row });
  };
  const chart = selected?.uid ? available.get(selected.uid) : undefined;
  if (includeChart && chart) add(chart.ticker || chart.symbol, chart);
  for (const token of tokens) {
    const exact = [...available.values()].find((row) => upper(row.uid) === token);
    if (exact) {
      add(token, exact);
      continue;
    }
    const matches = [...available.values()].filter((row) => canonicalSources(row).includes(token));
    if (matches.length === 1) add(token, matches[0]!);
    else result.push({ label: token, error: matches.length ? "ambiguous" : "unknown" });
  }
  return result;
}

export function performancePeriodDays(token: string): number | undefined {
  if (token === "YTD") return 366;
  const match = /^([1-9]\d{0,3})?([DWMY])$/.exec(token);
  if (!match) return undefined;
  const unit = match[2];
  const days =
    Number(match[1] ?? 1) * (unit === "D" ? 1 : unit === "W" ? 7 : unit === "M" ? 31 : 366);
  return days <= 3660 ? days : undefined;
}

export function coveredDailyRange(asOf: number, days: number): HistoryRange {
  // Cover the earliest anchor plus room for a venue holiday or downtime before it.
  return { from: Math.max(0, asOf - (days + 40) * DAY_MS), to: asOf };
}

export function coveredMonthlyRange(asOf: number, startYear: number): HistoryRange {
  return { from: Math.max(0, Date.UTC(startYear - 1, 11, 1) - 2 * DAY_MS), to: asOf };
}

function acceptedBars(bars: readonly CalendarHistoryBar[], asOf: number): CalendarHistoryBar[] {
  const rows = new Map<number, CalendarHistoryBar>();
  for (const row of bars) {
    if (!timestampIsValid(row.timestamp) || row.timestamp < 0 || row.timestamp > asOf) continue;
    if (row.close !== null && !Number.isFinite(row.close)) continue;
    const prior = rows.get(row.timestamp);
    if (prior?.confirmed && !row.confirmed) continue;
    rows.set(row.timestamp, row);
  }
  return [...rows.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function dailyPerformanceDataset(
  symbol: string,
  timeZone: string,
  history: readonly CalendarHistoryBar[],
  periods: readonly string[],
  asOf: number
): DailyPerformanceDataset {
  const bars = acceptedBars(history, asOf);
  const last = bars.at(-1);
  return {
    timeZone,
    ...(last && {
      latestDay: Math.floor(civilClock(timeZone)(last.timestamp) / DAY_MS),
      latestOpen: last.timestamp,
      ...(last.confirmed && { latestConfirmed: true as const })
    }),
    cells: performanceTable([{ symbol, timeZone, dailyBars: bars }], periods)[0]!.cells
  };
}

export function applyLatestPerformanceTrade(
  dataset: DailyPerformanceDataset,
  timestamp: number,
  price: number | null
): readonly PerformanceCell[] {
  if (
    price === null ||
    !Number.isFinite(price) ||
    dataset.latestDay === undefined ||
    dataset.latestOpen === undefined ||
    dataset.latestConfirmed === true ||
    !timestampIsValid(timestamp) ||
    timestamp < dataset.latestOpen ||
    Math.floor(civilClock(dataset.timeZone)(timestamp) / DAY_MS) !== dataset.latestDay
  )
    return dataset.cells;
  return dataset.cells.map((cell) => ({
    ...cell,
    percent:
      cell.anchorClose === null || cell.anchorClose === 0
        ? null
        : finiteOrNull(((price - cell.anchorClose) / cell.anchorClose) * 100)
  }));
}

function calendarMonth(timestamp: number, clock: (timestamp: number) => number) {
  const local = new Date(clock(timestamp));
  const year = local.getUTCFullYear(),
    month = local.getUTCMonth() + 1;
  return { year, month, key: year * 12 + month };
}

export function normalizeSeasonalityHistory(
  bars: readonly CalendarHistoryBar[],
  timeZone: string,
  asOf: number
): SeasonalityHistory {
  const clock = civilClock(timeZone);
  const current = calendarMonth(asOf, clock).key;
  const months = new Map<number, SeasonalityMonth>();
  for (const bar of acceptedBars(bars, asOf)) {
    const { year, month, key } = calendarMonth(bar.timestamp, clock);
    if (key > current || (key < current && bar.confirmed === false)) continue;
    const complete = bar.confirmed === true || key < current;
    if (months.get(key)?.complete && !complete) continue;
    months.set(key, { year, month, close: bar.close, complete });
  }
  return { timeZone, months: [...months.values()] };
}

export function seasonalProjectionRegions(
  bars: readonly TechnicalBar[],
  history: SeasonalityHistory,
  options: SeasonalityOptions
): TechnicalPriceRegion[] {
  const { cells } = seasonalChanges(history.months, options);
  const clock = civilClock(history.timeZone);
  const spans = new Map<number, { from: number; to: number }>();
  for (let index = 0; index < bars.length;) {
    const timestamp = bars[index]!.timestamp;
    const { key } = calendarMonth(timestamp, clock);
    let firstDifferent = index + 1,
      end = bars.length;
    while (firstDifferent < end) {
      const middle = Math.floor((firstDifferent + end) / 2);
      if (calendarMonth(bars[middle]!.timestamp, clock).key <= key) firstDifferent = middle + 1;
      else end = middle;
    }
    spans.set(key, { from: timestamp, to: bars[firstDifferent - 1]!.timestamp });
    index = firstDifferent;
  }
  return cells.flatMap(({ year, month, projection }) => {
    const span = spans.get(year * 12 + month);
    if (!span || !projection) return [];
    const {
      referenceClose,
      expectedClose,
      historical: { average }
    } = projection;
    if (expectedClose === null || average === null) return [];
    return [
      {
        styleId: average >= 0 ? "positive" : "negative",
        startTimestamp: span.from,
        endTimestamp: span.to,
        startEdge: "left",
        endEdge: "right",
        low: Math.min(referenceClose, expectedClose),
        high: Math.max(referenceClose, expectedClose),
        label: { name: `${average >= 0 ? "+" : ""}${average.toFixed(2)}%` }
      }
    ];
  });
}
