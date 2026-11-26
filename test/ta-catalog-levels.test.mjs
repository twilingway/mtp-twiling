import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { levelStudies } = load("model/technical-indicators/catalog-expansion/levels.js");
const { priceLevelHistoryRequest, standardPivotRegions, multiTimePeriodRegions } = load(
  "model/technical-indicators/catalog-expansion/level-periods.js"
);
const { compilePresentation } = load("model/technical-indicators/presentation.js");
const [williams, zigzag, pivots, adr] = levelStudies;
const context = { historicalVolatilityPeriodsPerYear: 365 };
const minute = 60_000;
const day = 86_400_000;
const bar = (timestamp, price, range = 0) => ({
  timestamp,
  open: price,
  high: price === null ? null : price + range,
  low: price,
  close: price,
  volume: 10
});
const candles = (prices) => prices.map((price, index) => bar(index * minute, price));

function compile(study, bars, series) {
  return compilePresentation(study.definition.presentation, {
    timestamps: bars.map(({ timestamp }) => timestamp),
    series,
    visible: true,
    collapsed: false
  });
}

test("Williams fractals wait for a closed right window and display above and below the center", () => {
  const bars = candles([10, 11, 12, 11, 10]);
  bars[2].low = 5;
  const params = { radius: 2 };
  assert.deepEqual(williams.calculate(bars, params, context), {
    high: [null, null, null, null, null],
    low: [null, null, null, null, null]
  });

  const confirmed = {
    high: [null, null, 12, null, null],
    low: [null, null, 5, null, null]
  };
  assert.deepEqual(
    williams.calculate(bars, params, { ...context, lastBarClosed: true }),
    confirmed
  );
  assert.deepEqual(williams.calculate([...bars, bar(5 * minute, 10)], params, context), {
    high: [...confirmed.high, null],
    low: [...confirmed.low, null]
  });
  const { plots } = compile(williams, bars, confirmed);
  assert.deepEqual(
    plots.map(({ geometry: { kind, shape, placement } }) => [kind, shape, placement]),
    [
      ["marker", "triangle-down", "above"],
      ["marker", "triangle-up", "below"]
    ]
  );
});

test("Pivot Points High Low uses independent windows and plots only confirmed candles", () => {
  const bars = candles([2, 5, 4, 1, 3, 2]);
  const params = { highLeft: 1, highRight: 2, lowLeft: 2, lowRight: 1 };
  const result = pivots.calculate(bars, params, context);
  assert.deepEqual(result, {
    high: [null, 5, null, null, null, null],
    low: [null, null, null, 1, null, null]
  });
  assert.equal(pivots.history(params).warmupBars, 4);
  assert.equal(pivots.history({ ...params, highLeft: 4 }).historyRequirement.lookbackBars, 7);
  assert.ok(
    compile(pivots, bars, result).plots.every(({ geometry }) => geometry.shape === "circle")
  );
});

test("Zigzag replaces a pivot, interpolates known segments and avoids bridging a gap", () => {
  const bars = candles([90, 100, 96, 110, 105, 101, 99, 101, null, 9, 6, 8, 7, 9]);
  const params = { pivotLegs: 2, deviationPercent: 10 };
  const result = zigzag.calculate(bars, params, context);
  assert.deepEqual(result.value, [
    null,
    null,
    null,
    110,
    106.33333333333334,
    102.66666666666667,
    99,
    null,
    null,
    null,
    6,
    8,
    null,
    null
  ]);
  assert.equal(zigzag.calculate(bars, params, { ...context, lastBarClosed: true }).value[12], 7);
  assert.equal(zigzag.history(params).historyRequirement.convergence, "full-input-dependent");
  assert.deepEqual(compile(zigzag, bars, result).plots[0].geometry, {
    kind: "line",
    gaps: "break"
  });
});

test("Daily ADR follows the requested count of known daily ranges and preserves missing values", () => {
  const bars = [bar(day, 10, 4), bar(day * 2, null), bar(day * 3, 11, 8), bar(day * 4, 20, 2)];
  const params = { length: 2 };
  assert.deepEqual(adr.calculate(bars, params, { ...context, chartInterval: "1d" }).value, [
    null,
    null,
    6,
    5
  ]);
  assert.deepEqual(adr.calculate(bars, params, { ...context, chartInterval: "1h" }).value, [
    null,
    null,
    null,
    null
  ]);
  assert.equal(adr.history(params).historyRequirement.convergence, "exact-after-dense-lookback");
});

