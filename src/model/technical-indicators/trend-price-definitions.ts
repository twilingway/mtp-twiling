import type { ParameterDefinition, TechnicalIndicatorDefinition } from "./types.js";
import type { TrendPriceId } from "./trend-price-contract.js";
import { trendStatePresets } from "./trend-state/metadata.js";

const preset = (id: TrendPriceId) => trendStatePresets.find((entry) => entry.id === id)!;
function parameter(
  id: TrendPriceId,
  key: string,
  type: "integer" | "number" = "number"
): ParameterDefinition {
  const source = preset(id),
    defaultValue = source.defaults[key],
    limit = source.localLimits[key];
  if (typeof defaultValue !== "number" || !limit)
    throw new RangeError("Unexpected reviewed trend-price parameter");
  return { key, type, defaultValue, ...limit };
}
export const trendPriceDefinitions: readonly TechnicalIndicatorDefinition[] = [
  {
    schemaVersion: 1,
    id: "parabolic-sar",
    title: "Parabolic SAR",
    shortTitle: "SAR",
    status: "computed",
    defaultPane: "overlay",
    parameters: ["start", "increment", "maximum"].map((key) => parameter("parabolic-sar", key)),
    outputs: [{ id: "value", title: "SAR", kind: "line", color: "#2962FF" }],
    levels: [],
    references: [preset("parabolic-sar").reference],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "cross", size: { unit: "pine-relative", value: 1 } },
          color: { kind: "solid", color: "#2962FF" },
          width: 1
        }
      ],
      fills: [],
      hiddenSeries: []
    }
  },
  {
    schemaVersion: 1,
    id: "supertrend",
    title: "Supertrend",
    shortTitle: "Supertrend",
    status: "computed",
    defaultPane: "overlay",
    parameters: [
      parameter("supertrend", "atrLength", "integer"),
      parameter("supertrend", "factor")
    ],
    outputs: [
      { id: "upTrend", title: "Up Trend", kind: "line", color: "#4CAF50" },
      { id: "downTrend", title: "Down Trend", kind: "line", color: "#F23645" }
    ],
    levels: [],
    references: [preset("supertrend").reference],
    presentation: {
      renderVersion: 2,
      precisionPolicy: "native-price",
      plots: [
        {
          id: "upTrend",
          seriesKey: "upTrend",
          geometry: { kind: "line", gaps: "break" },
          color: { kind: "solid", color: "#4CAF50" },
          width: 1
        },
        {
          id: "downTrend",
          seriesKey: "downTrend",
          geometry: { kind: "line", gaps: "break" },
          color: { kind: "solid", color: "#F23645" },
          width: 1
        }
      ],
      fills: [
        {
          id: "upFill",
          fromSeries: "bodyMiddle",
          toSeries: "upTrend",
          color: "#4CAF50",
          opacity: 0.1,
          gaps: "break"
        },
        {
          id: "downFill",
          fromSeries: "bodyMiddle",
          toSeries: "downTrend",
          color: "#F23645",
          opacity: 0.1,
          gaps: "break"
        }
      ],
      hiddenSeries: ["value", "direction", "bodyMiddle"]
    }
  }
];
