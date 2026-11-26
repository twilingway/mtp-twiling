import { advanceDeclineBreadth, type MarketBreadthObservation } from "../ta-batch-external.js";
import { DAY_MS } from "../ta-batch-sessions-calendar.js";
import { cumulativeVolumeIndex, type MarketVolumePeriod } from "../ta-batch-volume-flow.js";
import type {
  NumericSeries,
  NumericValue,
  TechnicalBar,
  TechnicalCalculationContext
} from "../types.js";
import { defineCatalogStudy } from "./contract.js";

export const MAX_MARKET_BREADTH_FILE_SIZE = 16 * 1024 * 1024;
const maxCalendarDays = 100_000;
const validatedDataset = Symbol("validated market breadth dataset");

export interface MarketBreadthStudyParameters {
  "advance-decline-line": Record<string, never>;
  "advance-decline-ratio": Record<string, never>;
  "cumulative-volume-index": Record<string, never>;
}

export type MarketBreadthHistoryRequirement =
  | {
      kind: "market-breadth";
      lookbackBars: 1;
      seedPolicy: "same-market-date";
      convergence: "exact-by-date";
    }
  | {
      kind: "market-breadth";
      lookbackBars: null;
      seedPolicy: "provided-baseline-and-complete-market-dates";
      convergence: "historical-scope-dependent";
    };

type BreadthMetric = "line" | "ratio" | "cvi";
type BreadthSeries = Readonly<Record<BreadthMetric, NumericSeries>>;
export const marketBreadthMetrics = {
  "advance-decline-line": "line",
  "advance-decline-ratio": "ratio",
  "cumulative-volume-index": "cvi"
} as const satisfies Record<keyof MarketBreadthStudyParameters, BreadthMetric>;

export function isMarketBreadthStudy(id: string): id is keyof MarketBreadthStudyParameters {
  return Object.hasOwn(marketBreadthMetrics, id);
}

interface BreadthMetadata {
  readonly marketId: string;
  readonly universe: string;
  readonly source: string;
  readonly timeZone: string;
  readonly volumeUnit: string | null;
  readonly from: string;
  readonly to: string;
}

export interface ImportedMarketBreadth {
  readonly [validatedDataset]: true;
  readonly metadata: BreadthMetadata;
  readonly coverage: Readonly<{
    countDays: number;
    volumeDays: number;
    availableDays: Readonly<Record<BreadthMetric, number>>;
  }>;
  readonly firstDay: number;
  readonly series: BreadthSeries;
}

export interface MarketBreadthInput {
  readonly data: ImportedMarketBreadth;
  readonly marketId: string;
  readonly dateBasis: "utc-date" | "exchange-local";
}

export interface MarketBreadthCalculationInputs {
  readonly marketBreadth?: MarketBreadthInput;
}

function strictRecord(
  value: unknown,
  fields: readonly string[],
  scope: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RangeError(`Invalid market breadth ${scope}`);
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(record, key))
  )
    throw new RangeError(`Invalid market breadth ${scope}`);
  return record;
}

function text(value: unknown, field: string, max = 200): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    value.trim() !== value ||
    value.length === 0
  )
    throw new RangeError(`Invalid market breadth ${field}`);
  return value;
}

function marketDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / DAY_MS
    : null;
}

