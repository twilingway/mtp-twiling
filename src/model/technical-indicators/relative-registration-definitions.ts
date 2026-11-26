import type { PresentationReferenceLevel } from "./presentation-types.js";
import type { TechnicalIndicatorDefinition, TechnicalOutputDefinition } from "./types.js";
import { VOLATILITY_MA_TYPES } from "./relative-oscillators/volatility.js";

const length = (key: string, defaultValue: number) => ({
  key,
  defaultValue,
  type: "integer" as const,
  min: 1,
  max: 10000
});
const plot = (id: string, color: string) => ({
  id,
  seriesKey: id,
  geometry: { kind: "line" as const, gaps: "legacy" as const },
  color: { kind: "solid" as const, color },
  width: 1 as const
});
const line = (id: string, title: string, color: string): TechnicalOutputDefinition => ({
  id,
  title,
  kind: "line",
  color
});
const referenceLevels: readonly PresentationReferenceLevel[] = [
  { id: "upperBand", title: "Upper Band", value: 80 },
  { id: "middleBand", title: "Middle Band", value: 50 },
  { id: "lowerBand", title: "Lower Band", value: 20 }
].map((level) => ({
  ...level,
  color: "#787B86",
  opacity: level.value === 50 ? 0.5 : 1,
  width: 1,
  lineStyle: "dashed"
}));
const volatilityOutputs = [
  line("value", "Relative Volatility Index", "#7E57C2"),
  line("smoothing", "Smoothing", "#D9AC16"),
  line("upperBand", "Upper Bollinger Band", "#168755"),
  line("lowerBand", "Lower Bollinger Band", "#168755")
];
export const relativeRegisteredDefinitions: readonly TechnicalIndicatorDefinition[] = [
  {
    schemaVersion: 1,
    id: "stochastic-rsi",
    title: "Stochastic RSI",
    shortTitle: "Stoch RSI",
    status: "computed",
    defaultPane: "pane",
    parameters: [
      length("rsiLength", 14),
      length("stochasticLength", 14),
      length("smoothK", 3),
      length("smoothD", 3),
      { key: "source", type: "source", defaultValue: "close" }
    ],
    outputs: [
      { id: "k", title: "K", kind: "line", color: "#2962FF" },
      { id: "d", title: "D", kind: "line", color: "#FF6D00" }
    ],
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000502333-stochastic-rsi-stoch-rsi/"
    ],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      plots: [plot("k", "#2962FF"), plot("d", "#FF6D00")],
      hiddenSeries: ["$stoch:upper80", "$stoch:lower20"],
      constantSeries: [
        { seriesKey: "$stoch:upper80", value: 80 },
        { seriesKey: "$stoch:lower20", value: 20 }
      ],
      referenceLevels,
      fills: [
        {
          id: "background",
          fromSeries: "$stoch:upper80",
          toSeries: "$stoch:lower20",
          color: "#2196F3",
          opacity: 0.1,
          gaps: "break",
          extent: "pane"
        }
      ]
    }
  },
  {
    schemaVersion: 1,
    id: "coppock-curve",
    title: "Coppock Curve",
    shortTitle: "Coppock",
    status: "computed",
    defaultPane: "pane",
    parameters: [
      length("wmaLength", 10),
      length("longRocLength", 14),
      length("shortRocLength", 11)
    ],
    outputs: [{ id: "value", title: "Coppock Curve", kind: "line", color: "#2196F3" }],
    levels: [],
    references: ["https://www.tradingview.com/support/solutions/43000589114-coppock-curve/"],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: [plot("value", "#2196F3")],
      fills: [],
      hiddenSeries: []
    }
  },
  {
    schemaVersion: 1,
    id: "relative-vigor-index",
    title: "Relative Vigor Index",
    shortTitle: "RVGI",
    status: "computed",
    defaultPane: "pane",
    parameters: [length("length", 10)],
    outputs: [line("value", "RVGI", "#168755"), line("signal", "Signal", "#D14343")],
    levels: [],
    references: ["https://www.tradingview.com/support/solutions/43000591593-relative-vigor-index/"]
  },
  {
    schemaVersion: 1,
    id: "relative-volatility-index",
    title: "Relative Volatility Index",
    shortTitle: "RVI",
    status: "computed",
    defaultPane: "pane",
    parameters: [
      length("length", 10),
      { key: "maType", type: "choice", defaultValue: "SMA", choices: VOLATILITY_MA_TYPES },
      length("maLength", 14),
      { key: "bbMultiplier", type: "number", defaultValue: 2, min: 0.001, max: 50 }
    ],
    outputs: volatilityOutputs,
    levels: [],
    references: [
      "https://www.tradingview.com/support/solutions/43000594684-relative-volatility-index/"
    ],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      plots: volatilityOutputs.map((output) => plot(output.id, output.color)),
      hiddenSeries: ["$rvi:upper80", "$rvi:lower20"],
      constantSeries: [
        { seriesKey: "$rvi:upper80", value: 80 },
        { seriesKey: "$rvi:lower20", value: 20 }
      ],
      referenceLevels: referenceLevels.map((level) => ({
        ...level,
        id: `reference-${level.value}`
      })),
      fills: [
        {
          id: "background",
          fromSeries: "$rvi:upper80",
          toSeries: "$rvi:lower20",
          color: "#7E57C2",
          opacity: 0.1,
          gaps: "break",
          extent: "pane"
        },
        {
          id: "bollinger-fill",
          fromSeries: "upperBand",
          toSeries: "lowerBand",
          color: "#168755",
          opacity: 0.1,
          gaps: "break"
        }
      ]
    }
  },
  {
    schemaVersion: 1,
    id: "bull-bear-power",
    title: "Bull Bear Power",
    shortTitle: "BBP",
    status: "computed",
    defaultPane: "pane",
    parameters: [length("length", 13)],
    outputs: [{ id: "value", title: "Bull Bear Power", kind: "histogram", color: "#089981" }],
    levels: [0],
    references: ["https://www.tradingview.com/support/solutions/43000717955-bull-bear-power/"],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "columns", base: 0 },
          color: { kind: "palette", id: "bbp-sign-v1" },
          width: 1
        }
      ],
      fills: [],
      hiddenSeries: []
    }
  }
];
