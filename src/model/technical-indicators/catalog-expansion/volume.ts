import { candleCalendarPeriod } from "../../candle-clock.js";
import { NATIVE_TIMEFRAME_CONFIG } from "../../intervals/native-timeframes.js";
import { getInterval, INTERVALS } from "../../intervals/registry.js";
import type { IntervalId } from "../../intervals/registry.js";
import { klingerOscillator } from "../ta-batch-volume-flow.js";
import { readQuoteTurnover, TURNOVER_DAY } from "../ta-batch-volume-flow-turnover.js";
import type { QuoteTurnoverSeries } from "../ta-batch-volume-flow-turnover.js";
import { relativeVolumeAtTime } from "../ta-batch-volume-flow-time.js";
import type { RelativeVolumePeriod } from "../ta-batch-volume-flow-time.js";
import type { TechnicalBar, TechnicalCalculationContext } from "../types.js";
import { defineCatalogStudy } from "./contract.js";

const anchors = [
  "1m",
  "2m",
  "3m",
  "5m",
  "10m",
  "15m",
  "30m",
  "45m",
  "1h",
  "2h",
  "3h",
  "4h",
  "1d",
  "1w",
  "1M",
  "3M",
  "6M",
  "12M"
] as const satisfies readonly IntervalId[];
const calculationModes = ["cumulative", "regular"] as const;
const MAX_RELATIVE_VOLUME_VISITS = 5_000_000;
const DAY_MS = 86_400_000;

export type VolumeAnchorInterval = (typeof anchors)[number];

export interface VolumeStudyData {
  /** Aligned to the current instrument and chart interval, with source-confirmed period coverage. */
  readonly relativeVolumePeriods?: Partial<
    Record<VolumeAnchorInterval, readonly RelativeVolumePeriod[]>
  >;
  readonly turnover24Hours?: QuoteTurnoverSeries;
}

export type RelativeVolumeHistoryRequirement = {
  readonly kind: "anchor-periods";
  readonly lookbackBars: null;
  readonly requiredPeriods: number;
  readonly seedPolicy: "complete-anchor-periods";
  readonly convergence: "exact-after-complete-periods";
};

export interface VolumeStudyParameters {
  "volume-24-hours": Record<never, never>;
  "klinger-oscillator": { fastLength: number; slowLength: number; signalLength: number };
  "relative-volume-at-time": {
    anchor: VolumeAnchorInterval;
    length: number;
    mode: (typeof calculationModes)[number];
  };
}

const period = (key: string, defaultValue: number, max = 10000) =>
  ({ key, defaultValue, type: "integer", min: 1, max }) as const;

function eachBarStartsPeriod(chartInterval: IntervalId | undefined, anchor: VolumeAnchorInterval) {
  const chartIndex = INTERVALS.findIndex((interval) => interval.id === chartInterval);
  const anchorIndex = INTERVALS.findIndex((interval) => interval.id === anchor);
  return chartIndex >= anchorIndex;
}

function durationMs(id: IntervalId): number | null {
  const interval = getInterval(id);
  return interval.kind === "native"
    ? NATIVE_TIMEFRAME_CONFIG[interval.id].ms
    : interval.minutes === undefined
      ? null
      : interval.minutes * 60_000;
}

const klinger = defineCatalogStudy<
  "klinger-oscillator",
  VolumeStudyParameters["klinger-oscillator"]
>({
  catalogId: "STD;Klinger%1Oscillator",
  definition: {
    schemaVersion: 1,
    id: "klinger-oscillator",
    title: "Klinger Volume Oscillator (original formula)",
    shortTitle: "KVO",
    status: "computed",
    defaultPane: "pane",
    parameters: [period("fastLength", 34), period("slowLength", 55), period("signalLength", 13)],
    outputs: [
      { id: "oscillator", title: "KVO", kind: "line", color: "#2962ff" },
      { id: "signal", title: "Signal", kind: "line", color: "#c17820" }
    ],
    levels: [0],
    references: ["https://nexusfi.com/attachments/255238d1536854261"]
  },
  history: () => ({
    warmupBars: 2,
    historyRequirement: {
      kind: "recursive",
      lookbackBars: null,
      seedBars: 2,
      seedPolicy: "first-value-ema-chain",
      convergence: "full-input-dependent"
    }
  }),
  calculate: klingerOscillator
});

type RelativeParams = VolumeStudyParameters["relative-volume-at-time"];

function utcPeriod(timestamp: number, anchor: VolumeAnchorInterval) {
  if (anchor === "1w" || anchor === "1M") return candleCalendarPeriod(timestamp, anchor);
  const interval = getInterval(anchor);
  if (interval.kind === "derived" && interval.months !== undefined) {
    const date = new Date(timestamp);
    const month = Math.floor(date.getUTCMonth() / interval.months) * interval.months;
    return {
      start: Date.UTC(date.getUTCFullYear(), month, 1),
      end: Date.UTC(date.getUTCFullYear(), month + interval.months, 1)
    };
  }
  const duration = durationMs(anchor)!;
  const start = Math.floor(timestamp / duration) * duration;
  return { start, end: start + duration };
}

function cryptoBarDuration(
  context: TechnicalCalculationContext | undefined,
  anchor: VolumeAnchorInterval
): number | null {
  if (
    context?.exchangeTimeZone !== "UTC" ||
    context.continuousSession !== true ||
    !context.chartInterval
  )
    return null;
  const chartStep = durationMs(context.chartInterval);
  const anchorStep = durationMs(anchor) ?? DAY_MS;
  // A chart bar that can straddle an anchor cannot supply volume for that anchor.
  return chartStep && chartStep <= DAY_MS && anchorStep % chartStep === 0 ? chartStep : null;
}

