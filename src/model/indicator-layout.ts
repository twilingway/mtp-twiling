import type { IndicatorPaneLayout } from "./types.js";
export const MIN_INDICATOR_HEIGHT_RATIO = 0.05;
export const MAX_INDICATOR_HEIGHT_RATIO = 0.8;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function isIndicatorPaneLayout(value: unknown): value is IndicatorPaneLayout {
  if (!record(value) || Object.keys(value).some((key) => key !== "volume")) return false;
  const volume = value.volume;
  return (
    volume === undefined ||
    (record(volume) &&
      Object.keys(volume).every((key) => key === "heightRatio") &&
      typeof volume.heightRatio === "number" &&
      Number.isFinite(volume.heightRatio) &&
      volume.heightRatio >= MIN_INDICATOR_HEIGHT_RATIO &&
      volume.heightRatio <= MAX_INDICATOR_HEIGHT_RATIO)
  );
}
export function volumeHeightRatio(layout: IndicatorPaneLayout | undefined): number | null {
  return isIndicatorPaneLayout(layout) ? (layout.volume?.heightRatio ?? null) : null;
}
export function capturedVolumeRatio(volumeHeight: number, priceHeight: number): number | null {
  if (
    !Number.isFinite(volumeHeight) ||
    !Number.isFinite(priceHeight) ||
    volumeHeight <= 0 ||
    priceHeight <= 0
  )
    return null;
  return (
    Math.round(
      Math.max(
        MIN_INDICATOR_HEIGHT_RATIO,
        Math.min(MAX_INDICATOR_HEIGHT_RATIO, volumeHeight / (priceHeight + volumeHeight))
      ) * 10_000
    ) / 10_000
  );
}
export function volumePaneHeight(ratio: number | null, availableHeight: number): number {
  if (ratio === null || !Number.isFinite(availableHeight) || availableHeight <= 0) return 95;
  return Math.max(30, Math.round(availableHeight * ratio));
}
