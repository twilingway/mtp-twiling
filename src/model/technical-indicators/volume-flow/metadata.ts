import type { VolumeAverage } from "./parameters.js";

export type VolumeFlowId =
  "cmf" | "chaikin-oscillator" | "efi" | "eom" | "volume-oscillator" | "nvi" | "pvi";
type Parameter =
  | {
      readonly key: string;
      readonly type: "integer";
      readonly defaultValue: number;
      readonly min: 1;
      readonly max: number;
    }
  | {
      readonly key: string;
      readonly type: "choice";
      readonly defaultValue: VolumeAverage;
      readonly choices: readonly VolumeAverage[];
    };
export interface VolumeFlowPreset {
  readonly id: VolumeFlowId;
  readonly title: string;
  readonly publicId: string;
  readonly sourceVersion: string;
  readonly verifiedOn: "2026-11-26";
  readonly status: "math-only";
  readonly defaultPane: "pane";
  readonly parameters: readonly Parameter[];
  readonly outputs: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: "line" | "histogram";
  }[];
  readonly requiredData: readonly ("high" | "low" | "close" | "volume")[];
  readonly requiresNonzeroVolumeHistory: true;
  readonly limits: readonly string[];
  readonly reference: string;
}

const integer = (key: string, defaultValue: number, max: number): Parameter =>
  Object.freeze({ key, type: "integer", defaultValue, min: 1, max });
const choice = (key: string): Parameter =>
  Object.freeze({
    key,
    type: "choice",
    defaultValue: "EMA",
    choices: Object.freeze(["EMA", "SMA"] as const)
  });
