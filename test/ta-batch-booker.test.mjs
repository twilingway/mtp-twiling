import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { woodiesCci, rsiDivergence, bookerReversal, knoxvilleCondition } = load(
  "model/technical-indicators/ta-batch-booker-oscillators.ts"
);
const {
  BOOKER_INTRADAY_MINUTES,
  BOOKER_MISSED_PERIODS,
  BOOKER_ZIV_PERIODS,
  classicPreviousPeriodPivots,
  classicMissedPivots,
  projectClassicNextPivot
} = load("model/technical-indicators/ta-batch-booker-pivots.ts");

function candles(prices) {
  return prices.map((value, index) => ({
    timestamp: (index + 1) * 60000,
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 10
  }));
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("Woodies CCI defaults to 14 and 6 and colors six consecutive positive bars", () => {
  const result = woodiesCci(candles(Array.from({ length: 19 }, (_, index) => index + 2)));
  assert.deepEqual(result.fast.slice(0, 5), Array(5).fill(null));
  assert.deepEqual(result.slow.slice(0, 13), Array(13).fill(null));
  near(result.fast[5], (2.5 / 1.5) * (1 / 0.015));
  near(result.slow[13], (6.5 / 3.5) * (1 / 0.015));
  assert.deepEqual(result.histogram, result.slow);
  assert.deepEqual(result.trend.slice(13), [
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "pending",
    "rising"
  ]);
});

test("Woodies CCI uses HLC3, handles flat prices and restarts the color sequence on a missing bar", () => {
  const flat = woodiesCci(candles([10, null, 10, 10]), 3, 2);
  assert.deepEqual(flat.slow, [null, null, null, 0]);
  assert.deepEqual(flat.fast, [null, null, 0, 0]);
  const differentWick = candles([10, 10]);
  differentWick[1].high = 16;
  near(woodiesCci(differentWick, 2, 2).slow[1], 1 / 0.015);
  const falling = woodiesCci(candles([15, 14, 13, 12, 11, 10, 9, null, 8, 7]), 2, 2);
  assert.deepEqual(falling.trend.slice(5), ["pending", "falling", null, "neutral", "neutral"]);
});

const divergence = {
  length: 2,
  source: "close",
  left: 1,
  right: 1,
  minimumDistance: 3,
  maximumDistance: 3
};

test("RSI divergence uses price wicks and appears at right-bar confirmation", () => {
  const bars = candles([10, 12, 11, 10, 16, 15, 14, 17]);
  bars[6].low = 9;
  assert.deepEqual(rsiDivergence(bars.slice(0, 7), divergence).events, []);
  const { oscillator, events } = rsiDivergence(bars, divergence);
  assert.equal(events.length, 1);
  near(oscillator[3], 40);
  near(oscillator[6], 100 / (1 + 0.84375 / 0.8125));
  assert.deepEqual(events[0], {
    kind: "regular-bullish",
    previous: { timestamp: 240000, price: 10, oscillator: oscillator[3] },
    current: { timestamp: 420000, price: 9, oscillator: oscillator[6] },
    confirmedAt: 480000
  });
  assert.deepEqual(
    rsiDivergence(bars, { ...divergence, maximumDistance: 4, minimumDistance: 4 }).events,
    []
  );
});

test("RSI divergence supports regular bearish and both hidden directions without crossing missing data", () => {
  const bearish = candles([10, 12, 11, 10, 16, 15, 14, 17].map((value) => 100 - value));
  bearish[6].high = 91;
  assert.deepEqual(
    rsiDivergence(bearish, divergence).events.map(({ kind }) => kind),
    ["regular-bearish"]
  );
  const prices = [10, 12, 11, 10, 13, 12, 11, 14];
  assert.deepEqual(
    rsiDivergence(candles(prices), divergence).events.map(({ kind }) => kind),
    ["hidden-bullish"]
  );
  const hiddenBearish = candles(prices.map((value) => 100 - value));
  assert.deepEqual(
    rsiDivergence(hiddenBearish, divergence).events.map(({ kind }) => kind),
    ["hidden-bearish"]
  );
  const withGap = candles(prices);
  withGap[4].close = null;
  assert.deepEqual(rsiDivergence(withGap, divergence).events, []);
});

const reversal = {
  fastLength: 1,
  slowLength: 3,
  kLength: 1,
  slowing: 1,
  oversold: 20,
  overbought: 80
};

test("Booker Reversal only marks the strict zero-cross and oscillator threshold together", () => {
  const bullish = candles([10, 9, 11]);
  Object.assign(bullish[2], { low: 10, high: 20 });
  assert.deepEqual(bookerReversal(bullish, reversal), [
    { timestamp: 180000, direction: "bullish", price: 10 }
  ]);
  assert.deepEqual(bookerReversal(bullish, { ...reversal, oversold: 10 }), []);
  assert.deepEqual(bookerReversal(bullish, { ...reversal, kLength: 4 }), []);
  assert.deepEqual(bookerReversal(bullish, { ...reversal, slowing: 2 }), []);
  const bearish = candles([10, 11, 9]);
  Object.assign(bearish[2], { low: 0, high: 10 });
  assert.deepEqual(bookerReversal(bearish, reversal), [
    { timestamp: 180000, direction: "bearish", price: 10 }
  ]);
  assert.deepEqual(bookerReversal(bearish, { ...reversal, overbought: 90 }), []);
  bearish[1].close = null;
  assert.deepEqual(bookerReversal(bearish, reversal), []);
});

test("documented Knoxville condition needs both divergence and RSI confirmation", () => {
  const first = { price: 20, momentum: 5, rsi: 60 };
  const high = { price: 22, momentum: 2, rsi: 85 };
  const low = { price: 19, momentum: 7, rsi: 15 };
  assert.equal(knoxvilleCondition(first, high, reversal), "bearish");
  assert.equal(knoxvilleCondition(first, low, reversal), "bullish");
  assert.equal(knoxvilleCondition(first, { ...high, rsi: 80 }, reversal), null);
  assert.equal(knoxvilleCondition(first, { ...high, momentum: 5 }, reversal), null);
  assert.throws(() => knoxvilleCondition(first, { ...low, rsi: -1 }, reversal), RangeError);
});

function period(start, high, low, close, options = {}) {
  return {
    start,
    end: start + 60,
    high,
    low,
    close,
    closed: true,
    coverageComplete: true,
    observedRanges: [{ low, high }],
    ...options
  };
}

test("Booker pivot primitives use closed prior periods and an explicit future timestamp", () => {
  assert.deepEqual(BOOKER_INTRADAY_MINUTES, [60, 240, 480]);
  assert.deepEqual(BOOKER_MISSED_PERIODS, ["day", "week", "month"]);
  assert.deepEqual(BOOKER_ZIV_PERIODS, [240, "day", "week", "month"]);
  const before = period(0, 110, 90, 100);
  const current = period(60, 104, 89, 95, { closed: false });
  assert.deepEqual(classicPreviousPeriodPivots([before, current], 1), [
    { start: 60, end: 120, value: 100 }
  ]);
  assert.deepEqual(classicPreviousPeriodPivots([{ ...before, closed: false }, current], 1), []);
  assert.deepEqual(classicPreviousPeriodPivots([{ ...before, close: null }, current], 1), []);
  assert.deepEqual(projectClassicNextPivot(current, 180), { timestamp: 180, value: 96 });
  assert.deepEqual(projectClassicNextPivot({ ...current, high: 110, close: 101 }, 180), {
    timestamp: 180,
    value: 100
  });
  assert.throws(() => projectClassicNextPivot(current, 119), RangeError);
  assert.throws(
    () => classicPreviousPeriodPivots([before, { ...current, start: 50 }], 2),
    RangeError
  );
});

test("Missed Pivot uses observed ranges, an inclusive touch and explicit coverage", () => {
  const before = period(0, 110, 90, 100);
  const missed = period(60, 101, 97, 100.5, {
    observedRanges: [
      { low: 97, high: 99 },
      { low: 100.5, high: 101 }
    ]
  });
  assert.equal(classicMissedPivots([before, missed], 2)[0].status, "missed");
  assert.equal(
    classicMissedPivots([before, { ...missed, coverageComplete: false }], 2)[0].status,
    "unconfirmed"
  );
  assert.equal(
    classicMissedPivots([before, { ...missed, closed: false }], 2)[0].status,
    "unconfirmed"
  );
  const later = period(120, 110, 100, 106, { closed: false, coverageComplete: false });
  assert.equal(classicMissedPivots([before, missed, later], 2)[0].status, "touched");
  assert.equal(classicMissedPivots([before, missed, later], 1).length, 1);
});
