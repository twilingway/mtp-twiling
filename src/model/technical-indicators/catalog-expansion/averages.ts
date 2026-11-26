import { priceSource } from "../data.js";
import type { PlotGeometry, PresentationDefinition } from "../presentation-types.js";
import {
  KAMA_DEFAULTS,
  kaufmanAdaptiveMovingAverage,
  MA_CROSS_DEFAULTS,
  MA_RIBBON_DEFAULTS,
  MCGINLEY_DEFAULT_LENGTH,
  mcginleyDynamic,
  movingAverageCross,
  movingAverageRibbon
} from "../ta-batch-averages.js";
import type {
  KamaOptions,
  MovingAverageCrossOptions,
  RibbonAverage,
  RibbonLineId
} from "../ta-batch-averages.js";
import type {
  LegacyRecursiveHistoryRequirement,
  ParameterDefinition,
  PriceSource,
  TechnicalOutputDefinition
} from "../types.js";
import { defineCatalogStudy } from "./contract.js";

type RibbonParameters = Record<`${RibbonLineId}Average`, RibbonAverage> &
  Record<`${RibbonLineId}Source`, PriceSource> &
  Record<`${RibbonLineId}Length`, number>;

export interface AverageStudyParameters {
  kama: KamaOptions & { source: PriceSource };
  "mcginley-dynamic": { length: number };
  "moving-average-cross": MovingAverageCrossOptions;
  "moving-average-ribbon": RibbonParameters;
}

const length = (key: string, defaultValue: number): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min: 1,
  max: 10000
});
const source = (key: string, defaultValue: PriceSource): ParameterDefinition => ({
  key,
  type: "source",
  defaultValue
});
const line = (id: string, title: string, color: string): TechnicalOutputDefinition => ({
  id,
  title,
  kind: "line",
  color
});

function pricePresentation(outputs: readonly TechnicalOutputDefinition[]): PresentationDefinition {
  return {
    renderVersion: 2,
    precisionPolicy: "native-price",
    plots: outputs.map(({ id, color }) => {
      const geometry: PlotGeometry =
        id === "cross"
          ? { kind: "cross", size: { unit: "pine-relative", value: 2 } }
          : { kind: "line", gaps: "break" };
      return { id, seriesKey: id, geometry, color: { kind: "solid", color }, width: 1 };
    }),
    fills: [],
    hiddenSeries: []
  };
}

function finite(warmupBars: number, lookbackBars = warmupBars) {
  return {
    warmupBars,
    historyRequirement: {
      kind: "finite" as const,
      lookbackBars,
      seedPolicy: "window" as const,
      convergence: "exact-after-lookback" as const
    }
  };
}

function recursive(
  warmupBars: number | null,
  seedBars: number,
  seedPolicy: LegacyRecursiveHistoryRequirement["seedPolicy"]
) {
  const historyRequirement: LegacyRecursiveHistoryRequirement = {
    kind: "recursive",
    lookbackBars: null,
    seedBars,
    seedPolicy,
    convergence: "full-input-dependent"
  };
  return { warmupBars, historyRequirement };
}

const kamaOutputs = [line("value", "KAMA", "#168755")];
const mcginleyOutputs = [line("value", "McGinley Dynamic", "#3478cc")];
const crossOutputs = [
  line("short", "Short MA", "#168755"),
  line("long", "Long MA", "#3478cc"),
  line("cross", "Cross", "#d14343")
];
const ribbonLines = ["ma1", "ma2", "ma3", "ma4"] as const satisfies readonly RibbonLineId[];
const ribbonAverages = ["sma", "ema", "smma", "wma", "vwma"] as const;
const ribbonOutputs = [
  line("ma1", "MA 1", "#3478cc"),
  line("ma2", "MA 2", "#168755"),
  line("ma3", "MA 3", "#cc6b13"),
  line("ma4", "MA 4", "#9d51c7")
];

function ribbonLine(param: RibbonParameters, id: RibbonLineId) {
  return {
    average: param[`${id}Average`],
    source: param[`${id}Source`],
    length: param[`${id}Length`]
  };
}