function preset(
  id: VolumeFlowId,
  title: string,
  publicId: string,
  sourceVersion: string,
  parameters: Parameter[],
  requiredData: VolumeFlowPreset["requiredData"],
  outputs: [string, string, "line" | "histogram"][]
): VolumeFlowPreset {
  return Object.freeze({
    id,
    title,
    publicId,
    sourceVersion,
    verifiedOn: "2026-11-26",
    status: "math-only",
    defaultPane: "pane",
    parameters: Object.freeze(parameters),
    requiredData: Object.freeze(requiredData),
    requiresNonzeroVolumeHistory: true,
    limits: Object.freeze([
      "source-only-no-mtf-no-pine-runtime-parity",
      "binary64-overflow-null-reviewed-smoothing-precision",
      ...(id === "chaikin-oscillator" ? ["sparse-adl-known-contributions-only"] : []),
      ...(id === "nvi" || id === "pvi" ? ["cumulative-overflow-poison"] : [])
    ]),
    outputs: Object.freeze(outputs.map(([id, title, kind]) => Object.freeze({ id, title, kind }))),
    reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(publicId)}/last`
  });
}

/** Bounds are application resource limits; current Pine source supplies minimums only. */
export const volumeFlowPresets: readonly VolumeFlowPreset[] = Object.freeze([
  preset(
    "cmf",
    "Chaikin Money Flow",
    "STD;Chaikin_Money_Flow",
    "32.0",
    [integer("length", 20, 2000)],
    ["high", "low", "close", "volume"],
    [["value", "CMF", "line"]]
  ),
  preset(
    "chaikin-oscillator",
    "Chaikin Oscillator",
    "STD;Chaikin_Oscillator",
    "32.0",
    [integer("fastLength", 3, 2000), integer("slowLength", 10, 2000)],
    ["high", "low", "close", "volume"],
    [["value", "Chaikin oscillator", "line"]]
  ),
  preset(
    "efi",
    "Elder Force Index",
    "STD;EFI",
    "32.0",
    [integer("length", 13, 2000)],
    ["close", "volume"],
    [["value", "Elder Force Index", "line"]]
  ),
  preset(
    "eom",
    "Ease of Movement",
    "STD;EOM",
    "30.0",
    [integer("length", 14, 2000), integer("divisor", 10000, 1000000000)],
    ["high", "low", "volume"],
    [["value", "EOM", "line"]]
  ),
  preset(
    "volume-oscillator",
    "Percentage Volume Oscillator",
    "STD;Volume%1Oscillator",
    "33.0",
    [
      integer("fastLength", 12, 10000),
      integer("slowLength", 26, 10000),
      integer("signalLength", 9, 10000),
      choice("oscillatorAverage"),
      choice("signalAverage")
    ],
    ["volume"],
    [
      ["oscillator", "PVO", "line"],
      ["signal", "Signal line", "line"],
      ["histogram", "Histogram", "histogram"]
    ]
  ),
  preset(
    "nvi",
    "Negative Volume Index",
    "STD;Negative_Volume_Index",
    "4.0",
    [integer("emaLength", 255, 10000)],
    ["close", "volume"],
    [
      ["index", "NVI", "line"],
      ["average", "NVI-based EMA", "line"]
    ]
  ),
  preset(
    "pvi",
    "Positive Volume Index",
    "STD;Positive_Volume_Index",
    "4.0",
    [integer("emaLength", 255, 10000)],
    ["close", "volume"],
    [
      ["index", "PVI", "line"],
      ["average", "PVI-based EMA", "line"]
    ]
  )
]);

export interface VolumeFlowOptions {
  readonly length?: number;
  readonly fastLength?: number;
  readonly slowLength?: number;
  readonly signalLength?: number;
  readonly divisor?: number;
  readonly emaLength?: number;
  readonly oscillatorAverage?: VolumeAverage;
  readonly signalAverage?: VolumeAverage;
}

/** Deliberately separate from shared history types until registration review. */
export interface VolumeFlowHistoryRequirement {
  readonly kind:
    "observation-window" | "recursive" | "smoothing-composition" | "cumulative-plus-ema";
  readonly lookbackBars: null;
  readonly observations: number | null;
  readonly seedBars: number;
  readonly seedPolicy:
    "window" | "first-non-null" | "zero-adl-first-value-ema" | "internal-one-displayed-thousand";
  readonly emaLengths: readonly number[];
  readonly missingPolicy: string;
  readonly convergence: "exact-after-valid-observations" | "full-input-dependent";
}

export function volumeFlowMetadata(id: VolumeFlowId, options: VolumeFlowOptions = {}) {
  const definition = volumeFlowPresets.find((item) => item.id === id);
  if (!definition) throw new RangeError("Unknown volume-flow indicator");
  for (const key of Object.keys(options))
    if (!definition.parameters.some((parameter) => parameter.key === key))
      throw new RangeError("Unexpected volume-flow parameter");
  const values: Record<string, number | VolumeAverage> = {};
  for (const parameter of definition.parameters) {
    const value = options[parameter.key as keyof VolumeFlowOptions] ?? parameter.defaultValue;
    if (parameter.type === "integer") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < parameter.min ||
        value > parameter.max
      )
        throw new RangeError("Invalid volume-flow integer parameter");
    } else if (value !== "EMA" && value !== "SMA")
      throw new RangeError("Invalid volume-flow average");
    values[parameter.key] = value;
  }
  const length = values.length as number,
    fast = values.fastLength as number,
    slow = values.slowLength as number,
    signal = values.signalLength as number;
  let warmupBars: number;
  let kind: VolumeFlowHistoryRequirement["kind"];
  let seedPolicy: VolumeFlowHistoryRequirement["seedPolicy"];
  let observations: number | null = null;
  let emaLengths: number[] = [];
  let missingPolicy: string;
  const outputWarmupBars: Record<string, number> = {};
  if (id === "cmf" || id === "eom") {
    warmupBars = length + Number(id === "eom");
    observations = length;
    kind = "observation-window";
    seedPolicy = "window";
    missingPolicy =
      id === "cmf"
        ? "independent-na-skipping-flow-and-volume-windows"
        : "adjacent-midpoint-changes-na-skipping-sma";
  } else if (id === "efi") {
    warmupBars = 2;
    kind = "recursive";
    seedPolicy = "first-non-null";
    emaLengths = [length];
    missingPolicy = "adjacent-close-change-then-ema-na-hold";
  } else if (id === "volume-oscillator") {
    const oscillatorWarmup = values.oscillatorAverage === "SMA" ? Math.max(fast, slow) : 1;
    warmupBars = oscillatorWarmup + (values.signalAverage === "SMA" ? signal - 1 : 0);
    Object.assign(outputWarmupBars, {
      oscillator: oscillatorWarmup,
      signal: warmupBars,
      histogram: warmupBars
    });
    kind = "smoothing-composition";
    if (values.oscillatorAverage === "EMA") emaLengths.push(fast, slow);
    if (values.signalAverage === "EMA") emaLengths.push(signal);
    seedPolicy = emaLengths.length === 0 ? "window" : "first-non-null";
    missingPolicy = "na-skipping-averages-zero-slow-denominator-null";
  } else {
    warmupBars = 1;
    kind = "cumulative-plus-ema";
    seedPolicy =
      id === "chaikin-oscillator" ? "zero-adl-first-value-ema" : "internal-one-displayed-thousand";
    emaLengths = id === "chaikin-oscillator" ? [fast, slow] : [values.emaLength as number];
    missingPolicy =
      id === "chaikin-oscillator"
        ? "adl-known-contributions-ema-na-hold-overflow-poison"
        : "pine-nz-close-zero-hold-previous-volume-zero-overflow-poison";
  }
  for (const output of definition.outputs) outputWarmupBars[output.id] ??= warmupBars;
  const historyRequirement: VolumeFlowHistoryRequirement = Object.freeze({
    kind,
    lookbackBars: null,
    observations,
    seedBars: warmupBars,
    seedPolicy,
    emaLengths: Object.freeze(emaLengths),
    missingPolicy,
    convergence:
      kind === "observation-window" || (kind === "smoothing-composition" && emaLengths.length === 0)
        ? "exact-after-valid-observations"
        : "full-input-dependent"
  });
  return Object.freeze({
    defaultPane: "pane" as const,
    warmupBars,
    outputWarmupBars: Object.freeze(outputWarmupBars),
    alwaysUndefined: false as const,
    historyRequirement
  });
}
