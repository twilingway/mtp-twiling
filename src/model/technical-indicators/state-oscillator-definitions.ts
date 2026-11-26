import type { TechnicalIndicatorDefinition, ParameterDefinition } from "./types.js";
import { trendStatePresets } from "./trend-state/metadata.js";
import type { StateOscillatorId } from "./state-oscillator-contract.js";

const period = (key: string, defaultValue: number): ParameterDefinition => ({
  key,
  type: "integer",
  defaultValue,
  min: 1,
  max: 10000
});
const parameters: Readonly<Record<StateOscillatorId, readonly ParameterDefinition[]>> = {
  tsi: [period("longLength", 25), period("shortLength", 13), period("signalLength", 13)],
  kst: [
    period("roc1Length", 10),
    period("roc2Length", 15),
    period("roc3Length", 20),
    period("roc4Length", 30),
    period("sma1Length", 10),
    period("sma2Length", 10),
    period("sma3Length", 10),
    period("sma4Length", 15),
    period("signalLength", 9)
  ],
  "fisher-transform": [period("length", 9)]
};
const shortTitles: Readonly<Record<StateOscillatorId, string>> = {
  tsi: "TSI",
  kst: "KST",
  "fisher-transform": "Fisher"
};
export const stateOscillatorDefinitions: readonly TechnicalIndicatorDefinition[] = (
  ["tsi", "kst", "fisher-transform"] as const
).map((id) => {
  const preset = trendStatePresets.find((item) => item.id === id)!;
  return {
    schemaVersion: 1,
    id,
    title: preset.title,
    shortTitle: shortTitles[id],
    status: "computed",
    defaultPane: "pane",
    parameters: parameters[id],
    outputs: [
      { id: "value", title: shortTitles[id], kind: "line", color: "#2962ff" },
      {
        id: id === "fisher-transform" ? "trigger" : "signal",
        title: id === "fisher-transform" ? "Trigger" : "Signal",
        kind: "line",
        color: "#ff6d00"
      }
    ],
    levels: id === "fisher-transform" ? [-1.5, -0.75, 0, 0.75, 1.5] : [0],
    references: [preset.reference]
  };
});
