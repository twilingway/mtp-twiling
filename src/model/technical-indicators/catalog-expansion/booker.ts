import { MAX_DIRECT_WINDOW_OPERATIONS } from "../channel-average/inputs.js";
import type {
  PlotGeometry,
  PlotPrecisionPolicy,
  PresentationDefinition
} from "../presentation-types.js";
import { bookerReversal, rsiDivergence, woodiesCci } from "../ta-batch-booker-oscillators.js";
import type {
  BookerReversalOptions,
  RsiDivergenceEvent,
  RsiDivergenceOptions,
  WoodiesTrend
} from "../ta-batch-booker-oscillators.js";
import type {
  LegacyRecursiveHistoryRequirement,
  NumericValue,
  ParameterDefinition,
  TechnicalBar,
  TechnicalOutputDefinition
} from "../types.js";
import { defineCatalogStudy } from "./contract.js";

type DivergenceParameters = RsiDivergenceOptions & {
  showHiddenBullish: boolean;
  showHiddenBearish: boolean;
};

export interface BookerStudyParameters {
  "woodies-cci": { slowLength: number; fastLength: number };
  "rsi-divergence": DivergenceParameters;
  "booker-reversal": BookerReversalOptions;
}

const length = (key: string, defaultValue: number): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min: 1,
  max: 10_000
});
const threshold = (key: string, defaultValue: number): ParameterDefinition => ({
  key,
  type: "number",
  defaultValue,
  min: 0,
  max: 100
});
const line = (id: string, title: string, color: string): TechnicalOutputDefinition => ({
  id,
  title,
  kind: "line",
  color
});

const columns: PlotGeometry = { kind: "columns", base: 0 };
const brokenLine: PlotGeometry = { kind: "line", gaps: "break" };
function presentation(
  outputs: readonly TechnicalOutputDefinition[],
  precisionPolicy: PlotPrecisionPolicy,
  geometryFor: (id: string, kind: TechnicalOutputDefinition["kind"]) => PlotGeometry
): PresentationDefinition {
  return {
    renderVersion: 2,
    precisionPolicy,
    plots: outputs.map(({ id, kind, color }) => ({
      id,
      seriesKey: id,
      geometry: geometryFor(id, kind),
      color: { kind: "solid", color },
      width: 1
    })),
    fills: [],
    hiddenSeries: []
  };
}

const woodiesColors = {
  neutral: "#787b86",
  pending: "#e7a917",
  rising: "#089981",
  falling: "#f23645"
} satisfies Record<WoodiesTrend, string>;

const woodiesLabels: Record<WoodiesTrend, string> = {
  neutral: "Neutral",
  pending: "Pending",
  rising: "Positive trend",
  falling: "Negative trend"
};

const woodiesStates = Object.keys(woodiesColors) as WoodiesTrend[];
const woodiesOutputs: readonly TechnicalOutputDefinition[] = [
  ...woodiesStates.map((id) => ({
    id,
    title: woodiesLabels[id],
    kind: "histogram" as const,
    color: woodiesColors[id]
  })),
  line("slow", "CCI", "#2962ff"),
  line("fast", "TCCI", "#ff6d00")
];

const woodies = defineCatalogStudy<"woodies-cci", BookerStudyParameters["woodies-cci"]>({
  catalogId: "STD;Woodies%1CCI",
  definition: {
    schemaVersion: 1,
    id: "woodies-cci",
    status: "computed",
    title: "Woodies CCI",
    shortTitle: "Woodies CCI",
    defaultPane: "pane",
    parameters: [length("slowLength", 14), length("fastLength", 6)],
    outputs: woodiesOutputs,
    levels: [-100, 0, 100],
    references: ["https://www.tradingview.com/support/solutions/43000594673-woodies-cci/"],
    presentation: presentation(woodiesOutputs, "fixed-2", (_id, kind) =>
      kind === "histogram" ? columns : brokenLine
    )
  },
  unavailableReason(count, { slowLength, fastLength }) {
    return count * (slowLength + fastLength) > MAX_DIRECT_WINDOW_OPERATIONS
      ? "calculation-limit"
      : undefined;
  },
  history({ slowLength, fastLength }) {
    return {
      warmupBars: Math.min(slowLength, fastLength),
      historyRequirement: {
        kind: "finite",
        lookbackBars: Math.max(slowLength + 5, fastLength),
        seedPolicy: "window",
        convergence: "exact-after-lookback"
      }
    };
  },
  calculate(bars, { slowLength, fastLength }) {
    const { slow, fast, histogram, trend } = woodiesCci(bars, slowLength, fastLength);
    const groups = Object.fromEntries(
      woodiesStates.map((state) => [
        state,
        histogram.map((value, index) => (trend[index] === state ? value : null))
      ])
    );
    return { slow, fast, ...groups };
  }
});

