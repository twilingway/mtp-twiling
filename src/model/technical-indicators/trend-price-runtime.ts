import { parabolicSar, supertrend, trendStateMetadata } from "./trend-state/index.js";
import type { TrendPriceId, TrendPriceHistoryRequirement } from "./trend-price-contract.js";
import type {
  TechnicalBar,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult
} from "./types.js";

type TrendPriceInstance = Extract<TechnicalIndicatorInstance, { definitionId: TrendPriceId }>;
export function isTrendPriceInstance(
  instance: TechnicalIndicatorInstance
): instance is TrendPriceInstance {
  return instance.definitionId === "parabolic-sar" || instance.definitionId === "supertrend";
}
export function trendPriceMetadata(instance: TrendPriceInstance) {
  const metadata =
      instance.definitionId === "parabolic-sar"
        ? trendStateMetadata("parabolic-sar", instance.params)
        : trendStateMetadata("supertrend", instance.params),
    history = metadata.historyRequirement,
    warmupBars =
      instance.definitionId === "parabolic-sar" ? 2 : Math.max(2, instance.params.atrLength);
  if (
    history.kind !== "recursive" ||
    history.convergence !== "full-input-dependent" ||
    history.seedBars !== warmupBars ||
    metadata.warmupBars !== warmupBars ||
    metadata.alwaysUndefined
  )
    throw new RangeError("Unexpected reviewed trend-price history");
  let historyRequirement: TrendPriceHistoryRequirement;
  if (instance.definitionId === "parabolic-sar") {
    if (history.seedPolicy !== "two-adjacent-bars-close-direction")
      throw new RangeError("Unexpected reviewed SAR seed");
    historyRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: 2,
      seedPolicy: "two-adjacent-bars-close-direction",
      convergence: "full-input-dependent"
    };
  } else {
    if (history.seedPolicy !== "contiguous-true-range-wilder-and-trailing-bands")
      throw new RangeError("Unexpected reviewed Supertrend seed");
    historyRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: warmupBars,
      seedPolicy: "contiguous-true-range-wilder-and-trailing-bands",
      convergence: "full-input-dependent"
    };
  }
  return { ...metadata, warmupBars, historyRequirement };
}
export function calculateTrendPrice(
  instance: TrendPriceInstance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = trendPriceMetadata(instance),
    series =
      instance.definitionId === "parabolic-sar"
        ? {
            value: parabolicSar(
              bars,
              instance.params.start,
              instance.params.increment,
              instance.params.maximum
            )
          }
        : supertrend(bars, instance.params.atrLength, instance.params.factor);
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((bar) => bar.timestamp),
    warmupBars: metadata.warmupBars,
    historyRequirement: metadata.historyRequirement,
    series
  };
}
