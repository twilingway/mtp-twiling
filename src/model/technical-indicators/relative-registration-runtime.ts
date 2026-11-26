import {
  stochasticRsi,
  coppockCurve
} from "./relative-oscillators/index.js";
import type {
  RelativeRegisteredId,
  RelativeRegisteredHistory
} from "./relative-registration-contract.js";
import type {
  TechnicalIndicatorInstance,
  TechnicalBar,
  TechnicalIndicatorResult
} from "./types.js";

type Instance = Extract<TechnicalIndicatorInstance, { definitionId: RelativeRegisteredId }>;
export function isRelativeRegisteredInstance(
  instance: TechnicalIndicatorInstance
): instance is Instance {
  return instance.definitionId === "stochastic-rsi" || instance.definitionId === "coppock-curve";
}
export function relativeRegisteredLimit(
  instance: Instance,
  count: number
): "calculation-limit" | undefined {
  const visits =
    instance.definitionId === "stochastic-rsi"
      ? 8 +
        3 * Math.ceil(Math.log2(instance.params.smoothK)) +
        1 +
        3 * Math.ceil(Math.log2(instance.params.smoothD)) +
        1
      : 5 + 3 * Math.ceil(Math.log2(instance.params.wmaLength)) + 1;
  return count > 1_000_000 || count * visits > 80_000_000 ? "calculation-limit" : undefined;
}
export function relativeRegisteredMetadata(instance: Instance) {
  if (instance.definitionId === "stochastic-rsi") {
    const p = instance.params,
      first = {k:p.stochasticLength===1?null:p.rsiLength+p.smoothK,d:p.stochasticLength===1?null:p.rsiLength+p.smoothK+p.smoothD-1};
    const historyRequirement: RelativeRegisteredHistory = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: p.rsiLength + 1,
      seedPolicy: "adjacent-change-rma;canonical-zero-na;partial-positional-stoch;sma-known-k-d",
      convergence: "full-input-dependent",
      firstPossibleIndex: { k: first.k ?? null, d: first.d ?? null }
    };
    return { warmupBars: first.k === null ? null : (first.k ?? 0) + 1, historyRequirement };
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
export function calculateRelativeRegistered(
  instance: Instance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = relativeRegisteredMetadata(instance),
    unavailableReason = relativeRegisteredLimit(instance, bars.length);
  if (unavailableReason)
    return {
      instanceId: instance.id,
      definitionId: instance.definitionId,
      status: "computed",
      timestamps: [],
      series: instance.definitionId === "stochastic-rsi" ? { k: [], d: [] } : { value: [] },
      ...metadata,
      unavailableReason
    };
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((bar) => bar.timestamp),
    ...metadata,
    series:
      instance.definitionId === "stochastic-rsi"
        ? stochasticRsi(bars, instance.params)
        : { value: coppockCurve(bars, instance.params) }
  };
}
