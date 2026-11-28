import type { CandlestickData, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Candle, ChartSettings } from "../model/types.js";
import { hollowCandleStyler } from "../model/hollow-candles.js";

/** Native per-bar styles keep hollow interiors transparent, including the grid behind them. */
export function lightweightHollowCandles(settings: ChartSettings) {
  const style = hollowCandleStyler(settings);
  let data: Candle[] = [];
  const row = (index: number): CandlestickData<UTCTimestamp> => {
    const bar = data[index]!;
    const { color, borderColor, wickColor } = style(bar, data[index - 1]?.close);
    return {
      time: Math.floor(bar.timestamp / 1000) as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      color,
      borderColor,
      wickColor
    };
  };
  return {
    setData(bars: readonly Candle[]) {
      data = [...bars];
      return data.map((_bar, index) => row(index));
    },
    update(
      series: ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area">,
      bar: Candle,
      historical: boolean
    ) {
      // The hot path neither maps nor searches the full history.
      let index = data.length - 1;
      if (bar.timestamp > (data[index]?.timestamp ?? -Infinity)) {
        data.push(bar);
        index++;
      } else if (data[index]?.timestamp === bar.timestamp) data[index] = bar;
      else {
        let from = 0,
          to = data.length;
        while (from < to) {
          const middle = (from + to) >>> 1;
          if (data[middle]!.timestamp < bar.timestamp) from = middle + 1;
          else to = middle;
        }
        index = from;
        if (data[index]?.timestamp !== bar.timestamp) return;
        data[index] = bar;
      }
      series.update(row(index), historical);
      // A corrected close changes the next candle's direction, even if its OHLC is untouched.
      if (index + 1 < data.length) series.update(row(index + 1), true);
    }
  };
}
