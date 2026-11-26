import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { anchoredStudies } = load("model/technical-indicators/catalog-expansion/anchored.ts");
const { anchoredPeriodStarts } = load(
  "model/technical-indicators/catalog-expansion/anchored-context.ts"
);
const { technicalCalculationContext } = load("charts/technical-calculation-context.ts");
const { technicalPlotData } = load("charts/technical-plot-offsets.ts");
const { TechnicalRenderData } = load("charts/technical-render-data.ts");
const { createTechnicalIndicatorInstance } = load("model/technical-indicators/instances.ts");
const { calculateTechnicalIndicator } = load("model/technical-indicators/runtime.ts");
const minute = 60000;
const day = 1440 * minute;
const start = Date.UTC(2026, 0, 1);
const bar = (timestamp, close, volume = 1) => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume
});
const bybit = {
  providerRef: { provider: "bybit", category: "spot", symbol: "BTCUSDT" },
  assetClass: "crypto",
  step: 0.1
};
const moex = { realExchange: "REAL_EXCHANGE_MOEX", step: 0.001 };

function study(id) {
  const definition = anchoredStudies.find(({ definition }) => definition.id === id);
  assert.ok(definition, id);
  return (bars, params = {}, context) =>
    definition.calculate(
      bars,
      {
        ...Object.fromEntries(
          definition.definition.parameters.map(({ key, defaultValue }) => [key, defaultValue])
        ),
        ...params
      },
      context
    );
}

test("period derivation uses the venue clock and declines unknown session openings", () => {
  const crypto = technicalCalculationContext("1m", bybit);
  const stocks = technicalCalculationContext("1m", moex);
  assert.equal(crypto.continuousSession, true);
  assert.equal(crypto.exchangeTimeZone, "UTC");
  assert.equal(crypto.chartIntervalDays, 1 / 1440);
  assert.equal(stocks.exchangeTimeZone, "Europe/Moscow");
  assert.equal(stocks.priceStep, 0.001);
  assert.equal(
    technicalCalculationContext("4h", { ...bybit, assetClass: "tokenized-stock" })
      .continuousSession,
    false
  );
  const bars = [
    bar(start - minute, 10),
    bar(start, 20),
    bar(start + minute, 30),
    bar(start + day + 4 * minute, 40)
  ];
  assert.deepEqual(anchoredPeriodStarts(bars, "session", crypto), [start]);
  assert.equal(anchoredPeriodStarts(bars, "session", stocks), null);
  const twoCivilDays = [
    bar(start - 3 * 60 * minute - minute, 10),
    bar(start - 3 * 60 * minute, 20)
  ];
  assert.deepEqual(anchoredPeriodStarts(twoCivilDays, "calendar-day", stocks), [
    twoCivilDays[1].timestamp
  ]);
  const confirmed = { ...stocks, anchoredPeriodStarts: { session: [start + minute] } };
  assert.deepEqual(anchoredPeriodStarts(bars, "session", confirmed), [start + minute]);
});

test("VWAP and TWAP reset only at known starts, Auto VWAP starts in the latest period", () => {
  const bars = [
    bar(start - minute, 10),
    bar(start, 20),
    bar(start + minute, 40, 3),
    bar(start + day, 80)
  ];
  const crypto = technicalCalculationContext("1m", bybit);
  const vwap = study("vwap"),
    auto = study("vwap-auto-anchored"),
    twap = study("twap");
  const v = vwap(bars, { source: "close", bandMode: "percent" }, crypto);
  assert.deepEqual(v.value, [null, 20, 35, 80]);
  assert.deepEqual(v.upper1, [null, 20.2, 35.35, 80.8]);
  assert.deepEqual(v.lower2, [null, null, null, null]);
  assert.deepEqual(twap(bars, {}, crypto).value, [null, 20, 30, 80]);
  assert.deepEqual(auto(bars, {}, crypto).value, [null, null, null, 80]);
  assert.deepEqual(auto(bars, { anchor: "highest-volume", length: 2 }, crypto).value, [
    null,
    null,
    40,
    50
  ]);
  assert.deepEqual(vwap(bars, {}, technicalCalculationContext("1m", moex)).value, [
    null,
    null,
    null,
    null
  ]);
});

