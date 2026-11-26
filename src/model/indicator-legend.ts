import type { ChartSettings, IndicatorFlags, IndicatorKey } from "./types.js";
const order: readonly IndicatorKey[] = [
  "volume",
  "mtpAll",
  "mtp640",
  "mtp440",
  "mtp160",
  "ma",
  "ema"
];
export function indicatorShown(
  settings: ChartSettings,
  flags: IndicatorFlags,
  key: IndicatorKey
): boolean {
  return !!flags[key] && (key !== "mtpAll" || settings.mtpAllHidden !== true);
}

export function indicatorLegendKeys(
  settings: ChartSettings,
  flags: IndicatorFlags
): IndicatorKey[] {
  return order.filter(
    (key) =>
      !settings.removedIndicators?.includes(key) &&
      !(flags.mtpAll && ["mtp160", "mtp440", "mtp640"].includes(key)) &&
      ((key.startsWith("mtp") && key !== "mtpAll") ||
        key === "volume" ||
        flags[key] ||
        settings.indicatorOptions?.[key])
  );
}
