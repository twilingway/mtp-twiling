import { shiftTimeframe } from "../../intervals/calendar.js";
import { isNativeIntervalId } from "../../intervals/registry.js";
import type { IntervalId } from "../../intervals/registry.js";
import { autoKeyLevelsForPeriod } from "../ta-batch-fib-key-levels.js";
import type { PricePeriod } from "../ta-batch-pivots-periods.js";
import type { ParameterDefinition, TechnicalBar, TechnicalCalculationContext } from "../types.js";
import type { TechnicalPriceRegion } from "./calendar-geometry.js";
import { defineCatalogStudy } from "./contract.js";
import {
  priceLevelCalendarPeriod,
  resolvePriceLevelInterval,
  shiftPriceLevelCalendarStart
} from "./level-periods.js";
import type { NativePriceLevelInterval, PriceLevelHistoryRequest } from "./level-periods.js";
import { priceVolumeProfile } from "./price-volume-history.js";
import type { PriceVolumeRange, PriceVolumeTradeHistory } from "./price-volume-history.js";

const groups = [
  { id: "previousDay", interval: "1d", prefix: "pd", color: "#8E8051", previous: true },
  { id: "currentDay", interval: "1d", prefix: "d", color: "#C99B3F", previous: false },
  { id: "previousWeek", interval: "1w", prefix: "pw", color: "#597E9E", previous: true },
  { id: "currentWeek", interval: "1w", prefix: "w", color: "#3686CA", previous: false },
  { id: "previousMonth", interval: "1M", prefix: "pm", color: "#825E93", previous: true },
  { id: "currentMonth", interval: "1M", prefix: "m", color: "#9A61C4", previous: false },
  { id: "custom", interval: "1d", prefix: "Custom ", color: "#4F997A", previous: false }
] as const;
type Group = (typeof groups)[number];
type GroupMode = "off" | "ohlc" | "profile" | "both";
type KeyLevelsParameters = Record<Group["id"], GroupMode> & {
  showOpen: boolean;
  showHigh: boolean;
  showLow: boolean;
  showClose: boolean;
  showPoc: boolean;
  showVal: boolean;
  showVah: boolean;
  anchor: NativePriceLevelInterval;
  customLength: number;
  levelsStart: "period" | "current-bar";
};
export interface AutoKeyLevelStudyParameters {
  "auto-key-levels": KeyLevelsParameters;
}
export interface AutoKeyLevelCalculationInputs {
  readonly autoKeyLevelTrades?: PriceVolumeTradeHistory;
}
type KeyLevelContext = TechnicalCalculationContext & AutoKeyLevelCalculationInputs;
export type AutoKeyLevelSelection = {
  definitionId: "auto-key-levels";
  params: KeyLevelsParameters;
  visible: boolean;
};

interface Window extends PriceVolumeRange {
  readonly group: Group;
  readonly interval: NativePriceLevelInterval;
  readonly includePrices: boolean;
  readonly includeProfile: boolean;
}

function windows(params: KeyLevelsParameters, chartInterval: IntervalId, last: number): Window[] {
  return groups.flatMap((group) => {
    const mode = params[group.id];
    const interval = group.id === "custom" ? params.anchor : group.interval;
    if (mode === "off" || !resolvePriceLevelInterval(chartInterval, interval, "multi-time-period"))
      return [];
    const { start, end } = priceLevelCalendarPeriod(last, interval);
    const from =
      group.id === "custom"
        ? shiftTimeframe(last, interval, -params.customLength)
        : group.previous
          ? shiftPriceLevelCalendarStart(start, interval, -1)
          : start;
    return from < 0
      ? []
      : [
          {
            group,
            interval,
            from,
            to: group.previous ? start : end,
            includePrices:
              (mode === "ohlc" || mode === "both") &&
              (params.showOpen || params.showHigh || params.showLow || params.showClose),
            includeProfile:
              (mode === "profile" || mode === "both") &&
              (params.showPoc || params.showVal || params.showVah)
          }
        ];
  });
}

