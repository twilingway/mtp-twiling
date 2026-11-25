import type { IChartApi, ISeriesApi } from "lightweight-charts";

export function preserveLightweightCamera(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  action: () => void
): void {
  const scale = chart.timeScale(),
    spacing = scale.options().barSpacing,
    offset = scale.scrollPosition();
  const price = series.priceScale(),
    manual = !price.options().autoScale;
  const range = manual ? price.getVisibleRange() : null;
  action();
  if (scale.options().barSpacing !== spacing || scale.scrollPosition() !== offset)
    scale.applyOptions({ barSpacing: spacing, rightOffset: offset });
  if (manual && range) {
    if (price.options().autoScale) price.applyOptions({ autoScale: false });
    const after = price.getVisibleRange();
    if (!after || after.from !== range.from || after.to !== range.to) price.setVisibleRange(range);
  }
}
