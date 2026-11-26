import {
  MAX_CHANNEL_AVERAGE_BARS,
  MAX_DIRECT_WINDOW_OPERATIONS
} from "../channel-average/inputs.js";
import { priceSource } from "../data.js";
import type { PresentationPlot } from "../presentation-types.js";
import { rankCorrelationIndex, rankCorrelationRibbon } from "../ta-batch-trend-rank.js";
import type { RankCorrelationSmoothing } from "../ta-batch-trend-rank.js";
import { linearRegressionChannel, trendStrengthIndex } from "../ta-batch-trend-regression.js";
import {
  chopZone,
  massIndex,
  pringSpecialK,
  SPECIAL_K_WARMUP,
  ulcerIndex
} from "../ta-batch-trend-volatility.js";
import type {
  LegacyRecursiveHistoryRequirement,
  ParameterDefinition,
  PriceSource,
  TechnicalBar,
  TechnicalHistoryRequirement,
  TechnicalOutputDefinition
} from "../types.js";
import { defineCatalogStudy } from "./contract.js";

const rciSmoothingTypes = [
  "None",
  "SMA",
  "SMA + Bollinger Bands",
  "EMA",
  "SMMA (RMA)",
  "WMA",
  "VWMA"
] as const;
type PriceParameters = { source: PriceSource };
type LengthParameters = { length: number };
export interface TrendStudyParameters {
  "trend-strength-index": LengthParameters;
  "linear-regression-channel": PriceParameters &
    LengthParameters & {
      useUpperDeviation: boolean;
      upperDeviation: number;
      useLowerDeviation: boolean;
      lowerDeviation: number;
    };
  "mass-index": { emaLength: number; sumLength: number };
  "ulcer-index": PriceParameters & LengthParameters;
  "pring-special-k": PriceParameters & { firstSignalLength: number; secondSignalLength: number };
  "chop-zone": Record<string, never>;
  "rank-correlation-index": PriceParameters &
    LengthParameters & {
      maType: (typeof rciSmoothingTypes)[number];
      maLength: number;
      bbMultiplier: number;
    };
  "rci-ribbon": PriceParameters & { shortLength: number; middleLength: number; longLength: number };
}

export type RankCorrelationWindowHistory = {
  kind: "finite-observation-window";
  lookbackBars: null;
  denseLookbackBars: number;
  knownObservations: number;
  seedPolicy: "rci-positional-window;last-known-average";
  convergence: "sparse-full-input-dependent";
};

const source: ParameterDefinition = { key: "source", type: "source", defaultValue: "close" };
const period = (key: string, defaultValue: number, min = 1): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min,
  max: 10000
});
const deviation = (key: string): ParameterDefinition => ({
  key,
  type: "number",
  defaultValue: 2,
  min: 0,
  max: 100
});
const enabled = (key: string): ParameterDefinition => ({
  key,
  type: "boolean",
  defaultValue: true
});
const line = (id: string, title: string, color = "#2962ff"): TechnicalOutputDefinition => ({
  id,
  title,
  kind: "line",
  color
});
const linePlot = ({ id, color }: TechnicalOutputDefinition): PresentationPlot => ({
  id,
  seriesKey: id,
  geometry: { kind: "line", gaps: "break" },
  color: { kind: "solid", color },
  width: 1
});
const finiteHistory = (lookbackBars: number, warmupBars = lookbackBars) => ({
  warmupBars,
  historyRequirement: {
    kind: "finite" as const,
    lookbackBars,
    seedPolicy: "window" as const,
    convergence: "exact-after-lookback" as const
  }
});
function recursiveHistory(
  warmupBars: number,
  seedBars: number,
  seedPolicy: LegacyRecursiveHistoryRequirement["seedPolicy"]
) {
  return {
    warmupBars,
    historyRequirement: {
      kind: "recursive" as const,
      lookbackBars: null,
      seedBars,
      seedPolicy,
      convergence: "full-input-dependent" as const
    }
  };
}

function windowWork(barCount: number, period: number): number {
  return Math.max(0, barCount - period + 1) * period;
}
function chartLimit(barCount: number, work = 0) {
  return barCount > MAX_CHANNEL_AVERAGE_BARS || work > MAX_DIRECT_WINDOW_OPERATIONS
    ? "calculation-limit"
    : undefined;
}
const rankWork = (barCount: number, period: number): number =>
  windowWork(barCount, period) * (1 + Math.ceil(Math.log2(period)));

