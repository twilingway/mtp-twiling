import {
  isRelativeRegisteredInstance,
  relativeRegisteredLimit
} from "./relative-registration-runtime.js";
import {
  alma,
  lsma,
  chandelierExit,
  MAX_CHANNEL_AVERAGE_BARS,
  MAX_DIRECT_WINDOW_OPERATIONS
} from "./channel-average/index.js";
import { priceSource } from "./data.js";
import {
  catalogExpansionUnavailable,
  isCatalogExpansionInstance
} from "./catalog-expansion/registry.js";
import { prices } from "./channel-average/inputs.js";
import type { ChannelPriceId, ChannelPriceHistoryRequirement } from "./channel-average-contract.js";
import type {
  TechnicalBar,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult,
  TechnicalHistoryRequirement
} from "./types.js";

type ChannelPriceInstance = Extract<TechnicalIndicatorInstance, { definitionId: ChannelPriceId }>;
export function isChannelPriceInstance(
  instance: TechnicalIndicatorInstance
): instance is ChannelPriceInstance {
  return (
    instance.definitionId === "alma" ||
    instance.definitionId === "lsma" ||
    instance.definitionId === "chandelier-exit"
  );
}
/** Exact reviewed preflight; no quote/parameter changes and no catch-all exception conversion. */
export function technicalCalculationUnavailableReason(
  instance: TechnicalIndicatorInstance,
  barCount: number
): "calculation-limit" | undefined {
  if (isCatalogExpansionInstance(instance))
    return catalogExpansionUnavailable(instance, barCount) === "calculation-limit"
      ? "calculation-limit"
      : undefined;
  if (isRelativeRegisteredInstance(instance)) return relativeRegisteredLimit(instance, barCount);
  if (instance.definitionId === "keltner-channels")
    return barCount > MAX_CHANNEL_AVERAGE_BARS ? "calculation-limit" : undefined;
  if (!isChannelPriceInstance(instance)) return undefined;
  if (barCount > MAX_CHANNEL_AVERAGE_BARS) return "calculation-limit";
  if (
    instance.definitionId !== "chandelier-exit" &&
    Math.max(0, barCount - instance.params.length + 1) * instance.params.length >
      MAX_DIRECT_WINDOW_OPERATIONS
  )
    return "calculation-limit";
  return undefined;
}
export function calculationLimitMessage(english: boolean): string {
  return english
    ? "The calculation is too large for this device. Reduce the period or history depth."
    : "Расчёт слишком большой для устройства. Уменьшите период или глубину истории.";
}
export function channelPriceMetadata(instance: ChannelPriceInstance): {
  warmupBars: number;
  historyRequirement: TechnicalHistoryRequirement;
} {
  if (instance.definitionId !== "chandelier-exit")
    return {
      warmupBars: instance.params.length,
      historyRequirement: {
        kind: "finite",
        lookbackBars: instance.params.length,
        seedPolicy: "window",
        convergence: "exact-after-lookback"
      }
    };
  const historyRequirement: ChannelPriceHistoryRequirement = {
    kind: "recursive",
    lookbackBars: null,
    seedBars: instance.params.atrLength,
    seedPolicy: "available-extrema;tr-fallback;full-window-atr-rma",
    convergence: "full-input-dependent"
  };
  return { warmupBars: instance.params.atrLength, historyRequirement };
}
export function calculateChannelPrice(
  instance: ChannelPriceInstance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = channelPriceMetadata(instance),
    unavailableReason = technicalCalculationUnavailableReason(instance, bars.length);
  let series: TechnicalIndicatorResult["series"];
  if (unavailableReason) {
    const empty = () => Array<null>(bars.length).fill(null);
    series =
      instance.definitionId === "chandelier-exit"
        ? { longExit: empty(), shortExit: empty() }
        : { value: empty() };
  } else if (instance.definitionId === "alma") {
    series = { value: alma(priceSource(bars, "close"), instance.params) };
  } else if (instance.definitionId === "lsma") {
    series = { value: lsma(prices(bars, instance.params.source), instance.params) };
  } else series = { ...chandelierExit(bars, instance.params) };
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((bar) => bar.timestamp),
    warmupBars: metadata.warmupBars,
    historyRequirement: metadata.historyRequirement,
    series,
    ...(unavailableReason ? { unavailableReason } : {})
  };
}