function marketFormat(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function readMetadata(input: Record<string, unknown>): BreadthMetadata {
  const marketId = text(input.marketId, "marketId", 100);
  const timeZone = text(input.timeZone, "timeZone", 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(marketId) || /^[+-]/.test(timeZone))
    throw new RangeError("Invalid market breadth scope");
  marketFormat(timeZone);
  return Object.freeze({
    marketId,
    universe: text(input.universe, "universe", 1000),
    source: text(input.source, "source", 1000),
    timeZone,
    volumeUnit: input.volumeUnit === null ? null : text(input.volumeUnit, "volumeUnit", 40),
    from: text(input.from, "from", 10),
    to: text(input.to, "to", 10)
  });
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new RangeError(`Invalid market breadth ${field}`);
  return value;
}

function readBaseline(input: unknown, volumeUnit: string | null) {
  const row = strictRecord(input, ["line", "volume"], "baseline");
  const line = row.line === null ? null : finiteNumber(row.line, "line baseline");
  const volume = row.volume === null ? null : finiteNumber(row.volume, "volume baseline");
  if ((line !== null && !Number.isSafeInteger(line)) || (volume !== null && volumeUnit === null))
    throw new RangeError("Invalid market breadth baseline");
  return { line, volume };
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Invalid market breadth count");
  return value;
}

function readCounts(value: unknown) {
  const row = strictRecord(
    value,
    ["advancing", "declining", "unchanged", "universeSize"],
    "counts"
  );
  const advancing = count(row.advancing);
  const declining = count(row.declining);
  const unchanged = count(row.unchanged);
  const universeSize = count(row.universeSize);
  if (universeSize === 0 || universeSize - advancing - declining !== unchanged)
    throw new RangeError("Market breadth counts do not cover the historical universe");
  return { advancing, declining };
}

function readVolumes(value: unknown, volumeUnit: string | null) {
  const row = strictRecord(value, ["advancing", "declining"], "volumes");
  const advancing = finiteNumber(row.advancing, "advancing volume");
  const declining = finiteNumber(row.declining, "declining volume");
  if (volumeUnit === null || advancing < 0 || declining < 0)
    throw new RangeError("Invalid market breadth volumes or measurement unit");
  return { advancing, declining };
}

function calendarDayLabel(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function compileCalendar(
  rows: readonly unknown[],
  metadata: BreadthMetadata,
  firstDay: number,
  baseline: ReturnType<typeof readBaseline>
) {
  const offsets: number[] = [];
  const observations: MarketBreadthObservation[] = [];
  const volumePeriods: MarketVolumePeriod[] = [];
  let volumeDays = 0;

  rows.forEach((row, offset) => {
    const kind = typeof row === "object" && row !== null && "kind" in row ? row.kind : undefined;
    if (kind !== "unknown" && kind !== "closed" && kind !== "observed")
      throw new RangeError("Invalid market breadth date state");
    const input = strictRecord(
      row,
      kind === "observed" ? ["kind", "date", "counts", "volumes"] : ["kind", "date"],
      "date row"
    );
    if (input.date !== calendarDayLabel(firstDay + offset))
      throw new RangeError("Market breadth dates must be consecutive and ordered");
    if (kind === "closed") return;

    // Use elapsed UTC-day units as the monotone keys at the kernel boundary.
    const timestamp = offset * DAY_MS;
    offsets.push(timestamp);
    const counts = kind === "observed" && input.counts !== null ? readCounts(input.counts) : null;
    const volumes =
      kind === "observed" && input.volumes !== null
        ? readVolumes(input.volumes, metadata.volumeUnit)
        : null;
    if (kind === "observed" && counts === null && volumes === null)
      throw new RangeError("Market breadth observed date must contain a known aggregate");
    if (counts) observations.push({ timestamp, ...counts });
    if (volumes) {
      if (
        (counts?.advancing === 0 && volumes.advancing !== 0) ||
        (counts?.declining === 0 && volumes.declining !== 0)
      )
        throw new RangeError("Market breadth volume has no classified instruments");
      volumeDays++;
    }
    volumePeriods.push({
      advancingVolume: volumes?.advancing ?? null,
      decliningVolume: volumes?.declining ?? null
    });
  });

  const { line, ratio } = advanceDeclineBreadth(offsets, observations, baseline.line ?? 0);
  const cvi = cumulativeVolumeIndex(volumePeriods, baseline.volume);
  const expand = (values: NumericSeries): NumericSeries => {
    const series = Array<NumericValue>(rows.length).fill(null);
    offsets.forEach((timestamp, index) => {
      series[timestamp / DAY_MS] = values[index] ?? null;
    });
    return Object.freeze(series);
  };
  const series: BreadthSeries = Object.freeze({
    line:
      baseline.line === null ? Object.freeze(Array<null>(rows.length).fill(null)) : expand(line),
    ratio: expand(ratio),
    cvi: expand(cvi)
  });
  const known = (metric: BreadthMetric): number =>
    series[metric].reduce<number>((total, value) => total + Number(value !== null), 0);
  const coverage = Object.freeze({
    countDays: observations.length,
    volumeDays,
    availableDays: Object.freeze({ line: known("line"), ratio: known("ratio"), cvi: known("cvi") })
  });
  return { series, coverage };
}

/** Parse only a user-supplied source. No requests, storage writes, or fallback candle data. */
export function parseMarketBreadthFile(contents: string): ImportedMarketBreadth {
  if (contents.length > MAX_MARKET_BREADTH_FILE_SIZE)
    throw new RangeError("Market breadth file exceeds the import limit");
  const json: unknown = JSON.parse(contents.replace(/^\uFEFF/, ""));
  const input = strictRecord(
    json,
    [
      "schemaVersion",
      "marketId",
      "universe",
      "source",
      "timeZone",
      "volumeUnit",
      "from",
      "to",
      "baseline",
      "rows"
    ],
    "file"
  );
  if (input.schemaVersion !== 1 || !Array.isArray(input.rows))
    throw new RangeError("Unknown market breadth file version or row format");
  const metadata = readMetadata(input);
  const firstDay = marketDay(metadata.from);
  const lastDay = marketDay(metadata.to);
  if (
    firstDay === null ||
    lastDay === null ||
    firstDay > lastDay ||
    lastDay - firstDay + 1 > maxCalendarDays ||
    input.rows.length !== lastDay - firstDay + 1
  )
    throw new RangeError("Invalid market breadth calendar coverage");
  const baseline = readBaseline(input.baseline, metadata.volumeUnit);
  const { series, coverage } = compileCalendar(input.rows, metadata, firstDay, baseline);
  return Object.freeze({ [validatedDataset]: true as const, firstDay, metadata, series, coverage });
}

function marketInput(
  context:
    | (Pick<TechnicalCalculationContext, "chartInterval"> & MarketBreadthCalculationInputs)
    | undefined
): MarketBreadthInput | undefined {
  const input = context?.marketBreadth;
  return context?.chartInterval === "1d" &&
    input?.data?.[validatedDataset] &&
    input.marketId === input.data.metadata.marketId &&
    (input.dateBasis === "utc-date" || input.dateBasis === "exchange-local")
    ? input
    : undefined;
}

function projectedDays(
  bars: readonly Pick<TechnicalBar, "timestamp">[],
  input: MarketBreadthInput
) {
  const { data } = input;
  const format = input.dateBasis === "exchange-local" ? marketFormat(data.metadata.timeZone) : null;
  return bars.map(({ timestamp }) => {
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null;
    if (!format) return Math.floor(timestamp / DAY_MS);
    const parts = format.formatToParts(timestamp);
    const read = (type: string) => parts.find((part) => part.type === type)?.value;
    return marketDay(`${read("year")}-${read("month")}-${read("day")}`);
  });
}

function projectedPoint(
  days: readonly (number | null)[],
  index: number,
  data: ImportedMarketBreadth,
  metric: BreadthMetric
): NumericValue {
  const day = days[index];
  return day == null || days[index - 1] === day || days[index + 1] === day
    ? null
    : (data.series[metric][day - data.firstDay] ?? null);
}

export function marketBreadthCoverage(
  bars: readonly Pick<TechnicalBar, "timestamp">[],
  input: MarketBreadthInput
): Readonly<Record<BreadthMetric, boolean>> {
  const { data } = input;
  const days = projectedDays(bars, input);
  const usable = (metric: BreadthMetric) =>
    data.coverage.availableDays[metric] > 0 &&
    days.some((_, i) => projectedPoint(days, i, data, metric) !== null);
  return { line: usable("line"), ratio: usable("ratio"), cvi: usable("cvi") };
}

function marketBreadthStudy<Id extends keyof MarketBreadthStudyParameters>({
  id,
  catalogId,
  title,
  shortTitle,
  metric,
  reference
}: {
  id: Id;
  catalogId: string;
  title: string;
  shortTitle: string;
  metric: BreadthMetric;
  reference: string;
}) {
  const color = "#2962ff";
  const historyRequirement: MarketBreadthHistoryRequirement =
    metric === "ratio"
      ? {
          kind: "market-breadth",
          lookbackBars: 1,
          seedPolicy: "same-market-date",
          convergence: "exact-by-date"
        }
      : {
          kind: "market-breadth",
          lookbackBars: null,
          seedPolicy: "provided-baseline-and-complete-market-dates",
          convergence: "historical-scope-dependent"
        };
  return defineCatalogStudy<Id, MarketBreadthStudyParameters[Id]>({
    catalogId,
    definition: {
      id,
      title,
      shortTitle,
      schemaVersion: 1,
      status: "computed",
      defaultPane: "pane",
      parameters: [],
      outputs: [{ id: "value", title, kind: "line", color }],
      levels: metric === "ratio" ? [1] : [],
      references: [reference],
      presentation: {
        renderVersion: 2,
        hiddenSeries: [],
        fills: [],
        plots: [
          {
            id: "value",
            seriesKey: "value",
            geometry: { kind: "line", gaps: "break" },
            color: { kind: "solid", color },
            width: 1
          }
        ]
      }
    },
    history: () => ({ warmupBars: 1, historyRequirement }),
    unavailableReason: (_count, _params, context) =>
      marketInput(context)?.data.coverage.availableDays[metric]
        ? undefined
        : "external-data-unavailable",
    calculate: (bars, _params, context) => {
      const input = marketInput(context);
      const days = input ? projectedDays(bars, input) : undefined;
      return {
        value:
          input && days
            ? days.map((_, i) => projectedPoint(days, i, input.data, metric))
            : bars.map(() => null)
      };
    }
  });
}

export const marketBreadthStudies = [
  marketBreadthStudy({
    id: "advance-decline-line",
    catalogId: "STD;Advance%1Decline%1Line",
    title: "Advance/Decline Line",
    shortTitle: "A/D Line",
    metric: "line",
    reference: "https://www.tradingview.com/support/solutions/43000589092-advance-decline-line/"
  }),
  marketBreadthStudy({
    id: "advance-decline-ratio",
    catalogId: "STD;Advance%1Decline%1Ratio",
    title: "Advance/Decline Ratio",
    shortTitle: "A/D Ratio",
    metric: "ratio",
    reference: "https://www.tradingview.com/support/solutions/43000589093-advance-decline-ratio/"
  }),
  marketBreadthStudy({
    id: "cumulative-volume-index",
    catalogId: "STD;Cumulative%1Volume%1Index",
    title: "Cumulative Volume Index",
    shortTitle: "CVI",
    metric: "cvi",
    reference:
      "https://www.tradingview.com/support/solutions/43000589126-cumulative-volume-index-cvi/"
  })
] as const;