test("visible average follows inclusive real candle slots and preserves full data for ordinary studies", () => {
  const bars = [bar(start, 7), bar(start + day, 13), bar(start + 2 * day, 19)];
  const calculation = new TechnicalRenderData(technicalCalculationContext("1d", bybit));
  const average = createTechnicalIndicatorInstance("visible-average-price", "viewport");
  const requests = [average];
  calculation.setData(bars);
  const values = () => calculation.compile(requests).outputs[0].values;
  assert.deepEqual(values(), [null, null, null]);
  assert.equal(calculation.setVisibleBars(-3, 1.4), true);
  assert.deepEqual(values(), [10, 10, null]);
  assert.equal(calculation.setVisibleBars(-1, 1.8), false);
  assert.equal(calculation.setVisibleBars(0.8, 4), true);
  assert.deepEqual(values(), [null, 16, 16]);
  assert.equal(calculation.setVisibleBars(5, 9), true);
  assert.deepEqual(values(), [null, null, null]);
  assert.deepEqual(
    bars.map(({ close }) => close),
    [7, 13, 19]
  );
});

test("plot offsets preserve kernel arrays and use real destinations across gaps", () => {
  const context = technicalCalculationContext("1d", bybit);
  const timestamps = [start, start + day, start + 4 * day, start + 6 * day];
  const series = { lead: [5, null, 7, 11], lag: [21, 23, 27, 29], base: [1, 2, 3, 4] };
  const result = { timestamps, series, barOffsets: { lead: 2, lag: -2 } };
  const plotted = technicalPlotData(result, context);
  assert.deepEqual(plotted.timestamps, [...timestamps, start + 7 * day, start + 8 * day]);
  assert.deepEqual(plotted.series.lead, [null, null, 5, null, 7, 11]);
  assert.deepEqual(plotted.series.lag, [27, 29, null, null, null, null]);
  assert.deepEqual(plotted.series.base, [1, 2, 3, 4, null, null]);
  assert.deepEqual(series.lead, [5, null, 7, 11]);
  assert.deepEqual(series.lag, [21, 23, 27, 29]);
  assert.equal(technicalPlotData({ ...result, barOffsets: { lead: 0 } }, context).series, series);
  const month = Date.UTC(2024, 0, 1);
  assert.deepEqual(
    technicalPlotData(
      { timestamps: [month], series: { lead: [4] }, barOffsets: { lead: 2 } },
      technicalCalculationContext("1M", bybit)
    ).timestamps,
    [month, Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1)]
  );
});

test("Ichimoku cloud and Alligator offsets persist as settings and shift only rendered data", () => {
  const data = Array.from({ length: 65 }, (_, i) => bar(start + i * day, 100 + i));
  const context = technicalCalculationContext("1d", bybit);
  const ichi = createTechnicalIndicatorInstance("ichimoku-cloud", "cloud");
  const alligator = createTechnicalIndicatorInstance("williams-alligator", "alligator");
  const ichiResult = calculateTechnicalIndicator(ichi, data, context);
  const alligatorResult = calculateTechnicalIndicator(alligator, data, context);
  assert.deepEqual(ichiResult.barOffsets, { spanA: 25, spanB: 25, lagging: -25 });
  assert.deepEqual(alligatorResult.barOffsets, { jaw: 8, teeth: 5, lips: 3 });
  assert.equal(ichiResult.series.lagging[0], 100);
  const calculation = new TechnicalRenderData(context);
  calculation.setData(data);
  const compiled = calculation.compile([ichi, alligator]);
  const plot = (instance, id) =>
    compiled.outputs.find((output) => output.instanceId === instance && output.outputId === id);
  assert.equal(plot("cloud", "spanA").values[50], ichiResult.series.spanA[25]);
  assert.equal(plot("cloud", "lagging").values[0], 125);
  assert.equal(plot("alligator", "jaw").values[72], alligatorResult.series.jaw[64]);
  assert.equal(plot("alligator", "jaw").timestamps[72], start + 72 * day);
  assert.equal(compiled.fills[0].belowColor, "#D14343");
  assert.equal(compiled.fills[0].from[50], plot("cloud", "spanA").values[50]);
  const hidden = calculation.compile([{ ...ichi, visible: false }]);
  assert.equal(hidden.outputs[0].timestamps.length, data.length);
  assert.equal(hidden.fills[0].visible, false);
});
