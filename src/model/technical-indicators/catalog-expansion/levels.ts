import { finiteOrNull } from "../primitives.js";
import { confirmedZigzag, williamsFractals } from "../ta-batch-fib-pivots.js";
import { averageDailyRange, pivotPointsHighLow } from "../ta-batch-pivots.js";
import type { PresentationPlot } from "../presentation-types.js";
import type {
  NumericValue,
  ParameterDefinition,
  TechnicalBar,
  TechnicalCalculationContext,
  TechnicalOutputDefinition
} from "../types.js";
import { autoFibStudies, type AutoFibStudyParameters } from "./auto-fib.js";
import { defineCatalogStudy } from "./contract.js";

export interface LevelStudyParameters extends AutoFibStudyParameters {
  "williams-fractals": { radius: number };
  zigzag: { pivotLegs: number; deviationPercent: number };
  "pivot-points-high-low": {
    highLeft: number;
    highRight: number;
    lowLeft: number;
    lowRight: number;
  };
  "average-daily-range": { length: number };
}

const length = (key: string, defaultValue: number, min = 1): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min,
  max: 10000
});

const pivotOutputs = [
  { id: "high", title: "Максимум", kind: "line", color: "#c83844" },
  { id: "low", title: "Минимум", kind: "line", color: "#008579" }
] as const satisfies readonly TechnicalOutputDefinition[];

function presentation(plots: readonly PresentationPlot[]) {
  return {
    renderVersion: 2 as const,
    precisionPolicy: "native-price" as const,
    plots,
    fills: [],
    hiddenSeries: []
  };
}

function plot(
  output: TechnicalOutputDefinition,
  geometry: PresentationPlot["geometry"]
): PresentationPlot {
  return {
    id: output.id,
    seriesKey: output.id,
    geometry,
    color: { kind: "solid", color: output.color },
    width: 2
  };
}

function finiteWindow(warmupBars: number, lookbackBars = warmupBars) {
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

function closedBars(bars: readonly TechnicalBar[], context?: TechnicalCalculationContext) {
  // Historical bars precede at least one newer bar. The open or unknown tail cannot confirm a pivot.
  return context?.lastBarClosed === true ? bars : bars.slice(0, -1);
}

function emptySeries(count: number): NumericValue[] {
  return Array<NumericValue>(count).fill(null);
}

function pivotSeries(
  count: number,
  pivots: Iterable<{ kind: "high" | "low"; index: number; value: number }>
) {
  const series = { high: emptySeries(count), low: emptySeries(count) };
  for (const pivot of pivots) series[pivot.kind][pivot.index] = pivot.value;
  return series;
}

function zigzagSeries(
  bars: readonly TechnicalBar[],
  params: LevelStudyParameters["zigzag"],
  context?: TechnicalCalculationContext
) {
  const value = emptySeries(bars.length);
  const segments = confirmedZigzag(
    closedBars(bars, context),
    params.pivotLegs,
    params.deviationPercent
  );
  for (const { from, to } of segments) {
    value[from.index] = from.value;
    for (let index = from.index + 1; index < to.index; index++) {
      const position = (index - from.index) / (to.index - from.index);
      value[index] = finiteOrNull(from.value * (1 - position) + to.value * position);
    }
    value[to.index] = to.value;
  }
  return { value };
}

const fractalId = "williams-fractals";
const williams = defineCatalogStudy<typeof fractalId, LevelStudyParameters[typeof fractalId]>({
  catalogId: "STD;Whilliams_Fractals",
  definition: {
    id: fractalId,
    schemaVersion: 1,
    status: "computed",
    title: "Фракталы Вильямса",
    shortTitle: "Фракталы",
    defaultPane: "overlay",
    parameters: [length("radius", 2)],
    outputs: pivotOutputs,
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000591663-williams-fractal-indicator/"
    ],
    presentation: presentation(
      pivotOutputs.map((output) =>
        plot(output, {
          kind: "marker",
          shape: output.id === "high" ? "triangle-down" : "triangle-up",
          placement: output.id === "high" ? "above" : "below",
          size: { unit: "pine-relative", value: 2 }
        })
      )
    )
  },
  history: ({ radius }) => finiteWindow(2 * radius + 1),
  calculate: (bars, { radius }, context) =>
    pivotSeries(bars.length, williamsFractals(closedBars(bars, context), radius))
});

