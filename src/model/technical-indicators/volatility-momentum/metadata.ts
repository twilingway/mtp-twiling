import { assertLength } from "../primitives.js";
import type { TechnicalHistoryRequirement } from "../types.js";

export type VolatilityMomentumId =
  | "bollinger-percent-b"
  | "bollinger-bandwidth"
  | "historical-volatility"
  | "awesome-oscillator"
  | "balance-of-power"
  | "cmo"
  | "ultimate-oscillator"
  | "trix";
interface ParameterLimit {
  readonly min: number;
  readonly max: number | null;
  readonly exclusiveMin?: boolean;
}
export interface VolatilityMomentumPreset {
  readonly id: VolatilityMomentumId;
  readonly publicId: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly defaultPane: "pane";
  readonly status: "math-only";
  readonly reference: string;
  readonly verifiedVersion: string;
  readonly defaults: Readonly<Record<string, string | number>>;
  readonly limits: Readonly<Record<string, ParameterLimit>>;
  readonly outputs: readonly string[];
  readonly omittedNumericOutputs: readonly string[];
  readonly requiredContext: readonly string[];
  readonly notes: readonly string[];
}
function freezeData<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}
const period = { min: 1, max: 10000 },
  multiplier = { min: 0.001, max: 50 };
function preset(
  id: VolatilityMomentumId,
  publicId: string,
  title: string,
  shortTitle: string,
  verifiedVersion: string,
  defaults: VolatilityMomentumPreset["defaults"],
  limits: VolatilityMomentumPreset["limits"],
  outputs: readonly string[] = ["value"],
  requiredContext: readonly string[] = [],
  notes: readonly string[] = []
): VolatilityMomentumPreset {
  return {
    id,
    publicId,
    title,
    shortTitle,
    verifiedVersion,
    defaults,
    limits,
    outputs,
    requiredContext,
    notes,
    defaultPane: "pane",
    status: "math-only",
    omittedNumericOutputs: [],
    reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(publicId)}/last`
  };
}

/** All public numerical plots; renderer colors/alerts are deliberately outside the math API. */
export const volatilityMomentumPresets: readonly VolatilityMomentumPreset[] = freezeData([
  preset(
    "bollinger-percent-b",
    "STD;Bollinger_Bands_B",
    "Bollinger Bands %b",
    "BB %b",
    "36.0",
    { length: 20, multiplier: 2, source: "close" },
    { length: period, multiplier }
  ),
  preset(
    "bollinger-bandwidth",
    "STD;Bollinger_Bands_Width",
    "Bollinger BandWidth",
    "BBW",
    "34.0",
    { length: 20, multiplier: 2, source: "close", expansionLength: 125, contractionLength: 125 },
    { length: period, multiplier, expansionLength: period, contractionLength: period },
    ["value", "highestExpansion", "lowestContraction"]
  ),
  preset(
    "historical-volatility",
    "STD;Historical_Volatility",
    "Historical Volatility",
    "HV",
    "31.0",
    {
      length: 10,
      source: "close",
      builtinAnnual: 365,
      builtinIntradayOrOneDayPer: 1,
      builtinOtherPer: 7
    },
    { length: period, periodsPerYear: { min: 0, max: null, exclusiveMin: true } },
    ["value"],
    ["periodsPerYear"],
    ["Explicit annualization required: built-in uses 365 for intraday/1D,365/7 otherwise."]
  ),
  preset(
    "awesome-oscillator",
    "STD;Awesome_Oscillator",
    "Awesome Oscillator",
    "AO",
    "31.0",
    { source: "hl2", fastLength: 5, slowLength: 34 },
    {},
    ["value"],
    [],
    ["Periods 5/34 and source HL2 are fixed in the public built-in."]
  ),
  preset("balance-of-power", "STD;Balance%1of%1Power", "Balance of Power", "BOP", "30.0", {}, {}),
  preset(
    "cmo",
    "STD;Chande_Momentum_Oscillator",
    "Chande Momentum Oscillator",
    "ChandeMO",
    "31.0",
    { length: 9, source: "close" },
    { length: period }
  ),
  preset(
    "ultimate-oscillator",
    "STD;Ultimate_Oscillator",
    "Ultimate Oscillator",
    "UO",
    "30.0",
    { fastLength: 7, middleLength: 14, slowLength: 28 },
    { fastLength: period, middleLength: period, slowLength: period }
  ),
  preset(
    "trix",
    "STD;TRIX",
    "TRIX",
    "TRIX",
    "31.0",
    { length: 18, source: "close", scale: 10000 },
    { length: period },
    ["value"],
    [],
    ["10000 times change of tripleEMA(log(source)); no percentageROC or signal line."]
  )
]);

export interface VolatilityMomentumPeriods {
  readonly length?: number;
  readonly expansionLength?: number;
  readonly contractionLength?: number;
  readonly fastLength?: number;
  readonly middleLength?: number;
  readonly slowLength?: number;
}
export function volatilityMomentumMetadata(
  id: VolatilityMomentumId,
  periods: VolatilityMomentumPeriods = {}
) {
  const definition = volatilityMomentumPresets.find((item) => item.id === id);
  if (!definition) throw new RangeError("Unknown volatility/momentum indicator");
  for (const key of Object.keys(periods))
    if (!Object.hasOwn(definition.limits, key) || key === "multiplier" || key === "periodsPerYear")
      throw new RangeError("Inapplicable metadata period");
  const length = (key: keyof VolatilityMomentumPeriods): number => {
    const value = periods[key] === undefined ? definition.defaults[key] : periods[key];
    if (typeof value !== "number") throw new RangeError("Invalid metadata period");
    assertLength(value);
    return value;
  };
  let warmupBars: number, lookbackBars: number;
  switch (id) {
    case "bollinger-percent-b":
      warmupBars = length("length");
      lookbackBars = warmupBars;
      break;
    case "bollinger-bandwidth":
      warmupBars = length("length");
      lookbackBars =
        warmupBars + Math.max(length("expansionLength"), length("contractionLength")) - 1;
      break;
    case "historical-volatility":
    case "cmo":
      warmupBars = length("length") + 1;
      lookbackBars = warmupBars;
      break;
    case "awesome-oscillator":
      warmupBars = 34;
      lookbackBars = 34;
      break;
    case "balance-of-power":
      warmupBars = 1;
      lookbackBars = 1;
      break;
    case "ultimate-oscillator":
      warmupBars = Math.max(length("fastLength"), length("middleLength"), length("slowLength")) + 1;
      lookbackBars = warmupBars;
      break;
    case "trix":
      length("length");
      warmupBars = 2;
      lookbackBars = 0;
      break;
  }
  const historyRequirement: TechnicalHistoryRequirement =
    id === "trix"
      ? {
          kind: "recursive",
          lookbackBars: null,
          seedBars: 1,
          seedPolicy: "first-value-ema-chain",
          convergence: "full-input-dependent"
        }
      : { kind: "finite", lookbackBars, seedPolicy: "window", convergence: "exact-after-lookback" };
  return freezeData({ defaultPane: "pane" as const, warmupBars, historyRequirement });
}
