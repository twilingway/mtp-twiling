import { freeze, MAX_RELATIVE_BARS, MAX_RELATIVE_VISITS } from "./inputs.js";
import {
  stochasticRsi,
  relativeVigorIndex,
  coppockCurve,
  bullBearPower,
  type StochasticRsiOptions,
  type RelativeVigorOptions,
  type CoppockOptions,
  type BullBearOptions
} from "./oscillators.js";
import {
  relativeVolatilityIndex,
  VOLATILITY_MA_TYPES,
  type RelativeVolatilityOptions
} from "./volatility.js";

const sourceBounds = {
  "stochastic-rsi": {
    rsiLength: { min: 1, max: null },
    stochasticLength: { min: 1, max: null },
    smoothK: { min: 1, max: null },
    smoothD: { min: 1, max: null }
  },
  "relative-vigor-index": { length: { min: 1, max: null }, offset: { min: -500, max: 500 } },
  "relative-volatility-index": {
    length: { min: 1, max: null },
    offset: { min: -500, max: 500 },
    maLength: { min: null, max: null },
    bbMultiplier: { min: 0.001, max: 50, step: 0.5 }
  },
  "coppock-curve": {
    wmaLength: { min: null, max: null },
    longRocLength: { min: null, max: null },
    shortRocLength: { min: null, max: null }
  },
  "bull-bear-power": { length: { min: null, max: null } }
};
const preset = (
  id: Id,
  publicId: string,
  version: string,
  sha256: string,
  defaults: Readonly<Record<string, string | number>>,
  outputs: readonly string[],
  requiredData: readonly string[],
  presentation: Readonly<Record<string, unknown>>
) => ({
  id,
  publicId,
  verifiedVersion: version,
  sourceSha256: sha256,
  reference: `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(publicId)}/last`,
  status: "math-only" as const,
  defaultPane: "separate" as const,
  defaults,
  sourceInputBounds: sourceBounds[id],
  outputs,
  requiredData,
  hiddenNumericOutputs: [] as readonly string[],
  omittedNumericOutputs: [] as readonly string[],
  presentation,
  primitivePolicy: {
    deviation: "population N divisor",
    observationWindows: "last L known values, null insertion skipped and ready value carried",
    ema: "first-known seed, alpha 2/(L+1)",
    rma: "L-known SMA seed, alpha 1/L",
    swma: "four positional bars, weights 1/6 2/6 2/6 1/6, any null propagates",
    stochasticExtrema:
      "partial positional L-bar window, null extrema ignored; startup parity unresolved",
    displayOffset: "metadata only, arrays remain at calculation indices"
  },
  localLimits: {
    bars: MAX_RELATIVE_BARS,
    length: { min: 1, max: 10000 },
    estimatedVisits: MAX_RELATIVE_VISITS
  },
  parityLimits: [
    "Wrapper facts verified; no Pine execution, realtime, native, UI or multi-timeframe parity measured.",
    "Stoch partial positional extrema and all-flat RSI null are explicit local policy, not proven Pine startup parity.",
    "SMA/WMA/stddev/sum skip null observations; EMA first-known seed; RMA known-L SMA seed; SWMA positional null propagation.",
    "Sparse primitive seeds/carry and floating rounding require independent Pine execution fixtures before registration.",
    "Local bounds/cost caps are not Pine input limits or device performance guarantees."
  ]
});
export const relativeOscillatorPresets = freeze([
  preset(
    "stochastic-rsi",
    "STD;Stochastic_RSI",
    "33.0",
    "1efda9937d6f197cefac02598b8fe6d53fd25aa004ca74fddf2d8038a0c2090e",
    { rsiLength: 14, stochasticLength: 14, smoothK: 3, smoothD: 3, source: "close" },
    ["k", "d"],
    ["source"],
    { colors: { k: "#2962FF", d: "#FF6D00" }, levels: [80, 50, 20], offset: 0 }
  ),
  preset(
    "relative-vigor-index",
    "STD;Relative_Vigor_Index",
    "32.0",
    "21c618cff8c90a7825980363860abe2dc001160bbc7ca43e0ec793ed9db136f6",
    { length: 10, offset: 0 },
    ["value", "signal"],
    ["open", "high", "low", "close"],
    { colors: { value: "#008000", signal: "#FF0000" }, offsetOutputs: ["value", "signal"] }
  ),
  preset(
    "relative-volatility-index",
    "STD;Relative_Volatility_Index",
    "37.0",
    "0f62213d96162efdb39d87a4dcbebd60973002cbf9b15110d73d39acea243e99",
    { length: 10, offset: 0, maType: "SMA", maLength: 14, bbMultiplier: 2 },
    ["value", "smoothing", "upperBand", "lowerBand"],
    ["close", "volume only for VWMA"],
    {
      colors: { value: "#7E57C2", smoothing: "color.yellow", bands: "color.green" },
      maTypes: VOLATILITY_MA_TYPES,
      directionalEmaLength: 14,
      levels: [80, 50, 20],
      backgroundFillLevels: [80, 20],
      bandsFill: "SMA + Bollinger Bands only",
      offsetOutputs: ["value"]
    }
  ),
  preset(
    "coppock-curve",
    "STD;Coppock%1Curve",
    "30.0",
    "2964f27cca48f4ae0ccfa3eaa97c3ea2f6549400344208533be228cc93fdf255",
    { wmaLength: 10, longRocLength: 14, shortRocLength: 11 },
    ["value"],
    ["close"],
    { color: "unspecified plot default", offset: 0 }
  ),
  preset(
    "bull-bear-power",
    "STD;Bull%Bear%Power",
    "7.0",
    "d92b835970edc8fc513895ec5ebb1729ba82c52f06661462ba88100e7e3aed30",
    { length: 13 },
    ["value"],
    ["high", "low", "close"],
    { geometry: "columns", levels: [0], palette: { nonnegative: "#089981", negative: "#F23645" } }
  )
]);
export interface RelativeOscillatorParameters {
  "stochastic-rsi": StochasticRsiOptions;
  "relative-vigor-index": RelativeVigorOptions;
  "relative-volatility-index": RelativeVolatilityOptions;
  "coppock-curve": CoppockOptions;
  "bull-bear-power": BullBearOptions;
}
export type RelativeOscillatorId = keyof RelativeOscillatorParameters;
type Id = RelativeOscillatorId;
type History = {
  readonly kind: "recursive-full-input" | "finite-observation-window";
  readonly denseLookback: number | null;
  readonly firstPossibleIndex: Readonly<Record<string, number | null>>;
  readonly note: string;
};
type CombinedOptions = StochasticRsiOptions &
  RelativeVigorOptions &
  RelativeVolatilityOptions &
  CoppockOptions &
  BullBearOptions;
