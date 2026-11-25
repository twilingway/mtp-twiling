import type { ChartSettings, IndicatorFlags, IndicatorKey } from "./types.js";
const order: readonly IndicatorKey[] = ["volume", "mtp640", "mtp440", "mtp160", "ma", "ema"];
export function indicatorLegendKeys(
  settings: ChartSettings,
  flags: IndicatorFlags
): IndicatorKey[] {
  return order.filter(
    (key) =>
      !settings.removedIndicators?.includes(key) &&
      (key.startsWith("mtp") || key === "volume" || flags[key] || settings.indicatorOptions?.[key])
  );
}
