import { bounded, freeze, period } from "./inputs.js";
import { kstParameters, type KstOptions } from "./oscillators.js";

export type TrendStateId = "supertrend" | "parabolic-sar" | "tsi" | "kst" | "fisher-transform";
export interface TrendStateParameters {
  supertrend: { readonly atrLength?: number; readonly factor?: number };
  "parabolic-sar": {
    readonly start?: number;
    readonly increment?: number;
    readonly maximum?: number;
  };
  tsi: {
    readonly longLength?: number;
    readonly shortLength?: number;
    readonly signalLength?: number;
  };
  kst: KstOptions;
  "fisher-transform": { readonly length?: number };
}
export interface TrendStatePreset {
  readonly id: TrendStateId;
  readonly publicId: string;
  readonly verifiedVersion: string;
  readonly sourceSha256: string;
  readonly title: string;
  readonly status: "math-only";
  readonly defaultPane: "overlay" | "pane";
  readonly defaults: Readonly<Record<string, number | readonly number[]>>;
  readonly localLimits: Readonly<Record<string, { readonly min: number; readonly max: number }>>;
  readonly outputs: readonly string[];
  readonly requiredData: readonly string[];
  readonly reference: string;
  readonly omittedNumericOutputs: readonly string[];
  readonly parityLimits: readonly string[];
}
const lengthLimit = { min: 1, max: 10000 };
function preset(
  id: TrendStateId,
  publicId: string,
  title: string,
  verifiedVersion: string,
  sourceSha256: string,
  defaults: TrendStatePreset["defaults"],
  outputs: readonly string[],
  requiredData: readonly string[],
  localLimits: TrendStatePreset["localLimits"]
): TrendStatePreset {
  return {
    id,
    publicId,
    title,
    verifiedVersion,
    sourceSha256,
    defaults,
    outputs,
    requiredData,
    localLimits,
    status: "math-only",
    defaultPane: id === "supertrend" || id === "parabolic-sar" ? "overlay" : "pane",
    reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(publicId)}/last`,
    omittedNumericOutputs: [],
    parityLimits: [
      "Pine execution, sparse/overflow parity and chart integration have not been measured.",
      id === "supertrend" || id === "parabolic-sar"
        ? "Unknown HLC/overflow resets a contiguous segment; readiness masks unseeded price outputs."
        : "Local masks and finite-safe filters are explicit; source recursive nz is not a replacement price."
    ]
  };
}
export const trendStatePresets: readonly TrendStatePreset[] = freeze([
  preset(
    "supertrend",
    "STD;Supertrend",
    "Supertrend",
    "12.0",
    "0c4115d2b12d1a3eb07c12bbc44e9dd99eaded6019781a40115be066311c42e3",
    { atrLength: 10, factor: 3 },
    ["value", "direction", "upTrend", "downTrend", "bodyMiddle"],
    ["high", "low", "close", "open"],
    { atrLength: lengthLimit, factor: { min: 0.01, max: 1_000_000 } }
  ),
  preset(
    "parabolic-sar",
    "STD;PSAR",
    "Parabolic SAR",
    "33.0",
    "0b65333a9c928edf614ff55fb66654e0f66fa00a7fc57d7e2d590923df77350e",
    { start: 0.02, increment: 0.02, maximum: 0.2 },
    ["value"],
    ["high", "low", "close"],
    { start: { min: 0, max: 1 }, increment: { min: 0, max: 1 }, maximum: { min: 0, max: 1 } }
  ),
  preset(
    "tsi",
    "STD;True%1Strength%1Indicator",
    "True Strength Index",
    "31.0",
    "d754f9a1362997e4bafbde8a520cb9361560c072ea5c67d312edfa43eba0b886",
    { longLength: 25, shortLength: 13, signalLength: 13 },
    ["value", "signal"],
    ["close"],
    { longLength: lengthLimit, shortLength: lengthLimit, signalLength: lengthLimit }
  ),
  preset(
    "kst",
    "STD;Know_Sure_Thing",
    "Know Sure Thing",
    "30.0",
    "e6ebf18172d38f94f76c83162fd3fe49d0d183c5a195dd1da79cc59f8f193c56",
    { rocLengths: [10, 15, 20, 30], smaLengths: [10, 10, 10, 15], signalLength: 9 },
    ["value", "signal"],
    ["close"],
    { rocLengths: lengthLimit, smaLengths: lengthLimit, signalLength: lengthLimit }
  ),
  preset(
    "fisher-transform",
    "STD;Fisher_Transform",
    "Fisher Transform",
    "32.0",
    "83e99f94eb20e1e19c3ae2964748a5492638280e22581465d754b89d49819432",
    { length: 9 },
    ["value", "trigger"],
    ["high", "low"],
    { length: lengthLimit }
  )
]);

export const dpoResearch = freeze({
  id: "dpo",
  publicId: "STD;DPO",
  verifiedVersion: "32.0",
  status: "unresolved" as const,
  sourceSha256: "e6ddefe64e45e5b2b2555e577730ce2a5b7dfec0398c8319160ae5b257512339",
  defaults: { length: 21, centered: false },
  reference: "https://pine-facade.tradingview.com/pine-facade/get/STD%3BDPO/last",
  reason:
    "Pine v6 input-int division yields fractional barsback; primary conversion evidence is absent.",
  centeredPresentation:
    "Computed at i, displayed at i-barsback; display timestamp requires future calculation bars."
});

export function trendStateMetadata<K extends TrendStateId>(
  id: K,
  parameters: TrendStateParameters[K] = {}
) {
  const definition = trendStatePresets.find((item) => item.id === id);
  if (
    !definition ||
    parameters === null ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  )
    throw new RangeError("Invalid trend-state metadata request");
  for (const key of Object.keys(parameters))
    if (!Object.hasOwn(definition.defaults, key))
      throw new RangeError("Inapplicable trend-state parameter");
  const numeric = (key: string): number => {
    const supplied: unknown = Object.hasOwn(parameters, key)
      ? parameters[key as keyof typeof parameters]
      : definition.defaults[key];
    if (typeof supplied !== "number") throw new RangeError("Invalid trend-state number");
    const limit = definition.localLimits[key]!;
    bounded(supplied, limit.min, limit.max);
    if (limit === lengthLimit) period(supplied);
    return supplied;
  };
  let warmupBars: number | null, outputWarmup: Record<string, number | null>, seedPolicy: string;
  let lookbackBars: number | null = null;
  if (id === "supertrend") {
    const length = numeric("atrLength");
    numeric("factor");
    warmupBars = Math.max(2, length);
    outputWarmup = {
      value: warmupBars,
      direction: 1,
      upTrend: Math.max(2, length + 1),
      downTrend: warmupBars,
      bodyMiddle: 2
    };
    seedPolicy = "contiguous-true-range-wilder-and-trailing-bands";
  } else if (id === "parabolic-sar") {
    ["start", "increment", "maximum"].forEach(numeric);
    warmupBars = 2;
    outputWarmup = { value: 2 };
    seedPolicy = "two-adjacent-bars-close-direction";
  } else if (id === "tsi") {
    ["longLength", "shortLength", "signalLength"].forEach(numeric);
    warmupBars = 2;
    outputWarmup = { value: 2, signal: 2 };
    seedPolicy = "first-known-ema-chain";
  } else if (id === "kst") {
    const options = kstParameters(parameters as KstOptions);
    const main = Math.max(...options.rocLengths.map((r, i) => r + options.smaLengths[i]!));
    lookbackBars = main + options.signalLength - 1;
    warmupBars = main;
    outputWarmup = { value: main, signal: lookbackBars };
    seedPolicy = "known-observation-window";
  } else {
    const length = numeric("length");
    warmupBars = length === 1 ? null : 2;
    outputWarmup = { value: warmupBars, trigger: length === 1 ? null : 3 };
    seedPolicy = "partial-extrema-explicit-previous-state-nz";
  }
  return freeze({
    warmupBars,
    outputWarmup,
    alwaysUndefined: warmupBars === null,
    historyRequirement:
      lookbackBars === null
        ? {
            kind: "recursive" as const,
            lookbackBars: null,
            seedBars: warmupBars,
            seedPolicy,
            convergence: "full-input-dependent" as const
          }
        : {
            kind: "finite" as const,
            lookbackBars,
            seedPolicy,
            convergence: "exact-after-dense-lookback" as const
          },
    availability:
      "Dense minimum with nonzero denominators, not guaranteed output or convergence history."
  });
}