function detail(id: Id, options: CombinedOptions) {
  // Narrow by presence is insufficient for empty option objects: branch-specific validation stays below.
  switch (id) {
    case "stochastic-rsi": {
      const p: StochasticRsiOptions = options;
      stochasticRsi([], p);
      const {
        rsiLength = 14,
        stochasticLength = 14,
        smoothK = 3,
        smoothD = 3,
        source = "close"
      } = p;
      return {
        parameters: { rsiLength, stochasticLength, smoothK, smoothD, source },
        requiresVolume: source === "volume",
        history: {
          kind: "recursive-full-input",
          denseLookback: null,
          firstPossibleIndex: {
            k: stochasticLength === 1 ? null : rsiLength + smoothK,
            d: stochasticLength === 1 ? null : rsiLength + smoothK + smoothD - 1
          },
          note: "Partial extrema need two distinct RSI values; flat RSI/flat windows can remain null."
        } satisfies History
      };
    }
    case "relative-vigor-index": {
      const p: RelativeVigorOptions = options;
      relativeVigorIndex([], p);
      const { length = 10, offset = 0 } = p;
      return {
        parameters: { length, offset },
        requiresVolume: false,
        history: {
          kind: "finite-observation-window",
          denseLookback: length + 6,
          firstPossibleIndex: { value: length + 2, signal: length + 5 },
          note: "SWMA positional; sums independently skip null observations; sparse calendar span unbounded."
        } satisfies History
      };
    }
    case "relative-volatility-index": {
      const p: RelativeVolatilityOptions = options;
      relativeVolatilityIndex([], p);
      const { length = 10, offset = 0, maType = "SMA", maLength = 14, bbMultiplier = 2 } = p;
      const base = length === 1 ? null : length - 1;
      const smoothing =
        base === null || maType === "None" ? null : base + (maType === "EMA" ? 0 : maLength - 1);
      const band = maType === "SMA + Bollinger Bands" ? smoothing : null;
      return {
        parameters: { length, offset, maType, maLength, bbMultiplier },
        requiresVolume: maType === "VWMA",
        history: {
          kind: "recursive-full-input",
          denseLookback: null,
          firstPossibleIndex: { value: base, smoothing, upperBand: band, lowerBand: band },
          note: "Nonzero volatility and both directional seeds required; VWMA also needs nonzero volume sum."
        } satisfies History
      };
    }
    case "coppock-curve": {
      const p: CoppockOptions = options;
      coppockCurve([], p);
      const { wmaLength = 10, longRocLength = 14, shortRocLength = 11 } = p;
      const lookback = Math.max(longRocLength, shortRocLength) + wmaLength;
      return {
        parameters: { wmaLength, longRocLength, shortRocLength },
        requiresVolume: false,
        history: {
          kind: "finite-observation-window",
          denseLookback: lookback,
          firstPossibleIndex: { value: lookback - 1 },
          note: "ROC denominators must be nonzero; WMA skip-null observations may span arbitrary calendar gaps."
        } satisfies History
      };
    }
    case "bull-bear-power": {
      const p: BullBearOptions = options;
      bullBearPower([], p);
      const { length = 13 } = p;
      return {
        parameters: { length },
        requiresVolume: false,
        history: {
          kind: "recursive-full-input",
          denseLookback: null,
          firstPossibleIndex: { value: 0 },
          note: "EMA first-known close seed; missing current high/low masks the sum."
        } satisfies History
      };
    }
  }
}
export function relativeOscillatorMetadata<K extends Id>(
  id: K,
  options: RelativeOscillatorParameters[K] = {}
) {
  const base = relativeOscillatorPresets.find((preset) => preset.id === id);
  if (base === undefined) throw new RangeError("Unknown relative oscillator");
  return freeze({ ...base, ...detail(id, options) });
}
