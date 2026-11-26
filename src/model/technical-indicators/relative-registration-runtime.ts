import {
  bullBearPower,
  coppockCurve,
  relativeVigorIndex,
  relativeVolatilityIndex,
  stochasticRsi
} from "./relative-oscillators/index.js";
import {
  MAX_RELATIVE_BARS,
  MAX_RELATIVE_VISITS,
  treeVisits
} from "./relative-oscillators/inputs.js";
import { assertTechnicalBars } from "./data.js";
import type {
  RelativeRegisteredId,
  RelativeRegisteredHistory
} from "./relative-registration-contract.js";
import type {
  TechnicalIndicatorInstance,
  TechnicalBar,
  TechnicalIndicatorResult,
  LegacyRecursiveHistoryRequirement
} from "./types.js";

type Instance = Extract<TechnicalIndicatorInstance, { definitionId: RelativeRegisteredId }>;
export function isRelativeRegisteredInstance(
  instance: TechnicalIndicatorInstance
): instance is Instance {
  return (
    instance.definitionId === "stochastic-rsi" ||
    instance.definitionId === "coppock-curve" ||
    instance.definitionId === "relative-vigor-index" ||
    instance.definitionId === "relative-volatility-index" ||
    instance.definitionId === "bull-bear-power"
  );
}
function visitsPerBar(instance: Instance): number {
  switch (instance.definitionId) {
    case "stochastic-rsi":
      return 8 + treeVisits(instance.params.smoothK) + treeVisits(instance.params.smoothD);
    case "coppock-curve":
      return 5 + treeVisits(instance.params.wmaLength);
    case "relative-vigor-index":
      return 8 + 2 * treeVisits(instance.params.length);
    case "relative-volatility-index": {
      const { length, maLength, maType } = instance.params;
      const windows = maType === "VWMA" || maType === "SMA + Bollinger Bands" ? 2 : 1;
      return 10 + treeVisits(length) + windows * treeVisits(maLength);
    }
    case "bull-bear-power":
      return 5;
  }
}
export function relativeRegisteredLimit(
  instance: Instance,
  count: number
): "calculation-limit" | undefined {
  return count > MAX_RELATIVE_BARS || count * visitsPerBar(instance) > MAX_RELATIVE_VISITS
    ? "calculation-limit"
    : undefined;
}
export function relativeRegisteredMetadata(instance: Instance) {
  if (instance.definitionId === "stochastic-rsi") {
    const { rsiLength, stochasticLength, smoothK, smoothD } = instance.params;
    const k = stochasticLength === 1 ? null : rsiLength + smoothK;
    const d = k === null ? null : k + smoothD - 1;
    const historyRequirement: RelativeRegisteredHistory = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: rsiLength + 1,
      seedPolicy: "adjacent-change-rma;canonical-zero-na;partial-positional-stoch;sma-known-k-d",
      convergence: "full-input-dependent",
      firstPossibleIndex: { k, d }
    };
    return { warmupBars: k === null ? null : k + 1, historyRequirement };
  }
  if (instance.definitionId === "relative-vigor-index") {
    const value = instance.params.length + 2;
    const signal = value + 3;
    const historyRequirement: RelativeRegisteredHistory = {
      kind: "finite-observation-window",
      lookbackBars: null,
      denseLookbackBars: signal + 1,
      seedPolicy: "swma-four-positional;rolling-last-known;same-index-ratio",
      convergence: "sparse-full-input-dependent",
      firstPossibleIndex: { value, signal }
    };
    return { warmupBars: value + 1, historyRequirement };
  }
  if (instance.definitionId === "relative-volatility-index") {
    const { length, maLength, maType } = instance.params;
    const value = length === 1 ? null : length - 1;
    const smoothing =
      value === null || maType === "None" ? null : value + (maType === "EMA" ? 0 : maLength - 1);
    const historyRequirement: RelativeRegisteredHistory = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: length,
      seedPolicy: "directional-deviation;first-known-ema",
      convergence: "full-input-dependent",
      firstPossibleIndex: { value, smoothing }
    };
    return { warmupBars: value === null ? null : length, historyRequirement };
  }
  if (instance.definitionId === "bull-bear-power") {
    const historyRequirement: LegacyRecursiveHistoryRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: 1,
      seedPolicy: "first-non-null",
      convergence: "full-input-dependent"
    };
    return { warmupBars: 1, historyRequirement };
  }
  const p = instance.params,
    lookback = Math.max(p.longRocLength, p.shortRocLength) + p.wmaLength;
  const historyRequirement: RelativeRegisteredHistory = {
    kind: "finite-observation-window",
    lookbackBars: null,
    denseLookbackBars: lookback,
    lagBars: [p.longRocLength, p.shortRocLength],
    knownObservations: p.wmaLength,
    seedPolicy: "exact-index-roc;wma-last-known",
    convergence: "sparse-full-input-dependent",
    firstPossibleIndex: { value: lookback - 1 }
  };
  return { warmupBars: lookback, historyRequirement };
}
function calculateSeries(
  instance: Instance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult["series"] {
  switch (instance.definitionId) {
    case "stochastic-rsi":
      return stochasticRsi(bars, instance.params);
    case "coppock-curve":
      return { value: coppockCurve(bars, instance.params) };
    case "relative-vigor-index":
      return relativeVigorIndex(bars, instance.params);
    case "relative-volatility-index":
      return relativeVolatilityIndex(bars, instance.params);
    case "bull-bear-power":
      return { value: bullBearPower(bars, instance.params) };
  }
}
export function calculateRelativeRegistered(
  instance: Instance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = relativeRegisteredMetadata(instance);
  const unavailableReason = relativeRegisteredLimit(instance, bars.length);
  const data = unavailableReason ? [] : bars;
  assertTechnicalBars(data);
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: data.map((bar) => bar.timestamp),
    ...metadata,
    ...(metadata.warmupBars === null ? { alwaysUndefined: true as const } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
    series: calculateSeries(instance, data)
  };
}
