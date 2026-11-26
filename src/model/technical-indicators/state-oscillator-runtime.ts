import { tsi, kst, fisherTransform, trendStateMetadata } from "./trend-state/index.js";
import type { KstOptions } from "./trend-state/index.js";
import type {
  StateOscillatorId,
  StateOscillatorHistoryRequirement
} from "./state-oscillator-contract.js";
import type {
  TechnicalIndicatorInstance,
  TechnicalParameters,
  TechnicalBar,
  TechnicalIndicatorResult
} from "./types.js";

type StateInstance = Extract<TechnicalIndicatorInstance, { definitionId: StateOscillatorId }>;
export function isStateOscillatorInstance(
  instance: TechnicalIndicatorInstance
): instance is StateInstance {
  return (
    instance.definitionId === "tsi" ||
    instance.definitionId === "kst" ||
    instance.definitionId === "fisher-transform"
  );
}
function kstOptions(p: TechnicalParameters["kst"]): KstOptions {
  return {
    rocLengths: [p.roc1Length, p.roc2Length, p.roc3Length, p.roc4Length],
    smaLengths: [p.sma1Length, p.sma2Length, p.sma3Length, p.sma4Length],
    signalLength: p.signalLength
  };
}
function reviewedMetadata(instance: StateInstance) {
  switch (instance.definitionId) {
    case "tsi":
      return trendStateMetadata("tsi", instance.params);
    case "kst":
      return trendStateMetadata("kst", kstOptions(instance.params));
    case "fisher-transform":
      return trendStateMetadata("fisher-transform", instance.params);
  }
}
/** Validate the reviewed math metadata while narrowing its general string fields to exact literals. */
export function stateOscillatorMetadata(instance: StateInstance) {
  const metadata = reviewedMetadata(instance),
    history = metadata.historyRequirement;
  let historyRequirement: StateOscillatorHistoryRequirement;
  if (instance.definitionId === "kst") {
    if (
      history.kind !== "finite" ||
      history.seedPolicy !== "known-observation-window" ||
      history.convergence !== "exact-after-dense-lookback"
    )
      throw new RangeError("Unexpected reviewed KST history");
    historyRequirement = {
      kind: "finite",
      lookbackBars: history.lookbackBars,
      seedPolicy: "known-observation-window",
      convergence: "exact-after-dense-lookback"
    };
  } else {
    if (history.kind !== "recursive" || history.convergence !== "full-input-dependent")
      throw new RangeError("Unexpected reviewed recursive history");
    if (instance.definitionId === "tsi") {
      if (history.seedPolicy !== "first-known-ema-chain" || history.seedBars !== 2)
        throw new RangeError("Unexpected reviewed TSI seed");
      historyRequirement = {
        kind: "recursive",
        lookbackBars: null,
        seedBars: 2,
        seedPolicy: "first-known-ema-chain",
        convergence: "full-input-dependent"
      };
    } else {
      if (
        history.seedPolicy !== "partial-extrema-explicit-previous-state-nz" ||
        history.seedBars !== (instance.params.length === 1 ? null : 2)
      )
        throw new RangeError("Unexpected reviewed Fisher seed");
      historyRequirement = {
        kind: "recursive",
        lookbackBars: null,
        seedBars: instance.params.length === 1 ? null : 2,
        seedPolicy: "partial-extrema-explicit-previous-state-nz",
        convergence: "full-input-dependent"
      };
    }
  }
  return { ...metadata, historyRequirement };
}
export function calculateStateOscillator(
  instance: StateInstance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = stateOscillatorMetadata(instance);
  const series =
    instance.definitionId === "tsi"
      ? tsi(
          bars,
          instance.params.longLength,
          instance.params.shortLength,
          instance.params.signalLength
        )
      : instance.definitionId === "kst"
        ? kst(bars, kstOptions(instance.params))
        : fisherTransform(bars, instance.params.length);
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((b) => b.timestamp),
    warmupBars: metadata.warmupBars,
    ...(metadata.alwaysUndefined ? { alwaysUndefined: true as const } : {}),
    historyRequirement: metadata.historyRequirement,
    series
  };
}
