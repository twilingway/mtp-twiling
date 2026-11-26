import {
  MAX_CHANNEL_AVERAGE_BARS,
  MAX_DIRECT_WINDOW_OPERATIONS
} from "../channel-average/inputs.js";
import type {
  PresentationDefinition,
  PresentationFill,
  PresentationPlot
} from "../presentation-types.js";
import {
  bbTrend,
  bollingerBars,
  chandeKrollStop,
  donchianChannels,
  envelope,
  medianChannel,
  priceBandPresets,
  volatilityStop
} from "../ta-batch-channels.js";
import type {
  NumericValue,
  ParameterDefinition,
  PriceSource,
  TechnicalIndicatorDefinition,
  TechnicalOutputDefinition
} from "../types.js";
import { defineCatalogStudy } from "./contract.js";
import type { CatalogStudyHistory } from "./contract.js";

export interface BandStudyParameters {
  "donchian-channels": { length: number; displayOffset: number };
  envelope: { length: number; percent: number; source: PriceSource; useExponentialMa: boolean };
  median: { length: number; source: PriceSource; atrLength: number; multiplier: number };
  "chande-kroll-stop": { atrLength: number; multiplier: number; stopLength: number };
  "volatility-stop": { length: number; multiplier: number; source: PriceSource };
  bbtrend: { shortLength: number; longLength: number; multiplier: number };
  "bollinger-bars": Record<string, never>;
}

const integer = (key: string, defaultValue: number, min = 1, max = 10000): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min,
  max
});
const number = (
  key: string,
  defaultValue: number,
  min = 0,
  max = 1000000
): ParameterDefinition => ({
  key,
  type: "number",
  defaultValue,
  min,
  max
});
const source = (defaultValue: PriceSource): ParameterDefinition => ({
  key: "source",
  type: "source",
  defaultValue
});
const line = (id: string, title: string, color = "#4269D0"): TechnicalOutputDefinition => ({
  id,
  title,
  color,
  kind: "line"
});
const priceLines = [
  line("basis", "Basis", "#D28430"),
  line("upper", "Upper"),
  line("lower", "Lower")
];

function plot(
  output: TechnicalOutputDefinition,
  geometry: PresentationPlot["geometry"] = { kind: "line", gaps: "break" }
): PresentationPlot {
  return {
    id: output.id,
    seriesKey: output.id,
    geometry,
    color: { kind: "solid", color: output.color },
    width: 1
  };
}

function pricePresentation(
  outputs: readonly TechnicalOutputDefinition[],
  fills: readonly PresentationFill[] = []
): PresentationDefinition {
  return {
    renderVersion: 2,
    precisionPolicy: "native-price",
    plots: outputs.map((output) => plot(output)),
    fills,
    hiddenSeries: []
  };
}

function priceDefinition<Id extends keyof BandStudyParameters>(
  id: Id,
  title: string,
  shortTitle: string,
  reference: string,
  parameters: readonly ParameterDefinition[],
  outputs: readonly TechnicalOutputDefinition[],
  presentation = pricePresentation(outputs)
): Omit<TechnicalIndicatorDefinition, "id"> & { id: Id } {
  return {
    id,
    schemaVersion: 1,
    title,
    shortTitle,
    references: [reference],
    defaultPane: "overlay",
    status: "computed",
    parameters,
    outputs,
    levels: [],
    presentation
  };
}

const bandFill: PresentationFill = {
  id: "band",
  fromSeries: "upper",
  toSeries: "lower",
  color: "#4269D0",
  opacity: 0.1,
  gaps: "break"
};

function finiteHistory(warmupBars: number, lookbackBars = warmupBars): CatalogStudyHistory {
  return {
    warmupBars,
    historyRequirement: {
      kind: "finite",
      lookbackBars,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    }
  };
}

function recursiveHistory(
  warmupBars: number,
  seedPolicy: "first-non-null" | "true-range-wilder",
  seedBars = warmupBars
): CatalogStudyHistory {
  return {
    warmupBars,
    historyRequirement: {
      kind: "recursive",
      lookbackBars: null,
      seedPolicy,
      seedBars,
      convergence: "full-input-dependent"
    }
  };
}

const barLimit = (count: number) =>
  count > MAX_CHANNEL_AVERAGE_BARS ? ("calculation-limit" as const) : undefined;

const donchian = defineCatalogStudy<"donchian-channels", BandStudyParameters["donchian-channels"]>({
  catalogId: priceBandPresets["donchian-channels"].catalogId,
  definition: priceDefinition(
    "donchian-channels",
    "Donchian Channels",
    "DC",
    "https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/",
    [integer("length", 20), integer("displayOffset", 0, -10000, 500)],
    priceLines,
    pricePresentation(priceLines, [bandFill])
  ),
  history: ({ length }) => finiteHistory(1, length),
  barOffsets: ({ displayOffset }) => ({
    basis: displayOffset,
    upper: displayOffset,
    lower: displayOffset
  }),
  unavailableReason: barLimit,
  calculate: (bars, params) => ({ ...donchianChannels(bars, params) })
});

