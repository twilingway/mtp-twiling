import { trendStrengthPresets } from "./trend-strength/metadata.js";
import type { TrendStrengthId } from "./trend-strength/metadata.js";
import type { TechnicalIndicatorDefinition, TechnicalOutputDefinition } from "./types.js";

const period = (key: string, value: number, min = 1) => ({
  key,
  type: "integer" as const,
  defaultValue: value,
  min,
  max: 10000
});
const line = (id: string, title: string, color: string): TechnicalOutputDefinition => ({
  id,
  title,
  color,
  kind: "line"
});
function definition(
  id: TrendStrengthId,
  parameters: TechnicalIndicatorDefinition["parameters"],
  outputs: TechnicalIndicatorDefinition["outputs"],
  levels: readonly number[] = []
): TechnicalIndicatorDefinition {
  const preset = trendStrengthPresets.find((item) => item.id === id);
  if (!preset) throw new RangeError("Missing verified trend-strength preset");
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

/** Appended after the original 29; main registry deeply freezes every nested value. */
export const trendStrengthIndicatorDefinitions: readonly TechnicalIndicatorDefinition[] = [
  definition(
    "aroon",
    [period("length", 14)],
    [line("up", "Aroon Up", "#fb8c00"), line("down", "Aroon Down", "#2962ff")]
  ),
  definition(
    "aroon-oscillator",
    [period("length", 14)],
    [line("value", "Oscillator", "#4caf50")],
    [-90, 0, 90]
  ),
  definition(
    "dmi",
    [period("diLength", 14), period("adxSmoothing", 14)],
    [
      line("plusDI", "+DI", "#2962ff"),
      line("minusDI", "-DI", "#ff6d00"),
      line("adx", "ADX", "#f50057")
    ]
  ),
  definition(
    "adx",
    [period("diLength", 14), period("adxSmoothing", 14)],
    [line("value", "ADX", "#f44336")]
  ),
  definition(
    "vortex",
    [period("length", 14, 2)],
    [line("plusVI", "VI +", "#2962ff"), line("minusVI", "VI -", "#e91e63")]
  ),
  definition(
    "choppiness-index",
    [period("length", 14)],
    [line("value", "CHOP", "#2962ff")],
    [38.2, 61.8]
  )
];
