import { CandleType } from "klinecharts";
import type { CandleStyle, DeepPartial } from "klinecharts";
import { NATIVE_CHART_LINE, resolveNativeChartType } from "../model/native-chart-type.js";
import type { ChartSettings } from "../model/types.js";

export function klineMainStyle(settings: ChartSettings): DeepPartial<CandleStyle> {
  const type = resolveNativeChartType(settings),
    color = NATIVE_CHART_LINE;
  if (type === "candles") return { type: CandleType.CandleSolid };
  if (type === "bars")
    return {
      type: CandleType.Ohlc,
      bar: {
        upColor: settings.upColor ?? "#53b987",
        downColor: settings.downColor ?? "#eb4d5c",
        noChangeColor: settings.upColor ?? "#53b987"
      }
    };
  return {
    type: CandleType.Area,
    area: {
      value: "close",
      smooth: false,
      lineColor: color.color,
      lineSize: color.width,
      point: { show: false },
      backgroundColor:
        type === "line"
          ? "transparent"
          : [
              { offset: 0, color: color.bottom },
              { offset: 1, color: color.top }
            ]
    }
  };
}