const trendStrength = line("value", "Trend Strength Index");
const regressionOutputs = [
  line("center", "Regression"),
  line("upper", "Upper channel", "#168755"),
  line("lower", "Lower channel", "#d14343")
];
const rankLevels = [-80, 0, 80];
const chopColors = [
  "#a21d4d",
  "#c9314b",
  "#d95649",
  "#b67c23",
  "#c19822",
  "#65982e",
  "#279b68",
  "#16875d",
  "#169a9f"
];
const rciOutputs = [
  line("rci", "Rank Correlation Index"),
  line("average", "Smoothing", "#cb881c"),
  line("upper", "Upper Bollinger Band", "#168755"),
  line("lower", "Lower Bollinger Band", "#168755")
];

function rankSmoothing(
  bars: readonly TechnicalBar[],
  options: TrendStudyParameters["rank-correlation-index"]
): RankCorrelationSmoothing {
  const length = options.maLength;
  switch (options.maType) {
    case "None":
      return { kind: "none" };
    case "SMA":
      return { kind: "sma", length };
    case "SMA + Bollinger Bands":
      return { kind: "sma-bollinger", length, multiplier: options.bbMultiplier };
    case "EMA":
      return { kind: "ema", length };
    case "SMMA (RMA)":
      return { kind: "rma", length };
    case "WMA":
      return { kind: "wma", length };
    case "VWMA":
      return { kind: "vwma", length, volume: priceSource(bars, "volume") };
  }
}

function rankHistory({
  length,
  maType,
  maLength
}: TrendStudyParameters["rank-correlation-index"]): {
  warmupBars: number;
  historyRequirement: TechnicalHistoryRequirement;
} {
  const denseLookbackBars = length + maLength - 1;
  if (maType === "None") return finiteHistory(length);
  if (maType === "EMA") return recursiveHistory(length, length, "first-non-null");
  if (maType === "SMMA (RMA)")
    return recursiveHistory(length, denseLookbackBars, "sma-of-first-length");
  return {
    warmupBars: length,
    historyRequirement: {
      kind: "finite-observation-window",
      lookbackBars: null,
      denseLookbackBars,
      knownObservations: maLength,
      seedPolicy: "rci-positional-window;last-known-average",
      convergence: "sparse-full-input-dependent"
    }
  };
}

