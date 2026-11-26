import { keltnerChannels, channelAverageMetadata } from "./channel-average/index.js";
import { technicalCalculationUnavailableReason } from "./channel-average-runtime.js";
import type { KeltnerHistoryRequirement } from "./keltner-contract.js";
import type {
  TechnicalIndicatorInstance,
  TechnicalBar,
  TechnicalIndicatorResult
} from "./types.js";

type KeltnerInstance = Extract<TechnicalIndicatorInstance, { definitionId: "keltner-channels" }>;
export function isKeltnerInstance(
  instance: TechnicalIndicatorInstance
): instance is KeltnerInstance {
  return instance.definitionId === "keltner-channels";
}
export function keltnerMetadata(instance: KeltnerInstance) {
  const metadata = channelAverageMetadata("keltner-channels", instance.params),
    reviewed = metadata.historyRequirement;
  let historyRequirement: KeltnerHistoryRequirement;
  if (!instance.params.useExponentialMa && instance.params.bandsStyle === "True Range") {
    if (
      reviewed.kind !== "finite" ||
      reviewed.lookbackBars !== Math.max(instance.params.length, 2) ||
      reviewed.seedPolicy !== "full-window-sma;tr-fallback-high-low" ||
      reviewed.convergence !== "exact-after-lookback"
    )
      throw new RangeError("Unexpected reviewed finite Keltner history");
    historyRequirement = {
      kind: "finite",
      lookbackBars: reviewed.lookbackBars,
      seedBars: reviewed.seedBars,
      seedPolicy: "full-window-sma;tr-fallback-high-low",
      convergence: "exact-after-lookback"
    };
  } else {
    const seedPolicy = instance.params.useExponentialMa
      ? instance.params.bandsStyle === "True Range"
        ? "first-valid-ema;tr-fallback-high-low"
        : "first-valid-ema;full-window-rma"
      : "full-window-sma;full-window-rma";
    if (
      reviewed.kind !== "recursive" ||
      reviewed.lookbackBars !== null ||
      reviewed.seedPolicy !== seedPolicy ||
      reviewed.convergence !== "full-input-dependent"
    )
      throw new RangeError("Unexpected reviewed recursive Keltner history");
    historyRequirement = {
      kind: "recursive",
      lookbackBars: null,
      seedBars: reviewed.seedBars,
      seedPolicy,
      convergence: "full-input-dependent"
    };
  }
  return {
    warmupBars: metadata.warmupBars,
    firstReadyBars: metadata.firstReadyBars,
    historyRequirement
  };
}
export function calculateKeltner(
  instance: KeltnerInstance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = keltnerMetadata(instance),
    unavailableReason = technicalCalculationUnavailableReason(instance, bars.length);
  const empty = () => Array<null>(bars.length).fill(null);
  const series = unavailableReason
    ? { basis: empty(), upper: empty(), lower: empty() }
    : { ...keltnerChannels(bars, instance.params) };
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
