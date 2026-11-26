import type { ParameterDefinition } from "../types.js";
import {
  calendarList,
  performancePeriodDays,
  seasonalProjectionRegions
} from "./calendar-analysis-data.js";
import { defineCatalogStudy } from "./contract.js";

const positions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
type CalendarTablePosition = (typeof positions)[number];

export interface PerformanceStudyParameters {
  includeChartSymbol: boolean;
  comparisonSymbols: string;
  comparisonPeriods: string;
  intensityCutoff: number;
  tablePosition: CalendarTablePosition;
}

export interface SeasonalityStudyParameters {
  startYear: number;
  ignoredMonths: string;
  intensityCutoff: number;
  tablePosition: CalendarTablePosition;
  showAverages: boolean;
  showDeviation: boolean;
  showPercentPositive: boolean;
  showProjections: boolean;
}

export interface CalendarAnalysisParameters {
  performance: PerformanceStudyParameters;
  seasonality: SeasonalityStudyParameters;
}

const colorStyles = [
  { id: "positive", title: "Рост", color: "#29a38c", opacity: 0.25 },
  { id: "negative", title: "Снижение", color: "#c94e6d", opacity: 0.25 }
] as const;

const flag = (key: string, defaultValue: boolean): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue
});
const text = (key: string, defaultValue: string, maxLength: number): ParameterDefinition => ({
  key,
  type: "text",
  defaultValue,
  maxLength
});
const cutoff: ParameterDefinition = {
  key: "intensityCutoff",
  type: "number",
  min: 0.1,
  max: 1000,
  defaultValue: 10
};
const position = (defaultValue: CalendarTablePosition): ParameterDefinition => ({
  key: "tablePosition",
  type: "choice",
  defaultValue,
  choices: positions
});
const warmup = () => ({
  warmupBars: 1,
  historyRequirement: {
    kind: "finite" as const,
    lookbackBars: 1,
    seedPolicy: "window" as const,
    convergence: "exact-after-lookback" as const
  }
});

export const calendarAnalysisStudies = [
  defineCatalogStudy<"performance", PerformanceStudyParameters>({
    catalogId: "STD;Performance",
    definition: {
      schemaVersion: 1,
      id: "performance",
      title: "Динамика",
      shortTitle: "Performance",
      status: "computed",
      defaultPane: "overlay",
      parameters: [
        flag("includeChartSymbol", true),
        text("comparisonSymbols", "", 600),
        text("comparisonPeriods", "1D, 1W, 1M, 3M, YTD, 1Y", 90),
        cutoff,
        position("top-right")
      ],
      outputs: [],
      levels: [],
      references: ["https://www.tradingview.com/support/solutions/43000736064-performance/"],
      priceRegionStyles: colorStyles
    },
    validParams(params) {
      const symbols = calendarList(params.comparisonSymbols);
      const periods = calendarList(params.comparisonPeriods.toUpperCase());
      return (
        (params.includeChartSymbol || symbols.length > 0) &&
        symbols.length <= 10 &&
        symbols.every((symbol) => /^[A-Z0-9._:@/-]{1,100}$/i.test(symbol)) &&
        periods.length > 0 &&
        periods.length <= 12 &&
        periods.every((period) => performancePeriodDays(period) !== undefined)
      );
    },
    history: warmup,
    calculate: () => ({})
  }),
  defineCatalogStudy<"seasonality", SeasonalityStudyParameters>({
    catalogId: "STD;Seasonality",
    definition: {
      schemaVersion: 1,
      id: "seasonality",
      title: "Сезонный анализ",
      shortTitle: "Seasonality",
      status: "computed",
      defaultPane: "overlay",
      parameters: [
        { key: "startYear", type: "integer", min: 1900, max: 2200, defaultValue: 2000 },
        text("ignoredMonths", "", 360),
        cutoff,
        position("bottom-left"),
        flag("showAverages", true),
        flag("showDeviation", true),
        flag("showPercentPositive", true),
        flag("showProjections", true)
      ],
      outputs: [],
      levels: [],
      references: ["https://www.tradingview.com/support/solutions/43000723025-seasonality/"],
      priceRegionStyles: colorStyles
    },
    validParams: ({ ignoredMonths }) =>
      calendarList(ignoredMonths).every((value) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)),
    history: warmup,
    calculate: () => ({}),
    priceRegions(bars, params, context) {
      const seasonalityHistory = context?.seasonalityHistory;
      return params.showProjections && seasonalityHistory
        ? seasonalProjectionRegions(bars, seasonalityHistory, {
            startYear: params.startYear,
            ignoredMonths: calendarList(params.ignoredMonths)
          })
        : [];
    }
  })
] as const;
