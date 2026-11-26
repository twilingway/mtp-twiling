import type { ChartSettings, VolumeAverageSettings } from "./types.js";

export const DEFAULT_VOLUME_AVERAGE_PERIOD = 20;
export const MAX_VOLUME_AVERAGE_PERIOD = 10_000;

export function isVolumeAveragePeriod(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_VOLUME_AVERAGE_PERIOD
  );
}

export function volumeAverageSettings(settings: ChartSettings): VolumeAverageSettings {
  const average = settings.volumeAverage;
  return {
    enabled: average?.enabled === true,
    period: isVolumeAveragePeriod(average?.period) ? average.period : DEFAULT_VOLUME_AVERAGE_PERIOD
  };
}

export function volumeAverageWarmup(settings: ChartSettings, volumeVisible: boolean): number {
  const average = volumeAverageSettings(settings);
  return volumeVisible && average.enabled ? average.period : 0;
}

export function volumeSma(
  bars: readonly { volume?: number | undefined }[],
  period: number
): (number | null)[] {
  if (!isVolumeAveragePeriod(period)) throw new RangeError("Invalid volume average period");
  let consecutive = 0,
    mean = 0;
  return bars.map(({ volume }, index) => {
    if (volume === undefined || !Number.isFinite(volume) || volume < 0) {
      consecutive = 0;
      mean = 0;
      return null;
    }
    if (consecutive < period) {
      consecutive++;
      mean += (volume - mean) / consecutive;
    } else {
      mean += (volume - bars[index - period]!.volume!) / period;
    }
    return consecutive === period ? Math.max(0, mean) : null;
  });
}