function recursive(
  warmupBars: number,
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

const divergenceOutputIds = {
  "regular-bullish": "regularBullish",
  "regular-bearish": "regularBearish",
  "hidden-bullish": "hiddenBullish",
  "hidden-bearish": "hiddenBearish"
} as const;

const divergenceOutputs = [
  line("oscillator", "RSI", "#7e57c2"),
  line("regularBullish", "Regular bullish", "#089981"),
  line("regularBearish", "Regular bearish", "#f23645"),
  line("hiddenBullish", "Hidden bullish", "#69bdad"),
  line("hiddenBearish", "Hidden bearish", "#ee8793")
];

function divergenceSegments(
  bars: readonly TechnicalBar[],
  events: readonly RsiDivergenceEvent[],
  params: DivergenceParameters,
  lastBarClosed: boolean
) {
  const firstOnOrAfterTail = bars.length - Number(!lastBarClosed);
  const indexByTime = new Map(bars.map(({ timestamp }, index) => [timestamp, index]));
  const segments = {
    regularBullish: Array<NumericValue>(bars.length).fill(null),
    regularBearish: Array<NumericValue>(bars.length).fill(null),
    hiddenBullish: Array<NumericValue>(bars.length).fill(null),
    hiddenBearish: Array<NumericValue>(bars.length).fill(null)
  };
  for (const { kind, previous, current, confirmedAt } of events) {
    if (
      (kind === "hidden-bullish" && !params.showHiddenBullish) ||
      (kind === "hidden-bearish" && !params.showHiddenBearish) ||
      indexByTime.get(confirmedAt)! >= firstOnOrAfterTail
    )
      continue;
    const first = indexByTime.get(previous.timestamp)!;
    const last = indexByTime.get(current.timestamp)!;
    const values = segments[divergenceOutputIds[kind]];
    // Chart space is indexed by bars. Intermediate points encode the segment, not RSI samples.
    for (let index = first; index < last; index++)
      values[index] =
        previous.oscillator +
        (current.oscillator - previous.oscillator) * ((index - first) / (last - first));
    values[last] = current.oscillator;
  }
  return segments;
}

const divergenceStudy = defineCatalogStudy<"rsi-divergence", DivergenceParameters>({
  catalogId: "STD;Divergence%1Indicator",
  definition: {
    schemaVersion: 1,
    id: "rsi-divergence",
    status: "computed",
    title: "RSI Divergence",
    shortTitle: "RSI Divergence",
    defaultPane: "pane",
    parameters: [
      length("length", 14),
      { key: "source", type: "source", defaultValue: "close" },
      length("left", 5),
      length("right", 5),
      length("minimumDistance", 5),
      length("maximumDistance", 60),
      { key: "showHiddenBullish", type: "boolean", defaultValue: false },
      { key: "showHiddenBearish", type: "boolean", defaultValue: false }
    ],
    outputs: divergenceOutputs,
    levels: [30, 50, 70],
    references: [
      "https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/"
    ],
    presentation: presentation(divergenceOutputs, "fixed-2", () => brokenLine)
  },
  validParams: ({ minimumDistance, maximumDistance }) => minimumDistance <= maximumDistance,
  unavailableReason: (count, { left, right }) =>
    count * (left + right) > MAX_DIRECT_WINDOW_OPERATIONS ? "calculation-limit" : undefined,
  history: ({ length }) => recursive(length + 1, length + 1, "adjacent-change-wilder"),
  calculate(bars, params, context) {
    const { oscillator, events } = rsiDivergence(bars, params);
    return { oscillator, ...divergenceSegments(bars, events, params, !!context?.lastBarClosed) };
  }
});

const reversalOutputs = [
  line("bullish", "Bullish reversal", "#089981"),
  line("bearish", "Bearish reversal", "#f23645")
];

const reversalStudy = defineCatalogStudy<"booker-reversal", BookerReversalOptions>({
  catalogId: "BookerReversal@tv-basicstudies",
  definition: {
    schemaVersion: 1,
    id: "booker-reversal",
    status: "computed",
    title: "Rob Booker Reversal",
    shortTitle: "Booker Reversal",
    defaultPane: "overlay",
    parameters: [
      length("fastLength", 12),
      length("slowLength", 26),
      length("kLength", 14),
      length("slowing", 3),
      threshold("overbought", 80),
      threshold("oversold", 20)
    ],
    outputs: reversalOutputs,
    levels: [],
    references: ["https://www.tradingview.com/support/solutions/43000599840-rob-booker-reversal/"],
    presentation: presentation(reversalOutputs, "native-price", (id) => ({
      kind: "marker",
      shape: id === "bullish" ? "triangle-up" : "triangle-down",
      size: { unit: "pine-relative", value: 2 },
      placement: id === "bullish" ? "below" : "above"
    }))
  },
  validParams: ({ oversold, overbought }) => oversold < overbought,
  history: ({ kLength, slowing }) =>
    recursive(Math.max(2, kLength + slowing - 1), 1, "first-non-null"),
  calculate(bars, params, context) {
    const values = {
      bullish: Array<NumericValue>(bars.length).fill(null),
      bearish: Array<NumericValue>(bars.length).fill(null)
    };
    const observed = context?.lastBarClosed ? bars : bars.slice(0, -1);
    const indexByTime = new Map(observed.map(({ timestamp }, index) => [timestamp, index]));
    for (const { timestamp, direction, price } of bookerReversal(observed, params))
      values[direction][indexByTime.get(timestamp)!] = price;
    return values;
  }
});

export const bookerStudies = [woodies, divergenceStudy, reversalStudy] as const;