const zigzagOutput = { id: "value", title: "Зигзаг", kind: "line", color: "#2962ff" } as const;
const zigzag = defineCatalogStudy<"zigzag", LevelStudyParameters["zigzag"]>({
  catalogId: "STD;Zig_Zag",
  definition: {
    id: "zigzag",
    schemaVersion: 1,
    status: "computed",
    title: "Зигзаг по подтверждённым точкам",
    shortTitle: "Зигзаг",
    defaultPane: "overlay",
    parameters: [
      length("pivotLegs", 10, 2),
      { key: "deviationPercent", type: "number", defaultValue: 5, min: 0, max: 10000 }
    ],
    outputs: [zigzagOutput],
    levels: [],
    references: ["https://www.tradingview.com/support/solutions/43000591664-zigzag-indicator/"],
    presentation: presentation([plot(zigzagOutput, { kind: "line", gaps: "break" })])
  },
  history({ pivotLegs }) {
    return {
      warmupBars: 2 * Math.floor(pivotLegs / 2) + 2,
      historyRequirement: {
        kind: "recursive",
        lookbackBars: null,
        seedBars: 2 * Math.floor(pivotLegs / 2) + 1,
        seedPolicy: "alternating-confirmed-extrema",
        convergence: "full-input-dependent"
      }
    };
  },
  calculate: zigzagSeries
});

const pivotId = "pivot-points-high-low";
const pivotHighLow = defineCatalogStudy<typeof pivotId, LevelStudyParameters[typeof pivotId]>({
  catalogId: "STD;Pivot%1Points%1High%1Low",
  definition: {
    id: pivotId,
    schemaVersion: 1,
    status: "computed",
    title: "Локальные максимумы и минимумы",
    shortTitle: "Экстремумы",
    defaultPane: "overlay",
    parameters: [
      length("highLeft", 10),
      length("highRight", 10),
      length("lowLeft", 10),
      length("lowRight", 10)
    ],
    outputs: pivotOutputs,
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000589195-pivot-points-high-low/"
    ],
    presentation: presentation(
      pivotOutputs.map((output) =>
        plot(output, {
          kind: "marker",
          shape: "circle",
          placement: output.id === "high" ? "above" : "below",
          size: { unit: "pine-relative", value: 2 }
        })
      )
    )
  },
  history({ highLeft, highRight, lowLeft, lowRight }) {
    const highWindow = highLeft + highRight + 1;
    const lowWindow = lowLeft + lowRight + 1;
    return finiteWindow(Math.min(highWindow, lowWindow), Math.max(highWindow, lowWindow));
  },
  calculate(bars, { highLeft, highRight, lowLeft, lowRight }, context) {
    const points = pivotPointsHighLow(
      closedBars(bars, context),
      { left: highLeft, right: highRight },
      { left: lowLeft, right: lowRight }
    );
    const indexByTimestamp = new Map(bars.map(({ timestamp }, index) => [timestamp, index]));
    return pivotSeries(
      bars.length,
      points.map((point) => ({ ...point, index: indexByTimestamp.get(point.timestamp)! }))
    );
  }
});

const adrId = "average-daily-range";
const adrOutput = {
  id: "value",
  title: "Средний диапазон",
  kind: "line",
  color: "#2962ff"
} as const;
const adr = defineCatalogStudy<typeof adrId, LevelStudyParameters[typeof adrId]>({
  catalogId: "STD;Average%Day%Range",
  definition: {
    id: adrId,
    schemaVersion: 1,
    status: "computed",
    title: "Средний дневной диапазон",
    shortTitle: "ADR (1Д)",
    defaultPane: "pane",
    parameters: [length("length", 14)],
    outputs: [adrOutput],
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000695003-average-daily-range-adr-indicator/"
    ],
    presentation: presentation([plot(adrOutput, { kind: "line", gaps: "break" })])
  },
  history: ({ length: lookbackBars }) => ({
    warmupBars: lookbackBars,
    historyRequirement: {
      kind: "finite",
      lookbackBars,
      seedPolicy: "known-observation-window",
      convergence: "exact-after-dense-lookback"
    }
  }),
  calculate: (bars, { length: period }, context) => ({
    value:
      context?.chartInterval === "1d" ? averageDailyRange(bars, period) : emptySeries(bars.length)
  })
});

export const levelStudies = [williams, zigzag, pivotHighLow, adr, ...autoFibStudies] as const;
