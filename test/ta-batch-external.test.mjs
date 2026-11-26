import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const {
  advanceDeclineBreadth,
  advanceDeclineRatioBars,
  correlationCoefficient,
  openInterestSeries,
  priceTargetLevels
} = load("model/technical-indicators/ta-batch-external.js");
const { RATING_AVERAGE_LENGTHS, technicalRatingCategory, technicalRatings } = load(
  "model/technical-indicators/ta-batch-external-ratings.js"
);

const bar = (timestamp, close, open = close) => ({
  timestamp,
  open,
  close,
  low: null,
  high: null,
  volume: null
});

test("Market breadth uses signed net counts and retains real zeros", () => {
  const data = [
    { timestamp: 1, advancing: 60, declining: 40 },
    { timestamp: 2, advancing: 5, declining: 10 },
    { timestamp: 3, advancing: 0, declining: 10 },
    { timestamp: 4, advancing: 3, declining: 0 }
  ];
  assert.deepEqual(advanceDeclineBreadth([1, 2, 3, 4], data, 10), {
    line: [30, 25, 15, 18],
    ratio: [1.5, 0.5, 0, null]
  });
  assert.deepEqual(
    advanceDeclineBreadth(
      [1, 2, 3, 4],
      data.filter(({ timestamp }) => timestamp !== 2)
    ),
    {
      line: [20, null, null, null],
      ratio: [1.5, null, 0, null]
    }
  );
  assert.throws(() => advanceDeclineBreadth([1], [{ timestamp: 1, advancing: -1, declining: 0 }]));
});

test("Bars ratio uses the candle body and recovers after a missing bar exits the window", () => {
  const bars = [
    bar(1, 8, 10),
    bar(2, 7, 5),
    bar(3, 6, 6),
    bar(4, null, 10),
    bar(5, 5, 7),
    bar(6, 11, 10),
    bar(7, 10, 9),
    bar(8, 7, 6)
  ];
  assert.deepEqual(advanceDeclineRatioBars(bars, 3), [null, null, 1, null, null, null, 2, null]);
  assert.deepEqual(advanceDeclineRatioBars([bar(1, 1, 2)], 1), [0]);
});

test("Correlation aligns candles by timestamp and requires a complete matched window", () => {
  const closes = [2, 3, 6, 9, 12, 20];
  const primary = closes.map((value, i) => bar(i + 1, value));
  const comparison = [9, null, 6, 3, 0, -8].flatMap((value, i) =>
    value === null ? [] : [bar(i + 1, value)]
  );
  const result = correlationCoefficient(primary, comparison, 3);
  assert.deepEqual(result.slice(0, 4), [null, null, null, null]);
  assert.ok(Math.abs(result[4] + 1) < 1e-12);
  assert.ok(Math.abs(result[5] + 1) < 1e-12);
  assert.throws(() => correlationCoefficient(primary, [bar(1, 2), bar(1, 4)], 2));
  assert.throws(() => correlationCoefficient(primary, comparison, 1));
});

test("Correlation handles large finite values, flat sources and a configured price source", () => {
  const values = [-1e300, 1e300, 1e299];
  const primary = values.map((value, i) => bar(i + 1, 5, value));
  const comparison = values.map((value, i) => bar(i + 1, 12, i === 2 ? value * 2 : value));
  assert.deepEqual(correlationCoefficient(primary, comparison, 3), [null, null, null]);
  const result = correlationCoefficient(primary, comparison, 3, "open");
  assert.ok(result[2] > 0.99 && result[2] < 1);
});

test("Open interest preserves units and gaps across contract-specific observations", () => {
  const series = {
    instrumentKey: "okx:linear:BTC-USDT-SWAP",
    unit: { kind: "contracts" },
    rows: [
      { timestamp: 1, value: 150 },
      { timestamp: 3, value: 0 }
    ]
  };
  assert.deepEqual(openInterestSeries(series.instrumentKey, [1, 2, 3, 4], series), {
    unit: { kind: "contracts" },
    values: [150, null, 0, null]
  });
  assert.throws(() => openInterestSeries("bybit:linear:BTCUSDT", [1], series));
  assert.throws(() =>
    openInterestSeries(series.instrumentKey, [1], {
      ...series,
      rows: [{ timestamp: 1, value: -1 }]
    })
  );
});

test("Price target percentages require a dated supplier forecast and matching close", () => {
  const forecast = {
    instrumentKey: "bank:asset",
    currency: "RUB",
    publicationTimestamp: 20,
    horizonTimestamp: 31_536_000_020,
    analystCount: 4,
    low: 75,
    mean: 100,
    high: 125
  };
  const quote = { instrumentKey: "bank:asset", currency: "rub", timestamp: 10, close: 100 };
  const outcome = priceTargetLevels(forecast, quote, 20);
  assert.deepEqual(outcome, {
    currency: "RUB",
    publicationTimestamp: 20,
    horizonTimestamp: forecast.horizonTimestamp,
    analystCount: 4,
    origin: { timestamp: 10, price: 100 },
    levels: {
      low: { price: 75, changePercent: -25 },
      mean: { price: 100, changePercent: 0 },
      high: { price: 125, changePercent: 25 }
    }
  });
  assert.equal(priceTargetLevels(forecast, quote, 19), null);
  assert.equal(priceTargetLevels(forecast, { ...quote, currency: "USD" }, 20), null);
  assert.equal(priceTargetLevels(forecast, { ...quote, timestamp: 21 }, 20), null);
  assert.equal(priceTargetLevels(forecast, { ...quote, close: 0 }, 20), null);
  assert.equal(priceTargetLevels({ ...forecast, mean: 0 }, quote, 20), null);
});

