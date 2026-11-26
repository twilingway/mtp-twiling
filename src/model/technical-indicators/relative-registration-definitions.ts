import type { TechnicalIndicatorDefinition } from "./types.js";

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
    references: ["https://pine-facade.tradingview.com/pine-facade/get/STD%3BStochastic_RSI/last"],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "fixed-2",
      plots: [plot("k", "#2962FF"), plot("d", "#FF6D00")],
      hiddenSeries: ["$stoch:upper80", "$stoch:lower20"],
      constantSeries: [
        { seriesKey: "$stoch:upper80", value: 80 },
        { seriesKey: "$stoch:lower20", value: 20 }
      ],
      referenceLevels: [80, 50, 20].map((value) => ({
        id: value === 80 ? "upperBand" : value === 50 ? "middleBand" : "lowerBand",
        title: value === 80 ? "Upper Band" : value === 50 ? "Middle Band" : "Lower Band",
        value,
        color: "#787B86",
        opacity: value === 50 ? 0.5 : 1,
        width: 1,
        lineStyle: "dashed"
      })),
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
    references: ["https://pine-facade.tradingview.com/pine-facade/get/STD%3BCoppock%251Curve/last"],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: [plot("value", "#2196F3")],
      fills: [],
      hiddenSeries: []
    }
  }
];
