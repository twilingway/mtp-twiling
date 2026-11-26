import type { IntervalId } from "../../intervals/registry.js";
import type {
  MultiTimePeriodMode,
  PricePeriod,
  StandardPivotMethod
} from "../ta-batch-pivots-periods.js";
import type { ParameterDefinition, TechnicalCalculationContext } from "../types.js";
import { defineCatalogStudy } from "./contract.js";
import {
  chartPriceLevelPeriods,
  heikinAshiPriceLevelPeriods,
  multiTimePeriodRegions,
  priceLevelHistoryRequest,
  resolvePriceLevelInterval,
  standardPivotRegions
} from "./level-periods.js";
import type {
  PriceLevelHistoryRequest,
  PriceLevelInterval,
  PriceLevelPeriodData,
  PriceLevelStudyKind,
  PriceLevelTimeframe
} from "./level-periods.js";

const priceTimeframes = ["1d", "1w", "1M", "3M", "6M", "12M"] as const;
const pivotMethods = ["traditional", "fibonacci", "woodie", "classic", "dm", "camarilla"] as const;
const boxModes = ["high-low", "open-close", "ohlc", "true-range"] as const;

export interface PeriodStudyParameters {
  "pivot-points-standard": {
    method: StandardPivotMethod;
    timeframe: PriceLevelTimeframe;
    useDailyBased: boolean;
    periodsBack: number;
    showLabels: boolean;
    showPrices: boolean;
    labelSide: "Left" | "Right";
  };
  "multi-time-period-charts": {
    autoTimeframe: boolean;
    timeframe: PriceLevelInterval;
    calculation: MultiTimePeriodMode;
    useDailyBased: boolean;
    heikinAshi: boolean;
  };
}

export interface PriceLevelCalculationInputs {
  readonly priceLevelPeriods?: PriceLevelPeriodData;
}

export type PeriodStudyHistoryRequirement = {
  kind: "event-history";
  lookbackBars: null;
  seedBars: number;
  seedPolicy: "external-native-periods" | "heikin-ashi-period-seed";
  convergence: "full-input-dependent";
};

export type PriceLevelStudySelection = {
  [Id in keyof PeriodStudyParameters]: {
    definitionId: Id;
    params: PeriodStudyParameters[Id];
    visible: boolean;
  };
}[keyof PeriodStudyParameters];

type CalculationContext = TechnicalCalculationContext & PriceLevelCalculationInputs;

function describe(selection: PriceLevelStudySelection): {
  kind: PriceLevelStudyKind;
  timeframe: PriceLevelTimeframe;
  precedingTradingPeriods: number;
} {
  if (selection.definitionId === "pivot-points-standard")
    return {
      kind: "standard-pivots",
      timeframe: selection.params.timeframe,
      precedingTradingPeriods: 1
    };
  const { autoTimeframe, timeframe, heikinAshi, useDailyBased } = selection.params;
  return {
    kind: "multi-time-period",
    timeframe: autoTimeframe ? "auto" : timeframe,
    precedingTradingPeriods: heikinAshi && useDailyBased ? 20 : 1
  };
}

export function priceLevelRequests(
  instances: readonly PriceLevelStudySelection[],
  chartInterval: IntervalId,
  timestamps: readonly number[]
): PriceLevelHistoryRequest[] {
  const requests = new Map<PriceLevelInterval, PriceLevelHistoryRequest>();
  for (const instance of instances) {
    if (!instance.visible) continue;
    const { kind, timeframe, precedingTradingPeriods } = describe(instance);
    const request = priceLevelHistoryRequest(chartInterval, timeframe, timestamps, kind);
    if (
      request &&
      precedingTradingPeriods > (requests.get(request.interval)?.precedingTradingPeriods ?? 0)
    )
      requests.set(request.interval, { ...request, precedingTradingPeriods });
  }
  return [...requests.values()];
}

function resolvedSource(
  kind: PriceLevelStudyKind,
  timeframe: PriceLevelTimeframe,
  context?: CalculationContext
): readonly PricePeriod[] | undefined {
  const chartInterval = context?.chartInterval;
  if (!chartInterval) return undefined;
  const sourceInterval = resolvePriceLevelInterval(chartInterval, timeframe, kind);
  return sourceInterval ? context.priceLevelPeriods?.[sourceInterval] : undefined;
}

function studyHistory(seedBars: number, heikinAshi = false) {
  const historyRequirement: PeriodStudyHistoryRequirement = {
    kind: "event-history",
    lookbackBars: null,
    seedBars,
    seedPolicy: heikinAshi ? "heikin-ashi-period-seed" : "external-native-periods",
    convergence: "full-input-dependent"
  };
  return { warmupBars: seedBars, historyRequirement };
}

