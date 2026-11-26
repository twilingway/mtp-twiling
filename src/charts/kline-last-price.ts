import type { Chart } from "klinecharts";
import { lastPriceLabelColors, lastPriceStyle } from "../model/last-price-style.js";
import type { Candle, ChartSettings, PriceAxisLabelColors } from "../model/types.js";

type NativeChart = Pick<Chart, "setStyles">;

/** KLine 9.8 shares its last-price line color with the axis label background. */
export function klineLastPrice(settings: ChartSettings) {
  let custom = lastPriceLabelColors(settings);
  let up = lastPriceStyle(settings, true, custom),
    down = lastPriceStyle(settings, false, custom),
    text = up.text;
  const direction = (bar: Candle | undefined) => (bar && bar.close < bar.open ? down : up);
  const separate = () =>
    settings.priceLine !== false && (up.fill !== up.color || down.fill !== down.color);
  const styles = () => ({
    show: true,
    line: { show: settings.priceLine !== false && !separate() },
    upColor: up.fill,
    downColor: down.fill,
    noChangeColor: up.fill,
    text: { color: text, paddingLeft: 4, paddingRight: 4 }
  });
  return {
    styles,
    update(chart: NativeChart, bar: Candle | undefined) {
      const nextText = direction(bar).text;
      if (nextText === text) return;
      text = nextText;
      chart.setStyles({ candle: { priceMark: { last: { text: { color: text } } } } });
    },
    configure(chart: NativeChart, colors: PriceAxisLabelColors | null, bar: Candle | undefined) {
      if (colors?.fill === custom?.fill && colors?.text === custom?.text) return false;
      custom = colors;
      up = lastPriceStyle(settings, true, custom);
      down = lastPriceStyle(settings, false, custom);
      text = direction(bar).text;
      chart.setStyles({ candle: { priceMark: { last: styles() } } });
      return true;
    },
    paint(
      ctx: CanvasRenderingContext2D,
      bar: Candle | undefined,
      width: number,
      height: number,
      project: (bar: Candle) => number | undefined
    ) {
      if (!bar || !separate()) return;
      const y = project(bar);
      if (y === undefined || !Number.isFinite(y) || y < 0 || y > height) return;
      ctx.save();
      ctx.strokeStyle = direction(bar).color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.restore();
    }
  };
}