const envelopePreset = priceBandPresets.envelope;
const envelopes = defineCatalogStudy<"envelope", BandStudyParameters["envelope"]>({
  catalogId: envelopePreset.catalogId,
  definition: priceDefinition(
    "envelope",
    "Envelope",
    "ENV",
    "https://www.tradingview.com/support/solutions/43000502260-envelope-env/",
    [
      integer("length", envelopePreset.defaults.length),
      number("percent", envelopePreset.defaults.percent),
      source(envelopePreset.defaults.source),
      {
        key: "useExponentialMa",
        defaultValue: envelopePreset.defaults.useExponentialMa,
        type: "boolean"
      }
    ],
    priceLines,
    pricePresentation(priceLines, [bandFill])
  ),
  history: ({ length, useExponentialMa }) =>
    useExponentialMa ? recursiveHistory(1, "first-non-null") : finiteHistory(length),
  unavailableReason: barLimit,
  calculate: (bars, params) => ({ ...envelope(bars, params) })
});

const medianPreset = priceBandPresets.median;
const medianLines = [
  line("basis", "Median", "#297B70"),
  line("average", "Median EMA", "#8662CB"),
  line("upper", "Upper ATR"),
  line("lower", "Lower ATR")
];
const median = defineCatalogStudy<"median", BandStudyParameters["median"]>({
  catalogId: medianPreset.catalogId,
  definition: priceDefinition(
    "median",
    "Median",
    "Median",
    "https://www.tradingview.com/support/solutions/43000644897-median/",
    [
      integer("length", medianPreset.defaults.length),
      source(medianPreset.defaults.source),
      integer("atrLength", medianPreset.defaults.atrLength),
      number("multiplier", medianPreset.defaults.multiplier)
    ],
    medianLines,
    pricePresentation(medianLines, [
      {
        id: "direction",
        fromSeries: "basis",
        toSeries: "average",
        color: "#297B70",
        belowColor: "#8662CB",
        opacity: 0.22,
        gaps: "break"
      }
    ])
  ),
  history: ({ length, atrLength }) =>
    recursiveHistory(length, "true-range-wilder", Math.max(length, atrLength)),
  unavailableReason: (count, { length }) =>
    barLimit(count) ??
    (Math.max(0, count - length + 1) * length > MAX_DIRECT_WINDOW_OPERATIONS
      ? "calculation-limit"
      : undefined),
  calculate: (bars, params) => ({ ...medianChannel(bars, params) })
});

const krollPreset = priceBandPresets["chande-kroll-stop"];
const kroll = defineCatalogStudy<"chande-kroll-stop", BandStudyParameters["chande-kroll-stop"]>({
  catalogId: krollPreset.catalogId,
  definition: priceDefinition(
    "chande-kroll-stop",
    "Chande Kroll Stop",
    "CKS",
    "https://www.tradingview.com/support/solutions/43000589105-chande-kroll-stop/",
    [
      integer("atrLength", krollPreset.defaults.atrLength),
      number("multiplier", krollPreset.defaults.multiplier),
      integer("stopLength", krollPreset.defaults.stopLength)
    ],
    [line("highStop", "Long stop", "#1A906D"), line("lowStop", "Short stop", "#C74759")]
  ),
  history: ({ atrLength }) => recursiveHistory(atrLength, "true-range-wilder"),
  unavailableReason: barLimit,
  calculate: (bars, params) => ({ ...chandeKrollStop(bars, params) })
});

const volatilityPreset = priceBandPresets["volatility-stop"];
const volatilityOutputs = [
  line("up", "Uptrend stop", "#1A906D"),
  line("down", "Downtrend stop", "#C74759")
];
const volStop = defineCatalogStudy<"volatility-stop", BandStudyParameters["volatility-stop"]>({
  catalogId: volatilityPreset.catalogId,
  definition: priceDefinition(
    "volatility-stop",
    "Volatility Stop",
    "VStop",
    "https://www.tradingview.com/script/v9YZoIw1-Volatility-Stop/",
    [
      integer("length", volatilityPreset.defaults.length),
      number("multiplier", volatilityPreset.defaults.multiplier),
      source(volatilityPreset.defaults.source)
    ],
    volatilityOutputs
  ),
  history: ({ length }) => recursiveHistory(length, "true-range-wilder"),
  unavailableReason: barLimit,
  calculate: (bars, params) => {
    const { value, direction } = volatilityStop(bars, params);
    return {
      up: value.map((point, i) => (direction[i] === 1 ? point : null)),
      down: value.map((point, i) => (direction[i] === -1 ? point : null))
    };
  }
});