const period = (start, end, open, high, low, close, followsPrevious) => ({
  startsAt: start * day,
  endsAt: end * day,
  open,
  high,
  low,
  close,
  followsPrevious
});

test("Level history requests name the source interval and ask for one preceding trading period", () => {
  const timeline = [day, day * 10];
  assert.deepEqual(priceLevelHistoryRequest("5m", "auto", timeline, "standard-pivots"), {
    interval: "1d",
    from: day,
    to: day * 10,
    precedingTradingPeriods: 1
  });
  assert.equal(priceLevelHistoryRequest("1h", "auto", timeline, "standard-pivots").interval, "1w");
  assert.equal(priceLevelHistoryRequest("1d", "auto", timeline, "standard-pivots").interval, "1M");
  assert.equal(
    priceLevelHistoryRequest("1d", "auto", timeline, "multi-time-period").interval,
    "1w"
  );
  assert.equal(priceLevelHistoryRequest("1M", "1w", timeline, "standard-pivots"), null);
  assert.equal(priceLevelHistoryRequest("1d", "auto", [], "standard-pivots"), null);
});

test("Standard Pivots plot period-local horizontal lines and leave an explicit missing period empty", () => {
  const timeline = [day * 3, day * 3 + minute, day * 4, day * 6];
  const source = [
    period(0, 1, 10, 18, 9, 12),
    period(3, 4, 12, 20, 10, 15, true),
    period(4, 5, 17, 19, 16, 18, true),
    period(6, 7, 17, 19, 16, 18, false)
  ];
  const display = { method: "woodie", periodsBack: 3, showLabels: true, showPrices: true };
  const pivots = standardPivotRegions(timeline, source, display).filter(
    ({ styleId }) => styleId === "P"
  );
  assert.deepEqual(pivots, [
    {
      styleId: "P",
      startTimestamp: day * 3,
      endTimestamp: day * 3 + minute,
      startEdge: "left",
      endEdge: "right",
      low: 12.75,
      high: 12.75,
      label: { name: "P", price: 12.75 }
    },
    {
      styleId: "P",
      startTimestamp: day * 4,
      endTimestamp: day * 4,
      startEdge: "left",
      endEdge: "right",
      low: 16,
      high: 16,
      label: { name: "P", price: 16 }
    }
  ]);
  const latest = standardPivotRegions(timeline, source, {
    ...display,
    periodsBack: 1,
    showPrices: false
  });
  assert.ok(latest.length > 0);
  assert.ok(
    latest.every(({ startTimestamp, label }) => startTimestamp === day * 4 && !("price" in label))
  );
});

test("Standard Pivots preserves whole latest periods under the total line limit", () => {
  const timeline = Array.from({ length: 100 }, (_, index) => index * day);
  const source = timeline.map((_, index) => period(index, index + 1, 10, 16, 4, 11, true));
  const lines = standardPivotRegions(timeline, source, {
    method: "traditional",
    periodsBack: 500,
    showLabels: false,
    showPrices: false
  });
  assert.equal(lines.length, 45 * 11);
  assert.equal(lines[0].startTimestamp, day * 55);
  assert.equal(lines.at(-1).endTimestamp, day * 99);
});

test("Multi-time charts project both OHLC boxes into the source period's chart slots", () => {
  const source = [period(2, 3, 15, 18, 11, 12), period(3, 4, 18, 20, 16, 19, true)];
  const timeline = [3 * day + minute, 3 * day + minute * 2];
  const ohlc = multiTimePeriodRegions(timeline, source, "ohlc");
  assert.deepEqual(
    ohlc.map(({ styleId, low, high }) => [styleId, low, high]),
    [
      ["high-low-up", 16, 20],
      ["open-close-up", 18, 19]
    ]
  );
  assert.ok(
    ohlc.every(
      ({ startTimestamp, endTimestamp }) =>
        startTimestamp === timeline[0] && endTimestamp === timeline[1]
    )
  );
  const [trueRange] = multiTimePeriodRegions(timeline, source, "true-range");
  assert.equal(trueRange.low, 12);
});