const toggle = (key: string, defaultValue: boolean): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue
});
const pivotStyles = ["P", "S1", "R1", "S2", "R2", "S3", "R3", "S4", "R4", "S5", "R5"].map((id) => ({
  id,
  title: id,
  color: "#bd741b",
  opacity: 1
}));
const areaStyles = ["high-low", "open-close", "true-range"].flatMap((range) => [
  { id: `${range}-up`, title: `${range} · Рост`, color: "#008478", opacity: 0.3 },
  { id: `${range}-down`, title: `${range} · Снижение`, color: "#c43e48", opacity: 0.3 }
]);

export const periodStudies = [
  defineCatalogStudy<"pivot-points-standard", PeriodStudyParameters["pivot-points-standard"]>({
    catalogId: "STD;Pivot%1Points%1Standard",
    definition: {
      id: "pivot-points-standard",
      schemaVersion: 1,
      status: "computed",
      title: "Стандартные опорные уровни",
      shortTitle: "Опорные уровни",
      defaultPane: "overlay",
      parameters: [
        { key: "method", type: "choice", defaultValue: "traditional", choices: pivotMethods },
        {
          key: "timeframe",
          type: "choice",
          defaultValue: "auto",
          choices: ["auto", ...priceTimeframes]
        },
        toggle("useDailyBased", true),
        { key: "periodsBack", type: "integer", defaultValue: 15, min: 1, max: 200 },
        toggle("showLabels", true),
        toggle("showPrices", true),
        { key: "labelSide", type: "choice", defaultValue: "Left", choices: ["Left", "Right"] }
      ],
      outputs: [],
      levels: [],
      priceRegionStyles: pivotStyles,
      references: [
        "https://www.tradingview.com/support/solutions/43000521824-pivot-points-standard/",
        "https://pine-facade.tradingview.com/pine-facade/get/STD%3BPivot%251Points%251Standard/24.0"
      ]
    },
    history: () => studyHistory(2),
    unavailableReason: (_, { timeframe }, context) =>
      resolvedSource("standard-pivots", timeframe, context)?.length
        ? undefined
        : "external-data-unavailable",
    calculate: () => ({}),
    priceRegions: (bars, { timeframe, useDailyBased, labelSide, ...display }, context) => {
      const source = resolvedSource("standard-pivots", timeframe, context);
      if (!source?.length) return [];
      const periods = useDailyBased ? source : chartPriceLevelPeriods(bars, source);
      return standardPivotRegions(
        bars.map(({ timestamp }) => timestamp),
        periods,
        {
          ...display,
          labelSide: labelSide === "Left" ? "left" : "right"
        }
      );
    }
  }),
  defineCatalogStudy<"multi-time-period-charts", PeriodStudyParameters["multi-time-period-charts"]>(
    {
      catalogId: "STD;Multi-Time%Period%Charts",
      definition: {
        id: "multi-time-period-charts",
        schemaVersion: 1,
        status: "computed",
        title: "График старшего интервала",
        shortTitle: "MTPC",
        defaultPane: "overlay",
        parameters: [
          toggle("autoTimeframe", true),
          { key: "timeframe", type: "choice", defaultValue: "1M", choices: priceTimeframes },
          { key: "calculation", type: "choice", defaultValue: "high-low", choices: boxModes },
          toggle("heikinAshi", false),
          toggle("useDailyBased", false)
        ],
        outputs: [],
        levels: [],
        priceRegionStyles: areaStyles,
        references: [
          "https://www.tradingview.com/support/solutions/43000502591-multi-time-period-charts-indicator/",
          "https://pine-facade.tradingview.com/pine-facade/get/STD%3BMulti-Time%25Period%25Charts/17.0"
        ]
      },
      history: ({ heikinAshi, calculation }) =>
        studyHistory(calculation === "true-range" ? 2 : 1, heikinAshi),
      unavailableReason: (_, { autoTimeframe, timeframe }, context) =>
        resolvedSource("multi-time-period", autoTimeframe ? "auto" : timeframe, context)?.length
          ? undefined
          : "external-data-unavailable",
      calculate: () => ({}),
      priceRegions: (
        bars,
        { autoTimeframe, timeframe, calculation, heikinAshi, useDailyBased },
        context
      ) => {
        const source = resolvedSource(
          "multi-time-period",
          autoTimeframe ? "auto" : timeframe,
          context
        );
        if (!source?.length) return [];
        const periods = useDailyBased ? source : chartPriceLevelPeriods(bars, source);
        return multiTimePeriodRegions(
          bars.map(({ timestamp }) => timestamp),
          heikinAshi ? heikinAshiPriceLevelPeriods(periods) : periods,
          calculation
        );
      }
    }
  )
] as const;