const bbTrendPreset = priceBandPresets.bbtrend;
const bbTrendOutput = {
  id: "value",
  title: "BBTrend",
  kind: "histogram",
  color: "#16805F"
} as const;
const bbTrendColors = ["#CB4352", "#DB8D95", "#8ABBA9", "#16805F"];
const bbTrendStudy = defineCatalogStudy<"bbtrend", BandStudyParameters["bbtrend"]>({
  catalogId: bbTrendPreset.catalogId,
  definition: {
    ...priceDefinition(
      "bbtrend",
      "BBTrend",
      "BBTrend",
      "https://www.tradingview.com/support/solutions/43000726749-bbtrend/",
      [
        integer("shortLength", bbTrendPreset.defaults.shortLength),
        integer("longLength", bbTrendPreset.defaults.longLength),
        number("multiplier", bbTrendPreset.defaults.multiplier, 0.001, 50)
      ],
      [bbTrendOutput]
    ),
    defaultPane: "pane",
    levels: [0],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      plots: [
        {
          ...plot(bbTrendOutput, { kind: "columns", base: 0 }),
          color: { kind: "indexed", seriesKey: "$bbtrend-color", colors: bbTrendColors }
        }
      ],
      hiddenSeries: ["$bbtrend-color"],
      fills: []
    }
  },
  history: ({ shortLength, longLength }) => finiteHistory(Math.max(shortLength, longLength)),
  unavailableReason: barLimit,
  calculate: (bars, params) => {
    const value = bbTrend(bars, params);
    const colors = value.map((point, i) => {
      if (point === null) return null;
      const previous = value[i - 1];
      const growing =
        previous == null ||
        Math.sign(point) !== Math.sign(previous) ||
        Math.abs(point) > Math.abs(previous);
      return point < 0 ? (growing ? 0 : 1) : growing ? 3 : 2;
    });
    return { value, "$bbtrend-color": colors };
  }
});

const bollingerRanges = [
  { id: "upperWick", title: "Upper wick", color: "#4A74BD", from: "high", to: "bodyTop" },
  { id: "lowerWick", title: "Lower wick", color: "#4A74BD", from: "bodyBottom", to: "low" },
  {
    id: "upBody",
    title: "Rising body",
    color: "#198968",
    from: "bodyTop",
    to: "bodyBottom",
    direction: "up"
  },
  {
    id: "downBody",
    title: "Falling body",
    color: "#C74759",
    from: "bodyTop",
    to: "bodyBottom",
    direction: "down"
  },
  {
    id: "flatBody",
    title: "Flat body",
    color: "#9B9CAC",
    from: "bodyTop",
    to: "bodyBottom",
    direction: "flat"
  }
] as const;
const bollingerOutputs = bollingerRanges.map(({ id, title, color }) => line(id, title, color));
const opposite = (id: string) => `$bollinger-bars:${id}`;
const bollingerBarsStudy = defineCatalogStudy<
  "bollinger-bars",
  BandStudyParameters["bollinger-bars"]
>({
  catalogId: priceBandPresets["bollinger-bars"].catalogId,
  definition: priceDefinition(
    "bollinger-bars",
    "Bollinger Bars",
    "BB Bars",
    "https://www.tradingview.com/support/solutions/43000742575-bollinger-bars/",
    [],
    bollingerOutputs,
    {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: bollingerOutputs.map((output) =>
        plot(output, {
          kind: "range-bars",
          otherSeriesKey: opposite(output.id),
          showEqual: output.id === "flatBody"
        })
      ),
      hiddenSeries: bollingerOutputs.map((output) => opposite(output.id)),
      fills: []
    }
  ),
  history: () => finiteHistory(1),
  unavailableReason: barLimit,
  calculate: (bars) => {
    const bands = bollingerBars(bars);
    const series: Record<string, NumericValue[]> = {};
    for (const range of bollingerRanges) {
      const eligible = (bar: (typeof bands)[number]) =>
        bar && (!("direction" in range) || bar.direction === range.direction);
      series[range.id] = bands.map((bar) => (bar && eligible(bar) ? bar[range.from] : null));
      series[opposite(range.id)] = bands.map((bar) =>
        bar && eligible(bar) ? bar[range.to] : null
      );
    }
    return series;
  }
});

export const bandStudies = [
  donchian,
  envelopes,
  median,
  kroll,
  volStop,
  bbTrendStudy,
  bollingerBarsStudy
] as const;