export const averageStudies = [
  defineCatalogStudy<"kama", AverageStudyParameters["kama"]>({
    catalogId: "STD;Kaufmans_Adaptive_Moving_Average",
    definition: {
      id: "kama",
      schemaVersion: 1,
      status: "computed",
      title: "Kaufman's Adaptive Moving Average",
      shortTitle: "KAMA",
      defaultPane: "overlay",
      parameters: [
        source("source", "close"),
        length("erLength", KAMA_DEFAULTS.erLength),
        length("fastLength", KAMA_DEFAULTS.fastLength),
        length("slowLength", KAMA_DEFAULTS.slowLength)
      ],
      outputs: kamaOutputs,
      levels: [],
      references: [
        "https://www.tradingview.com/support/solutions/43000773012-kaufman-s-adaptive-moving-average-kama/"
      ],
      presentation: pricePresentation(kamaOutputs)
    },
    validParams: ({ fastLength, slowLength }) => fastLength <= slowLength,
    history: ({ erLength }) =>
      recursive(erLength + 1, erLength + 1, "prior-price-after-efficiency-window"),
    calculate: (bars, params) => ({
      value: kaufmanAdaptiveMovingAverage(priceSource(bars, params.source), params)
    })
  }),
  defineCatalogStudy<"mcginley-dynamic", AverageStudyParameters["mcginley-dynamic"]>({
    catalogId: "STD;McGinley%1Dynamic",
    definition: {
      id: "mcginley-dynamic",
      schemaVersion: 1,
      status: "computed",
      title: "McGinley Dynamic",
      shortTitle: "McGinley",
      defaultPane: "overlay",
      parameters: [length("length", MCGINLEY_DEFAULT_LENGTH)],
      outputs: mcginleyOutputs,
      levels: [],
      references: ["https://www.tradingview.com/support/solutions/43000589175-mcginley-dynamic/"],
      presentation: pricePresentation(mcginleyOutputs)
    },
    history: () => recursive(1, 1, "first-nonzero"),
    calculate: (bars, { length }) => ({
      value: mcginleyDynamic(priceSource(bars, "close"), length)
    })
  }),
  defineCatalogStudy<"moving-average-cross", AverageStudyParameters["moving-average-cross"]>({
    catalogId: "STD;MA%1Cross",
    definition: {
      id: "moving-average-cross",
      schemaVersion: 1,
      status: "computed",
      title: "Moving Average Cross",
      shortTitle: "MA Cross",
      defaultPane: "overlay",
      parameters: [
        length("shortLength", MA_CROSS_DEFAULTS.shortLength),
        length("longLength", MA_CROSS_DEFAULTS.longLength)
      ],
      outputs: crossOutputs,
      levels: [],
      references: ["https://www.tradingview.com/support/solutions/43000599879-ma-cross/"],
      presentation: pricePresentation(crossOutputs)
    },
    history: ({ shortLength, longLength }) =>
      finite(Math.min(shortLength, longLength), Math.max(shortLength, longLength) + 1),
    calculate: (bars, params) => movingAverageCross(priceSource(bars, "close"), params)
  }),
  defineCatalogStudy<"moving-average-ribbon", AverageStudyParameters["moving-average-ribbon"]>({
    catalogId: "STD;MA%Ribbon",
    definition: {
      id: "moving-average-ribbon",
      schemaVersion: 1,
      status: "computed",
      title: "Moving Average Ribbon",
      shortTitle: "MA Ribbon",
      defaultPane: "overlay",
      parameters: ribbonLines.flatMap((id) => {
        const defaults = MA_RIBBON_DEFAULTS[id];
        return [
          {
            key: `${id}Average`,
            type: "choice" as const,
            defaultValue: defaults.average,
            choices: ribbonAverages
          },
          source(`${id}Source`, defaults.source),
          length(`${id}Length`, defaults.length)
        ];
      }),
      outputs: ribbonOutputs,
      levels: [],
      references: [
        "https://www.tradingview.com/support/solutions/43000644913-moving-average-ribbon/"
      ],
      presentation: pricePresentation(ribbonOutputs)
    },
    history(params) {
      const lines = ribbonLines.map((id) => ribbonLine(params, id));
      const warmup = Math.min(
        ...lines.map(({ average, length }) => (average === "ema" ? 1 : length))
      );
      const smmaLengths = lines
        .filter(({ average }) => average === "smma")
        .map(({ length }) => length);
      if (smmaLengths.length)
        return recursive(warmup, Math.max(...smmaLengths), "sma-of-first-length");
      if (lines.some(({ average }) => average === "ema"))
        return recursive(warmup, 1, "first-non-null");
      return finite(warmup, Math.max(...lines.map(({ length }) => length)));
    },
    calculate: (bars, params) =>
      movingAverageRibbon(bars, {
        ma1: ribbonLine(params, "ma1"),
        ma2: ribbonLine(params, "ma2"),
        ma3: ribbonLine(params, "ma3"),
        ma4: ribbonLine(params, "ma4")
      })
  })
] as const;
