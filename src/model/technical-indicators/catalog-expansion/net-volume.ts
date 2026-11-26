import { shiftTimeframe } from "../../intervals/calendar.js";
import { isNativeIntervalId } from "../../intervals/registry.js";
import type { NativeIntervalId } from "../../intervals/registry.js";
import type { SpotTradeHistory } from "../../market-trades.js";
import type { NumericSeries, TechnicalBar } from "../types.js";
import { netVolume } from "../ta-batch-volume-flow.js";
import { defineCatalogStudy } from "./contract.js";

export interface NetVolumeStudyParameters {
  "net-volume": Record<never, never>;
}

export interface NetVolumeHistoryRequirement {
  readonly kind: "spot-trades";
  readonly lookbackBars: null;
  readonly seedPolicy: "prior-actual-trade";
  readonly convergence: "exact-on-complete-window";
}

const biasKey = "$netVolume:direction";
const up = "#158977";
const down = "#df4c54";

export function netVolumeForChart(
  bars: readonly TechnicalBar[],
  timeframe: NativeIntervalId,
  input: SpotTradeHistory | undefined
): NumericSeries {
  const coverage = input?.coverage;
  const prior = input?.previous;
  if (!input || !coverage || !prior || prior.timestamp >= coverage.from)
    return bars.map(() => null);
  let cursor = 0;
  let lastPrice = prior.price;
  return netVolume(
    bars.map(({ timestamp }) => {
      const end = shiftTimeframe(timestamp, timeframe, 1);
      if (timestamp < coverage.from || end > coverage.to)
        return { uptickVolume: null, downtickVolume: null };
      while (cursor < input.trades.length && input.trades[cursor]!.timestamp < timestamp)
        lastPrice = input.trades[cursor++]!.price;
      let uptickVolume = 0;
      let downtickVolume = 0;
      while (cursor < input.trades.length && input.trades[cursor]!.timestamp < end) {
        const trade = input.trades[cursor++]!;
        if (trade.price > lastPrice) uptickVolume += trade.quantity;
        else if (trade.price < lastPrice) downtickVolume += trade.quantity;
        lastPrice = trade.price;
      }
      return {
        uptickVolume: Number.isFinite(uptickVolume) ? uptickVolume : null,
        downtickVolume: Number.isFinite(downtickVolume) ? downtickVolume : null
      };
    })
  );
}

export const netVolumeStudy = defineCatalogStudy<
  "net-volume",
  NetVolumeStudyParameters["net-volume"]
>({
  catalogId: "STD;Net%1Volume",
  definition: {
    schemaVersion: 1,
    id: "net-volume",
    title: "Net Volume",
    shortTitle: "Net volume",
    status: "computed",
    defaultPane: "pane",
    parameters: [],
    outputs: [{ id: "value", title: "Net volume", kind: "histogram", color: up }],
    levels: [0],
    references: [
      "https://www.tradingview.com/support/solutions/43000589192-net-volume/",
      "https://app.okx.com/docs-v5/en/#rest-api-market-data-get-trades-history"
    ],
    presentation: {
      renderVersion: 2,
      plots: [
        {
          id: "value",
          seriesKey: "value",
          geometry: { kind: "columns", base: 0 },
          color: { kind: "indexed", seriesKey: biasKey, colors: [down, up] },
          width: 1
        }
      ],
      fills: [],
      hiddenSeries: [biasKey]
    }
  },
  history: () => ({
    warmupBars: 1,
    historyRequirement: {
      kind: "spot-trades",
      lookbackBars: null,
      seedPolicy: "prior-actual-trade",
      convergence: "exact-on-complete-window"
    }
  }),
  unavailableReason: (_count, _params, context) =>
    isNativeIntervalId(context?.chartInterval) && context?.volumeStudies?.netVolumeTrades?.coverage
      ? undefined
      : "volume-unavailable",
  calculate: (bars, _params, context) => {
    const timeframe = context?.chartInterval;
    const value = isNativeIntervalId(timeframe)
      ? netVolumeForChart(bars, timeframe, context?.volumeStudies?.netVolumeTrades)
      : bars.map(() => null);
    return {
      value,
      [biasKey]: value.map((sample) => (sample === null ? null : Number(sample >= 0)))
    };
  }
});
