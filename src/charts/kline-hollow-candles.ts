import { IndicatorSeries, registerIndicator } from "klinecharts";
import type { Chart, IndicatorDrawParams } from "klinecharts";
import type { ChartSettings } from "../model/types.js";
import { hollowCandleStyler } from "../model/hollow-candles.js";

const NAME = "MTP_HOLLOW_CANDLES";
let registered = false;
type Styler = ReturnType<typeof hollowCandleStyler>;
type HollowDrawParams = Pick<
  IndicatorDrawParams<never>,
  "ctx" | "kLineDataList" | "visibleRange" | "barSpace" | "xAxis" | "yAxis"
>;

/** KLine's stock candle colors cannot compare with the previous close. */
export function drawKlineHollowCandles(params: HollowDrawParams, style: Styler): boolean {
  const { ctx, kLineDataList: data, visibleRange, barSpace, xAxis, yAxis } = params;
  const width = Math.max(1, Math.round(barSpace.gapBar));
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    if (color === "transparent" || w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  for (
    let index = Math.max(0, visibleRange.from);
    index < Math.min(data.length, visibleRange.to);
    index++
  ) {
    const bar = data[index]!;
    const colors = style(bar, data[index - 1]?.close);
    const x = Math.round(xAxis.convertToPixel(index));
    const high = Math.round(yAxis.convertToPixel(bar.high));
    const low = Math.round(yAxis.convertToPixel(bar.low));
    const a = Math.round(yAxis.convertToPixel(bar.open));
    const b = Math.round(yAxis.convertToPixel(bar.close));
    if (![x, high, low, a, b].every(Number.isFinite)) continue;
    const top = Math.min(a, b),
      bottom = Math.max(a, b),
      height = bottom - top + 1,
      wickTop = Math.min(high, low),
      wickBottom = Math.max(high, low);
    const left = x - Math.floor(width / 2);
    // Wicks stop at the body edges; a hollow interior never has a wick running through it.
    rect(colors.wickColor, x, wickTop, 1, top - wickTop);
    rect(colors.wickColor, x, bottom + 1, 1, wickBottom - bottom);
    rect(colors.color, left, top, width, height);
    rect(colors.borderColor, left, top, width, 1);
    if (height > 1) rect(colors.borderColor, left, top + height - 1, width, 1);
    if (height > 2) {
      rect(colors.borderColor, left, top + 1, 1, height - 2);
      if (width > 1) rect(colors.borderColor, left + width - 1, top + 1, 1, height - 2);
    }
  }
  return true;
}

export function initializeKlineHollowCandles(chart: Chart, settings: ChartSettings): void {
  if (settings.chartType !== "hollowCandles") return;
  if (!registered) {
    registerIndicator({
      name: NAME,
      shortName: "",
      series: IndicatorSeries.Price,
      zLevel: 0,
      figures: [],
      calc: () => [],
      draw: (params) => drawKlineHollowCandles(params, params.indicator.extendData as Styler)
    });
    registered = true;
  }
  chart.createIndicator({ name: NAME, extendData: hollowCandleStyler(settings) }, true, {
    id: "candle_pane"
  });
}
