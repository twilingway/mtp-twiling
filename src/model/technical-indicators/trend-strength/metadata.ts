import { assertLength } from "../primitives.js";
import type { TechnicalHistoryRequirement } from "../types.js";

export type TrendStrengthId =
  "aroon" | "aroon-oscillator" | "dmi" | "adx" | "vortex" | "choppiness-index";
export interface TrendStrengthPreset {
  readonly id: TrendStrengthId;
  readonly publicId: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly defaultPane: "pane";
  readonly status: "math-only";
  readonly reference: string;
  readonly verifiedVersion: string;
  readonly defaults: Readonly<Record<string, number>>;
  readonly limits: Readonly<Record<string, { readonly min: number; readonly max: number }>>;
  readonly requiredData: readonly string[];
  readonly outputs: readonly string[];
  readonly omittedNumericOutputs: readonly string[];
  readonly presentationInputs: readonly {
    readonly key: string;
    readonly defaultValue: number;
    readonly min: number;
    readonly max: number;
  }[];
  readonly parityLimits: readonly string[];
}

function freezeData<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}
const period = { min: 1, max: 10000 };
function preset(
  id: TrendStrengthId,
  publicId: string,
  title: string,
  shortTitle: string,
  verifiedVersion: string,
  defaults: TrendStrengthPreset["defaults"],
  outputs: readonly string[],
  limits: TrendStrengthPreset["limits"] = { length: period }
): TrendStrengthPreset {
  const aroon = id === "aroon" || id === "aroon-oscillator";
  return {
    id,
    publicId,
    title,
    shortTitle,
    verifiedVersion,
    defaults,
    limits,
    outputs,
    defaultPane: "pane",
    status: "math-only",
    requiredData: aroon ? ["high", "low"] : ["high", "low", "close"],
    reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(publicId)}/last`,
    omittedNumericOutputs: [],
    presentationInputs:
      id === "choppiness-index" ? [{ key: "offset", defaultValue: 0, min: -500, max: 500 }] : [],
    parityLimits: aroon
      ? [
          "Most-recent equal extreme is a local tie policy; primary reference does not specify ties.",
          "Partial initial windows and source-gap masks are not Pine execution parity."
        ]
      : [
          id === "dmi" || id === "adx"
            ? "Joint adjacent DM guard and final source/numeric masks are conservative local gap rules."
            : id === "vortex"
              ? "Independent observation windows for VM and ATR1; final current-movement mask is local."
              : "ATR1 holds known state across missing inputs; extrema count positions; final source/numeric mask is local.",
          "Pine execution and sparse/overflow parity have not been measured."
        ]
  };
}

export const trendStrengthPresets: readonly TrendStrengthPreset[] = freezeData([
  preset("aroon", "STD;Aroon", "Aroon", "Aroon", "33.0", { length: 14 }, ["up", "down"]),
  preset(
    "aroon-oscillator",
    "STD;Aroon_Oscillator",
    "Aroon Oscillator",
    "Aroon osc",
    "4.0",
    { length: 14 },
    ["value"]
  ),
  preset(
    "dmi",
    "STD;DMI",
    "Directional Movement Index",
    "DMI",
    "34.0",
    { diLength: 14, adxSmoothing: 14 },
    ["plusDI", "minusDI", "adx"],
    { diLength: period, adxSmoothing: period }
  ),
  preset(
    "adx",
    "STD;Average%1Directional%1Index",
    "Average Directional Index",
    "ADX",
    "32.0",
    { diLength: 14, adxSmoothing: 14 },
    ["value"],
    { diLength: period, adxSmoothing: period }
  ),
  preset(
    "vortex",
    "STD;Vortex%1Indicator",
    "Vortex Indicator",
    "VI",
    "31.0",
    { length: 14 },
    ["plusVI", "minusVI"],
    { length: { min: 2, max: 10000 } }
  ),
  preset(
    "choppiness-index",
    "STD;Choppiness_Index",
    "Choppiness Index",
    "CHOP",
    "32.0",
    { length: 14 },
    ["value"]
  )
]);

export interface TrendStrengthPeriods {
  readonly length?: number;
  readonly diLength?: number;
  readonly adxSmoothing?: number;
}
export function trendStrengthMetadata(id: TrendStrengthId, periods: TrendStrengthPeriods = {}) {
  const definition = trendStrengthPresets.find((item) => item.id === id);
  if (!definition) throw new RangeError("Unknown trend-strength indicator");
  for (const key of Object.keys(periods))
    if (!Object.hasOwn(definition.limits, key))
      throw new RangeError("Inapplicable trend-strength parameter");
  const periodValue = (key: keyof TrendStrengthPeriods): number => {
    const value = periods[key] === undefined ? definition.defaults[key] : periods[key];
    if (typeof value !== "number") throw new RangeError("Invalid trend-strength period");
    assertLength(value);
    if (value < definition.limits[key]!.min)
      throw new RangeError("Trend-strength period below minimum");
    return value;
  };
  let warmupBars: number | null, outputWarmup: Readonly<Record<string, number | null>>;
  let historyRequirement: TechnicalHistoryRequirement;
  let alwaysUndefined = false;
  if (id === "dmi" || id === "adx") {
    const diLength = periodValue("diLength"),
      smoothing = periodValue("adxSmoothing");
    warmupBars = diLength + smoothing;
    outputWarmup =
      id === "dmi"
        ? { plusDI: diLength + 1, minusDI: diLength + 1, adx: warmupBars }
        : { value: warmupBars };
    historyRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: warmupBars,
      seedPolicy: "adjacent-change-wilder",
      convergence: "full-input-dependent"
    };
  } else {
    const length = periodValue("length");
    alwaysUndefined = id === "choppiness-index" && length === 1;
    warmupBars = alwaysUndefined
      ? null
      : id === "aroon" || id === "aroon-oscillator"
        ? 1
        : id === "vortex"
          ? length + 1
          : length;
    outputWarmup = Object.fromEntries(definition.outputs.map((output) => [output, warmupBars]));
    historyRequirement = {
      kind: "finite",
      lookbackBars: length + 1,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    };
  }
  return freezeData({
    defaultPane: "pane" as const,
    warmupBars,
    outputWarmup,
    historyRequirement,
    alwaysUndefined,
    ...(alwaysUndefined ? { undefinedReason: "length=1 makes log10(length)=0" } : {})
  });
}