export function autoKeyLevelPriceRequests(
  instances: readonly AutoKeyLevelSelection[],
  chartInterval: IntervalId,
  last: number | undefined
): PriceLevelHistoryRequest[] {
  if (last === undefined) return [];
  const needed = new Map<NativePriceLevelInterval, PriceLevelHistoryRequest>();
  for (const { params, visible } of instances) {
    if (!visible) continue;
    for (const window of windows(params, chartInterval, last)) {
      if (!window.includePrices || window.group.id === "custom") continue;
      const existing = needed.get(window.interval);
      const from = Math.min(existing?.from ?? Infinity, window.from);
      needed.set(window.interval, {
        interval: window.interval,
        from,
        to: last,
        precedingTradingPeriods: 1
      });
    }
  }
  return [...needed.values()];
}

export function autoKeyLevelTradeRange(
  instances: readonly AutoKeyLevelSelection[],
  chartInterval: IntervalId,
  last: number | undefined,
  asOf: number
): PriceVolumeRange | null {
  if (last === undefined || !isNativeIntervalId(chartInterval) || asOf <= last) return null;
  const cutoff = Math.min(asOf, shiftTimeframe(last, chartInterval, 1));
  let from = Infinity,
    to = -Infinity;
  for (const { params, visible } of instances) {
    if (!visible) continue;
    for (const window of windows(params, chartInterval, last)) {
      if (!window.includeProfile) continue;
      from = Math.min(from, window.from);
      to = Math.max(to, Math.min(cutoff, window.to));
    }
  }
  return from < to ? { from, to } : null;
}

function firstBar(bars: readonly TechnicalBar[], time: number): number {
  let left = 0,
    right = bars.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (bars[mid]!.timestamp < time) left = mid + 1;
    else right = mid;
  }
  return left;
}

function chartPeriodPrices(
  bars: readonly TechnicalBar[],
  window: Window,
  context: KeyLevelContext
): Pick<PricePeriod, "open" | "high" | "low" | "close"> | null {
  const chartInterval = context.chartInterval;
  if (!isNativeIntervalId(chartInterval)) return null;
  const begin = firstBar(bars, window.from);
  const end = firstBar(bars, window.to);
  const subset = bars.slice(begin, end);
  if (subset[0]?.timestamp !== window.from) return null;
  if (
    !context.continuousSession &&
    (chartInterval !== window.interval || subset.length !== 1 || window.group.id === "custom")
  )
    return null;
  for (let i = 1; i < subset.length; i++)
    if (shiftTimeframe(subset[i - 1]!.timestamp, chartInterval, 1) !== subset[i]!.timestamp)
      return null;
  if (
    window.group.previous &&
    shiftTimeframe(subset.at(-1)!.timestamp, chartInterval, 1) !== window.to
  )
    return null;
  return autoKeyLevelsForPeriod(subset).prices;
}

function periodPrices(bars: readonly TechnicalBar[], window: Window, context: KeyLevelContext) {
  const periods =
    window.group.id !== "custom" ? context.priceLevelPeriods?.[window.interval] : undefined;
  const exact = periods?.find(
    (period) => priceLevelCalendarPeriod(period.startsAt, window.interval).start === window.from
  );
  const currentIndex = window.group.previous
    ? (periods?.findIndex(
        (period) => priceLevelCalendarPeriod(period.startsAt, window.interval).start === window.to
      ) ?? -1)
    : -1;
  const previousSession =
    currentIndex > 0 && periods?.[currentIndex]?.followsPrevious
      ? periods[currentIndex - 1]
      : undefined;
  // The chart may have a fresher candle in the current bucket than the supplemental read.
  const chart = chartPeriodPrices(bars, window, context);
  return chart ? { ...chart, startsAt: window.from } : (exact ?? previousSession ?? null);
}

