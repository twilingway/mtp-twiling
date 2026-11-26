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
  const hasSeparateMtp = !flags.mtpAll && (flags.mtp160 || flags.mtp440 || flags.mtp640);
  return order.filter((key) => {
    if (settings.removedIndicators?.includes(key)) return false;
    if (key === "mtp160" || key === "mtp440" || key === "mtp640") return hasSeparateMtp;
    return key === "volume" || flags[key] || settings.indicatorOptions?.[key];
  });
}
