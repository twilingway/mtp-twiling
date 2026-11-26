import type { IChartApi, ISeriesApi } from "lightweight-charts";

export function projectedBaseDelta(
  scale: ReturnType<IChartApi["timeScale"]>,
  candleCount: number
): number {
  const range = candleCount ? scale.getVisibleLogicalRange() : null;
  if (!range) return 0;
  // The SDK defines current right border = rightOffset + the last finite series index.
  return Math.max(0, Math.round(range.to - scale.scrollPosition() - (candleCount - 1)));
}

export function preserveLightweightProjection(
  chart: IChartApi,
  action: () => void,
  projectionDelta: () => number
): void {
  const scale = chart.timeScale();
  const before = projectionDelta(),
    candleOffset = scale.scrollPosition() + before;
  action();
  const after = projectionDelta(),
    rightOffset = candleOffset - after;
  if ((before || after) && scale.scrollPosition() !== rightOffset)
    scale.applyOptions({ rightOffset });
}

export function preserveLightweightCamera(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  action: () => void,
  projectionDelta: () => number = () => 0
): void {
  const scale = chart.timeScale(),
    spacing = scale.options().barSpacing,
    candleOffset = scale.scrollPosition() + projectionDelta();
  const price = series.priceScale(),
    manual = !price.options().autoScale;
  const range = manual ? price.getVisibleRange() : null;
  action();
  const offset = candleOffset - projectionDelta();
  if (scale.options().barSpacing !== spacing || scale.scrollPosition() !== offset)
    scale.applyOptions({ barSpacing: spacing, rightOffset: offset });
  if (manual && range) {
    if (price.options().autoScale) price.applyOptions({ autoScale: false });
    const after = price.getVisibleRange();
    if (!after || after.from !== range.from || after.to !== range.to) price.setVisibleRange(range);
  }
}