export const trendStudies = [
  defineCatalogStudy<"trend-strength-index", TrendStudyParameters["trend-strength-index"]>({
    catalogId: "STD;Trend%1Strength%1Index",
    definition: {
      schemaVersion: 1,
      id: "trend-strength-index",
      title: "Trend Strength Index",
      shortTitle: "Trend Strength",
      status: "computed",
      defaultPane: "pane",
      parameters: [period("length", 14, 2)],
      outputs: [trendStrength],
      levels: [-1, 0, 1],
      references: [
        "https://www.tradingview.com/support/solutions/43000730926-trend-strength-index/"
      ],
      presentation: {
        renderVersion: 2,
        precisionPolicy: "fixed-2",
        plots: [linePlot(trendStrength)],
        hiddenSeries: ["$zero"],
        constantSeries: [{ seriesKey: "$zero", value: 0 }],
        fills: [
          {
            id: "trendFill",
            fromSeries: "value",
            toSeries: "$zero",
            color: "#168755",
            belowColor: "#d14343",
            opacity: 0.19,
            gaps: "break"
          }
        ]
      }
    },
    history: ({ length }) => finiteHistory(length),
    unavailableReason: (barCount, { length }) => chartLimit(barCount, windowWork(barCount, length)),
    calculate: (bars, { length }) => ({
      value: trendStrengthIndex(priceSource(bars, "close"), length)
    })
  }),
  defineCatalogStudy<
    "linear-regression-channel",
    TrendStudyParameters["linear-regression-channel"]
  >({
    catalogId: "STD;Linear_Regression",
    definition: {
      schemaVersion: 1,
      id: "linear-regression-channel",
      title: "Linear Regression Channel",
      shortTitle: "LinReg Channel",
      status: "computed",
      defaultPane: "overlay",
      parameters: [
        source,
        period("length", 100, 2),
        enabled("useUpperDeviation"),
        deviation("upperDeviation"),
        enabled("useLowerDeviation"),
        deviation("lowerDeviation")
      ],
      outputs: regressionOutputs,
      levels: [],
      references: ["https://www.tradingview.com/support/solutions/43000644936-linear-regression/"],
      presentation: {
        renderVersion: 2,
        precisionPolicy: "native-price",
        plots: regressionOutputs.map(linePlot),
        hiddenSeries: [],
        fills: [
          {
            id: "upperChannel",
            fromSeries: "upper",
            toSeries: "center",
            color: "#168755",
            opacity: 0.12,
            gaps: "break"
          },
          {
            id: "lowerChannel",
            fromSeries: "center",
            toSeries: "lower",
            color: "#d14343",
            opacity: 0.12,
            gaps: "break"
          }
        ]
      }
    },
    history: ({ length }) => finiteHistory(length),
    unavailableReason: (barCount) => chartLimit(barCount),
    calculate: (bars, options) =>
      linearRegressionChannel(
        priceSource(bars, options.source),
        options.length,
        options.useUpperDeviation ? options.upperDeviation : null,
        options.useLowerDeviation ? options.lowerDeviation : null
      )
  }),
  defineCatalogStudy<"mass-index", TrendStudyParameters["mass-index"]>({
    catalogId: "STD;Mass%1Index",
    definition: {
      schemaVersion: 1,
      id: "mass-index",
      title: "Mass Index",
      shortTitle: "Mass Index",
      status: "computed",
      defaultPane: "pane",
      parameters: [period("emaLength", 9), period("sumLength", 25)],
      outputs: [line("value", "Mass Index")],
      levels: [26.5, 27],
      references: [
        "https://technical.traders.com/archive/display2.asp?mo=JUN&yr=1992",
        "https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/mass-index"
      ]
    },
    history: ({ sumLength }) => recursiveHistory(sumLength, 1, "first-value-ema-chain"),
    unavailableReason: (barCount) => chartLimit(barCount),
    calculate: (bars, { emaLength, sumLength }) => ({
      value: massIndex(bars, emaLength, sumLength)
    })
  }),
  defineCatalogStudy<"ulcer-index", TrendStudyParameters["ulcer-index"]>({
    catalogId: "STD;Ulcer_Index",
    definition: {
      schemaVersion: 1,
      id: "ulcer-index",
      title: "Ulcer Index",
      shortTitle: "Ulcer Index",
      status: "computed",
      defaultPane: "pane",
      parameters: [source, period("length", 14)],
      outputs: [line("value", "Ulcer Index")],
      levels: [],
      references: ["https://www.tradingview.com/support/solutions/43000773115-ulcer-index/"]
    },
    history: ({ length }) => finiteHistory(2 * length - 1),
    unavailableReason: (barCount) => chartLimit(barCount),
    calculate: (bars, options) => ({
      value: ulcerIndex(priceSource(bars, options.source), options.length)
    })
  }),
  defineCatalogStudy<"pring-special-k", TrendStudyParameters["pring-special-k"]>({
    catalogId: "STD;Prings_Special_K",
    definition: {
      schemaVersion: 1,
      id: "pring-special-k",
      title: "Pring’s Special K",
      shortTitle: "Special K",
      status: "computed",
      defaultPane: "pane",
      parameters: [source, period("firstSignalLength", 100), period("secondSignalLength", 100)],
      outputs: [line("specialK", "Special K"), line("signal", "Signal", "#cb881c")],
      levels: [0],
      references: ["https://www.tradingview.com/support/solutions/43000773011/"]
    },
    history: ({ firstSignalLength, secondSignalLength }) =>
      finiteHistory(
        SPECIAL_K_WARMUP + firstSignalLength + secondSignalLength - 2,
        SPECIAL_K_WARMUP
      ),
    unavailableReason: (barCount) => chartLimit(barCount),
    calculate: (bars, options) =>
      pringSpecialK(
        priceSource(bars, options.source),
        options.firstSignalLength,
        options.secondSignalLength
      )
  }),
  defineCatalogStudy<"chop-zone", TrendStudyParameters["chop-zone"]>({
    catalogId: "STD;Chop%1Zone",
    definition: {
      schemaVersion: 1,
      id: "chop-zone",
      title: "Chop Zone",
      shortTitle: "Chop Zone",
      status: "computed",
      defaultPane: "pane",
      parameters: [],
      outputs: [{ id: "value", title: "Zone", kind: "histogram", color: "#c19822" }],
      levels: [],
      references: ["https://indie-script.github.io/indicators/trend/built-in/Chop%20Zone/"],
      presentation: {
        renderVersion: 2,
        precisionPolicy: "fixed-2",
        plots: [
          {
            id: "value",
            seriesKey: "value",
            geometry: { kind: "columns", base: 0 },
            color: { kind: "indexed", seriesKey: "$zone", colors: chopColors, offset: 4 },
            width: 1
          }
        ],
        hiddenSeries: ["$zone"],
        fills: []
      }
    },
    history: () => recursiveHistory(30, 1, "first-non-null"),
    unavailableReason: (barCount) => chartLimit(barCount),
    calculate: (bars) => {
      const { zone } = chopZone(bars);
      return { value: zone.map((value) => (value === null ? null : 1)), $zone: zone };
    }
  }),
  defineCatalogStudy<"rank-correlation-index", TrendStudyParameters["rank-correlation-index"]>({
    catalogId: "STD;Rank_Correlation_Index",
    definition: {
      schemaVersion: 1,
      id: "rank-correlation-index",
      title: "Rank Correlation Index",
      shortTitle: "RCI",
      status: "computed",
      defaultPane: "pane",
      parameters: [
        source,
        period("length", 10, 2),
        { key: "maType", type: "choice", defaultValue: "None", choices: rciSmoothingTypes },
        period("maLength", 14),
        deviation("bbMultiplier")
      ],
      outputs: rciOutputs,
      levels: rankLevels,
      references: [
        "https://www.tradingview.com/support/solutions/43000765570-rank-correlation-index-rci/"
      ],
      presentation: {
        renderVersion: 2,
        precisionPolicy: "fixed-2",
        plots: rciOutputs.map(linePlot),
        hiddenSeries: [],
        fills: [
          {
            id: "bollingerBand",
            fromSeries: "upper",
            toSeries: "lower",
            color: "#168755",
            opacity: 0.12,
            gaps: "break"
          }
        ]
      }
    },
    history: rankHistory,
    unavailableReason: (barCount, { length }) => chartLimit(barCount, rankWork(barCount, length)),
    calculate: (bars, options) =>
      rankCorrelationIndex(
        priceSource(bars, options.source),
        options.length,
        rankSmoothing(bars, options)
      )
  }),
  defineCatalogStudy<"rci-ribbon", TrendStudyParameters["rci-ribbon"]>({
    catalogId: "STD;RCI_Ribbon",
    definition: {
      schemaVersion: 1,
      id: "rci-ribbon",
      title: "RCI Ribbon",
      shortTitle: "RCI Ribbon",
      status: "computed",
      defaultPane: "pane",
      parameters: [
        source,
        period("shortLength", 9, 2),
        period("middleLength", 26, 2),
        period("longLength", 52, 2)
      ],
      outputs: [
        line("short", "Short RCI"),
        line("middle", "Middle RCI", "#cb881c"),
        line("long", "Long RCI", "#168755")
      ],
      levels: rankLevels,
      references: ["https://www.tradingview.com/support/solutions/43000765571-rci-ribbon/"]
    },
    history: ({ shortLength, middleLength, longLength }) =>
      finiteHistory(
        Math.max(shortLength, middleLength, longLength),
        Math.min(shortLength, middleLength, longLength)
      ),
    unavailableReason: (barCount, { shortLength, middleLength, longLength }) =>
      chartLimit(
        barCount,
        rankWork(barCount, shortLength) +
          rankWork(barCount, middleLength) +
          rankWork(barCount, longLength)
      ),
    calculate: (bars, options) =>
      rankCorrelationRibbon(
        priceSource(bars, options.source),
        options.shortLength,
        options.middleLength,
        options.longLength
      )
  })
] as const;
