import { channelAveragePresets } from "./channel-average/index.js";
import { KELTNER_BANDS_STYLES } from "./keltner-contract.js";
import type { TechnicalIndicatorDefinition } from "./types.js";

/** Plot/fill colors verified from public KC35.0; transparency95 means opacity0.05. */
export const keltnerDefinition: TechnicalIndicatorDefinition = {
  schemaVersion: 1,
  id: "keltner-channels",
  title: "Keltner Channels",
  shortTitle: "KC",
  status: "computed",
  defaultPane: "overlay",
  parameters: [
    { key: "length", type: "integer", defaultValue: 20, min: 1, max: 10000 },
    { key: "multiplier", type: "number", defaultValue: 2, min: 0, max: 1000000 },
    { key: "source", type: "source", defaultValue: "close" },
    { key: "useExponentialMa", type: "boolean", defaultValue: true },
    {
      key: "bandsStyle",
      type: "choice",
      defaultValue: "Average True Range",
      choices: KELTNER_BANDS_STYLES
    },
    { key: "atrLength", type: "integer", defaultValue: 10, min: 1, max: 10000 }
  ],
  outputs: ["upper", "basis", "lower"].map((id) => ({
    id,
    title: id === "basis" ? "Basis" : id === "upper" ? "Upper" : "Lower",
    kind: "line",
    color: "#2962FF"
  })),
  levels: [],
  references: [channelAveragePresets.find((entry) => entry.id === "keltner-channels")!.reference],
  presentation: {
    renderVersion: 2,
    precisionPolicy: "native-price",
    plots: ["upper", "basis", "lower"].map((id) => ({
      id,
      seriesKey: id,
      geometry: { kind: "line", gaps: "break" },
      color: { kind: "solid", color: "#2962FF" },
      width: 1
    })),
    fills: [
      {
        id: "background",
        fromSeries: "upper",
        toSeries: "lower",
        color: "#2196F3",
        opacity: 0.05,
        gaps: "break"
      }
    ],
    hiddenSeries: []
  }
};
