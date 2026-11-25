import { volatilityMomentumPresets } from "./volatility-momentum/metadata.js";
import type { VolatilityMomentumId } from "./volatility-momentum/metadata.js";
import type { TechnicalIndicatorDefinition, TechnicalOutputDefinition } from "./types.js";

const period = (key: string, value: number) => ({
  key,
  type: "integer" as const,
  defaultValue: value,
  min: 1,
  max: 10000
});
const source = { key: "source", type: "source" as const, defaultValue: "close" as const };
const multiplier = {
  key: "multiplier",
  type: "number" as const,
  defaultValue: 2,
  min: 0.001,
  max: 50
};
const line = (id = "value", title = "Value", color = "#2962ff"): TechnicalOutputDefinition => ({
  id,
  title,
  color,
  kind: "line"
});
function definition(
  id: VolatilityMomentumId,
  parameters: TechnicalIndicatorDefinition["parameters"],
  outputs: TechnicalIndicatorDefinition["outputs"],
  levels: readonly number[] = []
): TechnicalIndicatorDefinition {
  const preset = volatilityMomentumPresets.find((item) => item.id === id);
  if (!preset) throw new RangeError("Missing verified volatility preset");
  return {
    schemaVersion: 1,
    id,
    title: preset.title,
    shortTitle: preset.shortTitle,
    status: "computed",
    defaultPane: preset.defaultPane,
    parameters,
    outputs,
    levels,
    references: [preset.reference]
  };
}

/** Appended to preserve all existing definition order/defaults; parent freezes every nested object. */
export const volatilityIndicatorDefinitions: readonly TechnicalIndicatorDefinition[] = [
  definition(
    "bollinger-percent-b",
    [period("length", 20), multiplier, source],
    [line("value", "BB %b")],
    [0, 0.5, 1]
  ),
  definition(
    "bollinger-bandwidth",
    [
      period("length", 20),
      multiplier,
      source,
      period("expansionLength", 125),
      period("contractionLength", 125)
    ],
    [
      line("value", "BandWidth"),
      line("highestExpansion", "Highest Expansion", "#f23645"),
      line("lowestContraction", "Lowest Contraction", "#089981")
    ]
  ),
  definition("historical-volatility", [period("length", 10)], [line("value", "HV")]),
  definition(
    "awesome-oscillator",
    [],
    [{ ...line("value", "AO", "#089981"), kind: "histogram" }],
    [0]
  ),
  definition("balance-of-power", [], [line("value", "BOP", "#f23645")], [0]),
  definition("cmo", [period("length", 9), source], [line("value", "ChandeMO")], [-50, 0, 50]),
  definition(
    "ultimate-oscillator",
    [period("fastLength", 7), period("middleLength", 14), period("slowLength", 28)],
    [line("value", "Oscillator", "#f23645")],
    [30, 50, 70]
  ),
  definition("trix", [period("length", 18)], [line("value", "TRIX", "#f23645")], [0])
];