const levels = [
  { id: "O", field: "open", flag: "showOpen" },
  { id: "H", field: "high", flag: "showHigh" },
  { id: "L", field: "low", flag: "showLow" },
  { id: "C", field: "close", flag: "showClose" },
  { id: "POC", field: "poc", flag: "showPoc" },
  { id: "VAL", field: "val", flag: "showVal" },
  { id: "VAH", field: "vah", flag: "showVah" }
] as const;

function regions(
  bars: readonly TechnicalBar[],
  params: KeyLevelsParameters,
  context?: KeyLevelContext
): TechnicalPriceRegion[] {
  const last = bars.at(-1)?.timestamp;
  const chartInterval = context?.chartInterval;
  if (!context || last === undefined || !isNativeIntervalId(chartInterval)) return [];
  const chartEnd = shiftTimeframe(last, chartInterval, 1);
  const history = context.autoKeyLevelTrades;
  return windows(params, chartInterval, last).flatMap((window) => {
    const prices = window.includePrices ? periodPrices(bars, window, context) : null;
    const until = window.group.previous
      ? window.to
      : Math.min(chartEnd, window.to, history?.coverage?.to ?? 0);
    const profile =
      window.includeProfile && (window.group.previous || until > last)
        ? autoKeyLevelsForPeriod(
            [],
            priceVolumeProfile(history, { from: window.from, to: until }, context.priceStep)
          ).profile
        : null;
    const values = { ...prices, ...profile } as Partial<
      Record<(typeof levels)[number]["field"], number | null>
    >;
    const startTimestamp =
      params.levelsStart === "current-bar"
        ? last
        : (bars[firstBar(bars, prices?.startsAt ?? window.from)]?.timestamp ?? last);
    return levels.flatMap(({ id, field, flag }): TechnicalPriceRegion[] => {
      const value = values[field];
      if (!params[flag] || value == null || !Number.isFinite(value)) return [];
      return [
        {
          styleId: window.group.id,
          startTimestamp,
          endTimestamp: null,
          startEdge: "center",
          endEdge: "center",
          low: value,
          high: value,
          labelEdge: "right",
          label: { name: `${window.group.prefix}${id}` }
        }
      ];
    });
  });
}

export const autoKeyLevelStudies = [
  defineCatalogStudy<"auto-key-levels", KeyLevelsParameters>({
    catalogId: "STD;Auto_Key_Levels",
    definition: {
      id: "auto-key-levels",
      schemaVersion: 1,
      status: "computed",
      defaultPane: "overlay",
      title: "Автоматические ключевые уровни",
      shortTitle: "Ключевые уровни",
      parameters: [
        ...groups.map(({ id }): ParameterDefinition => ({
          key: id,
          type: "choice",
          choices: ["off", "ohlc", "profile", "both"],
          defaultValue: id === "currentDay" || id === "previousDay" ? "both" : "off"
        })),
        ...levels.map(({ flag }): ParameterDefinition => ({
          key: flag,
          type: "boolean",
          defaultValue: true
        })),
        { key: "anchor", type: "choice", defaultValue: "1w", choices: ["1d", "1w", "1M"] },
        { key: "customLength", type: "integer", defaultValue: 2, min: 1, max: 90 },
        {
          key: "levelsStart",
          type: "choice",
          defaultValue: "period",
          choices: ["period", "current-bar"]
        }
      ],
      outputs: [],
      levels: [],
      priceRegionStyles: groups.map(({ id, prefix, color }) => ({
        id,
        title: prefix.trim(),
        color,
        opacity: 1
      })),
      references: [
        "https://www.tradingview.com/support/solutions/43000783958-auto-key-levels/",
        "https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/"
      ]
    },
    history: () => ({
      warmupBars: 1,
      historyRequirement: {
        kind: "event-history",
        lookbackBars: null,
        seedBars: 1,
        seedPolicy: "external-native-periods",
        convergence: "full-input-dependent"
      }
    }),
    calculate: () => ({}),
    priceRegions: regions
  })
] as const;
