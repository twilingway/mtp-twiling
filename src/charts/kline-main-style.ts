import { CandleType } from "klinecharts";
import type { CandleStyle, DeepPartial } from "klinecharts";
import { NATIVE_CHART_LINE, resolveNativeChartType } from "../model/native-chart-type.js";
import type { ChartSettings } from "../model/types.js";
import { barColors } from "../model/bar-palette.js";

export function klineMainStyle(settings: ChartSettings): DeepPartial<CandleStyle> {
  const type = resolveNativeChartType(settings),
    color = NATIVE_CHART_LINE;
  if (type === "candles") return { type: CandleType.CandleSolid };
  if (type === "bars") {
    const colors = barColors(settings);
    return {
      type: CandleType.Ohlc,
      bar: {
        ...colors,
        noChangeColor: colors.upColor
      }
    };
  }
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

export function klineBarStyle(
  settings: ChartSettings,
  overrides: DeepPartial<CandleStyle["bar"]> = {}
): DeepPartial<CandleStyle["bar"]> {
  return {
    noChangeColor: settings.bodyVisible === false ? "transparent" : (settings.upColor ?? "#53b987"),
    noChangeBorderColor:
      settings.borderVisible === false ? "transparent" : (settings.borderUpColor ?? "#53b987"),
    noChangeWickColor:
      settings.wickVisible === false ? "transparent" : (settings.wickUpColor ?? "#336854"),
    upColor: settings.bodyVisible === false ? "transparent" : (settings.upColor ?? "#53b987"),
    downColor: settings.bodyVisible === false ? "transparent" : (settings.downColor ?? "#eb4d5c"),
    upBorderColor:
      settings.borderVisible === false ? "transparent" : (settings.borderUpColor ?? "#53b987"),
    downBorderColor:
      settings.borderVisible === false ? "transparent" : (settings.borderDownColor ?? "#eb4d5c"),
    upWickColor:
      settings.wickVisible === false ? "transparent" : (settings.wickUpColor ?? "#336854"),
    downWickColor:
      settings.wickVisible === false ? "transparent" : (settings.wickDownColor ?? "#7f323f"),
    ...overrides
  };
}