function contiguousCryptoPeriods(
  bars: readonly TechnicalBar[],
  anchor: VolumeAnchorInterval,
  chartStep: number
): RelativeVolumePeriod[] {
  type Group = {
    anchorTimestamp: number;
    hasAnchorCoverage: boolean;
    bars: TechnicalBar[];
    end: number;
  };
  const periods: RelativeVolumePeriod[] = [];
  let group: Group | undefined;
  for (const bar of bars) {
    const { start, end } = utcPeriod(bar.timestamp, anchor);
    if (group?.anchorTimestamp !== start) {
      if (group) {
        group.hasAnchorCoverage &&= group.bars.at(-1)!.timestamp + chartStep === group.end;
        // One unavailable predecessor is enough to prevent an average bridging any size gap.
        if (start > group.end)
          periods.push({ anchorTimestamp: group.end, hasAnchorCoverage: false, bars: [] });
      }
      group = { anchorTimestamp: start, hasAnchorCoverage: true, bars: [], end };
      periods.push(group);
    }
    group.hasAnchorCoverage &&= bar.timestamp === start + chartStep * group.bars.length;
    group.bars.push(bar);
  }
  return periods;
}

const relative = defineCatalogStudy<"relative-volume-at-time", RelativeParams>({
  catalogId: "STD;Relative%1Volume%1at%1Time",
  definition: {
    schemaVersion: 1,
    id: "relative-volume-at-time",
    title: "Relative Volume at Time",
    shortTitle: "Rel Vol",
    status: "computed",
    defaultPane: "pane",
    parameters: [
      { key: "anchor", type: "choice", defaultValue: "1d", choices: anchors },
      period("length", 10, 500),
      {
        key: "mode",
        type: "choice",
        defaultValue: "cumulative",
        choices: calculationModes
      }
    ],
    outputs: [{ id: "value", title: "Relative Volume", kind: "histogram", color: "#396bce" }],
    levels: [1],
    references: [
      "https://www.tradingview.com/support/solutions/43000705489-relative-volume-at-time/"
    ]
  },
  history: ({ length }) => ({
    warmupBars: length + 1,
    historyRequirement: {
      kind: "anchor-periods",
      lookbackBars: null,
      requiredPeriods: length + 1,
      seedPolicy: "complete-anchor-periods",
      convergence: "exact-after-complete-periods"
    }
  }),
  unavailableReason: (barCount, { anchor, length }, context) => {
    const everyBar = eachBarStartsPeriod(context?.chartInterval, anchor);
    const supplied = context?.volumeStudies?.relativeVolumePeriods?.[anchor];
    const samples = everyBar
      ? barCount * 2
      : (supplied?.reduce((count, period) => count + period.bars.length + 1, 0) ??
        (cryptoBarDuration(context, anchor) ? barCount * 2 : undefined));
    if (samples === undefined) return "volume-unavailable";
    return samples * length > MAX_RELATIVE_VOLUME_VISITS ? "calculation-limit" : undefined;
  },
  calculate: (bars, { anchor, length, mode }, context) => {
    if (eachBarStartsPeriod(context?.chartInterval, anchor)) {
      const periods = bars.map((bar) => ({
        anchorTimestamp: bar.timestamp,
        hasAnchorCoverage: true,
        bars: [bar]
      }));
      return { value: relativeVolumeAtTime(periods, { length, mode }) };
    }
    const chartStep = cryptoBarDuration(context, anchor);
    const periods =
      context?.volumeStudies?.relativeVolumePeriods?.[anchor] ??
      (chartStep ? contiguousCryptoPeriods(bars, anchor, chartStep) : undefined);
    if (!periods) return { value: bars.map(() => null) };
    const values = relativeVolumeAtTime(periods, { length, mode });
    const byTimestamp = new Map<number, (typeof values)[number]>();
    let index = 0;
    for (const period of periods)
      for (const bar of period.bars) byTimestamp.set(bar.timestamp, values[index++]!);
    return { value: bars.map(({ timestamp }) => byTimestamp.get(timestamp) ?? null) };
  }
});

const turnover = defineCatalogStudy<"volume-24-hours", VolumeStudyParameters["volume-24-hours"]>({
  catalogId: "STD;24h%Volume",
  definition: {
    schemaVersion: 1,
    id: "volume-24-hours",
    title: "24-hour Quote Turnover",
    shortTitle: "24H vol",
    status: "computed",
    defaultPane: "pane",
    parameters: [],
    outputs: [{ id: "value", title: "Quote turnover", kind: "line", color: "#396bce" }],
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000668584-24-hour-volume/",
      "https://bybit-exchange.github.io/docs/v5/market/kline",
      "https://app.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks-history"
    ]
  },
  history: () => ({
    warmupBars: 1,
    historyRequirement: {
      kind: "rolling-time-window",
      lookbackBars: null,
      windowMs: TURNOVER_DAY,
      seedPolicy: "complete-lower-candle-coverage",
      convergence: "exact-after-complete-window"
    }
  }),
  unavailableReason: (_barCount, _params, context) =>
    context?.volumeStudies?.turnover24Hours ? undefined : "volume-unavailable",
  calculate: (bars, _params, context) => ({
    value: readQuoteTurnover(context?.volumeStudies?.turnover24Hours, bars, context?.chartInterval)
  })
});

export const volumeStudies = [klinger, relative, turnover] as const;
