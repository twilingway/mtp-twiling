import {
  cmf,
  chaikinOscillator,
  elderForceIndex,
  easeOfMovement,
  volumeOscillator,
  negativeVolumeIndex,
  positiveVolumeIndex,
  volumeFlowMetadata,
  volumeFlowPresets
} from "./volume-flow/index.js";
import type { VolumeFlowId } from "./volume-flow/metadata.js";
import type {
  NumericSeries,
  TechnicalBar,
  TechnicalIndicatorInstance,
  TechnicalIndicatorResult
} from "./types.js";

type VolumeFlowInstance = Extract<TechnicalIndicatorInstance, { definitionId: VolumeFlowId }>;

export function isVolumeFlowInstance(
  instance: TechnicalIndicatorInstance
): instance is VolumeFlowInstance {
  return volumeFlowPresets.some((preset) => preset.id === instance.definitionId);
}

function computeSeries(
  instance: VolumeFlowInstance,
  bars: readonly TechnicalBar[]
): Record<string, NumericSeries> {
  switch (instance.definitionId) {
    case "cmf":
      return { value: cmf(bars, instance.params.length) };
    case "chaikin-oscillator":
      return {
        value: chaikinOscillator(bars, instance.params.fastLength, instance.params.slowLength)
      };
    case "efi":
      return { value: elderForceIndex(bars, instance.params.length) };
    case "eom":
      return { value: easeOfMovement(bars, instance.params.length, instance.params.divisor) };
    case "volume-oscillator": {
      const calculated = volumeOscillator(bars, instance.params);
      return {
        oscillator: calculated.oscillator,
        signal: calculated.signal,
        histogram: calculated.histogram
      };
    }
    case "nvi": {
      const calculated = negativeVolumeIndex(bars, instance.params.emaLength);
      return { index: calculated.index, average: calculated.average };
    }
    case "pvi": {
      const calculated = positiveVolumeIndex(bars, instance.params.emaLength);
      return { index: calculated.index, average: calculated.average };
    }
  }
}

/** Called only after the shared runtime validates the instance and real candle input. */
export function calculateVolumeIndicator(
  instance: VolumeFlowInstance,
  bars: readonly TechnicalBar[]
): TechnicalIndicatorResult {
  const metadata = volumeFlowMetadata(instance.definitionId, instance.params);
  const available = bars.some(
    (bar) => bar.volume !== null && Number.isFinite(bar.volume) && bar.volume > 0
  );
  const preset = volumeFlowPresets.find((item) => item.id === instance.definitionId)!;
  const series = available
    ? computeSeries(instance, bars)
    : Object.fromEntries(preset.outputs.map((output) => [output.id, bars.map(() => null)]));
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    status: "computed",
    timestamps: bars.map((bar) => bar.timestamp),
    warmupBars: metadata.warmupBars,
    historyRequirement: metadata.historyRequirement,
    ...(!available ? { unavailableReason: "volume-unavailable" as const } : {}),
    series
  };
}