const change = (current, previous = current) => ({ current, previous });

function neutral() {
  const averages = Object.fromEntries(RATING_AVERAGE_LENGTHS.map((length) => [length, 100]));
  return {
    close: 100,
    averages: {
      sma: { ...averages },
      ema: { ...averages },
      hull9: 100,
      volumeWeighted20: 100,
      cloud: { conversion: 100, base: 100, leadingA: 100, leadingB: 100 }
    },
    oscillators: {
      rsi14: change(50),
      stochastic14_3_3: { k: 50, d: 50 },
      cci20: change(0),
      adx14_14: { ...change(20), plusDI: 15, minusDI: 15 },
      awesome: { ...change(0), twoBack: 0 },
      momentum10: change(0),
      macd12_26_9: { value: 0, signal: 0 },
      stochasticRsi14_14_3_3: { k: 50, d: 50, trend: "flat" },
      williamsR14: change(-50),
      bullBear13: { bull: change(0), bear: change(0), trend: "flat" },
      ultimate7_14_28: 50
    }
  };
}

const oscillatorFixtures = [
  ["rsi14", change(20, 10), change(80, 90)],
  ["stochastic14_3_3", { k: 15, d: 10 }, { k: 85, d: 90 }],
  ["cci20", change(-110, -120), change(110, 120)],
  [
    "adx14_14",
    { ...change(25, 22), plusDI: 20, minusDI: 10 },
    { ...change(25, 26), plusDI: 10, minusDI: 20 }
  ],
  ["awesome", { ...change(1, 0), twoBack: -1 }, { ...change(-1, 0), twoBack: 1 }],
  ["momentum10", change(1, 0), change(-1, 0)],
  ["macd12_26_9", { value: 1, signal: 0 }, { value: -1, signal: 0 }],
  ["stochasticRsi14_14_3_3", { k: 15, d: 10, trend: "down" }, { k: 85, d: 90, trend: "up" }],
  ["williamsR14", change(-85, -90), change(-15, -10)],
  [
    "bullBear13",
    { bull: change(1), bear: change(-1, -2), trend: "up" },
    { bull: change(1, 2), bear: change(-1), trend: "down" }
  ],
  ["ultimate7_14_28", 71, 29]
];

for (const [key, buy, sell] of oscillatorFixtures) {
  test(`Technical ratings apply the public buy/sell rules for ${key}`, () => {
    const baseline = neutral();
    for (const [value, multiplier] of [
      [buy, 1],
      [sell, -1]
    ]) {
      const result = technicalRatings({
        ...baseline,
        oscillators: { ...baseline.oscillators, [key]: value }
      });
      assert.deepEqual(result.averages, { value: 0, category: "neutral" });
      assert.deepEqual(result.oscillators, { value: multiplier / 11, category: "neutral" });
      assert.deepEqual(result.overall, { value: multiplier / 22, category: "neutral" });
    }
  });
}

test("Technical ratings weight groups equally, and thresholds include exact bounds", () => {
  const baseline = neutral();
  const lowAverages = Object.fromEntries(RATING_AVERAGE_LENGTHS.map((length) => [length, 94]));
  baseline.averages = {
    sma: lowAverages,
    ema: lowAverages,
    hull9: 94,
    volumeWeighted20: 94,
    cloud: { conversion: 99, base: 98, leadingA: 97, leadingB: 96 }
  };
  assert.deepEqual(technicalRatings(baseline), {
    averages: { value: 1, category: "strong-buy" },
    oscillators: { value: 0, category: "neutral" },
    overall: { value: 0.5, category: "buy" }
  });
  const highAverages = Object.fromEntries(RATING_AVERAGE_LENGTHS.map((length) => [length, 106]));
  baseline.averages = {
    sma: highAverages,
    ema: highAverages,
    hull9: 106,
    volumeWeighted20: 106,
    cloud: { conversion: 101, base: 102, leadingA: 103, leadingB: 104 }
  };
  assert.deepEqual(technicalRatings(baseline).averages, { value: -1, category: "strong-sell" });
  assert.deepEqual([-0.501, -0.5, -0.1, 0.1, 0.5, 0.501].map(technicalRatingCategory), [
    "strong-sell",
    "sell",
    "neutral",
    "neutral",
    "buy",
    "strong-buy"
  ]);
});

test("Technical ratings retain the complete group and defer the missing group and overall result", () => {
  const baseline = neutral();
  baseline.oscillators.stochasticRsi14_14_3_3.trend = null;
  assert.deepEqual(technicalRatings(baseline), {
    averages: { value: 0, category: "neutral" },
    oscillators: null,
    overall: null
  });
});
