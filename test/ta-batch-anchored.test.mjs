import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { automaticVwapPeriod, autoAnchoredVwap, twap, visibleAveragePrice, vwap } = load(
  "model/technical-indicators/ta-batch-anchored.ts"
);
const { ichimokuCloud, williamsAlligator } = load(
  "model/technical-indicators/ta-batch-anchored-shifts.ts"
);

const time = (index) => 1700000000000 + index * 60000;
const candle = (index, price, volume = 1) => ({
  timestamp: time(index),
  open: price,
  high: price,
  low: price,
  close: price,
  volume
});

function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    const target = expected[index];
    if (target === null) assert.equal(value, null, `bar ${index}`);
    else {
      assert.ok(Number.isFinite(value), `bar ${index} has no value`);
      assert.ok(Math.abs(value - target) <= 1e-12 * Math.max(1, Math.abs(target)), `bar ${index}`);
    }
  }
}

test("VWAP uses HLC3, respects zero weight, and resets on the actual anchor candle", () => {
  const bars = [
    candle(0, 50),
    { ...candle(1, 11, 1), high: 14, low: 5 },
    { ...candle(2, 21, 3), high: 27, low: 12 },
    candle(3, 90, 0),
    candle(4, 30, 2),
    candle(5, 40, 3)
  ];
  const result = vwap(bars, [time(1), time(4)], {
    bands: { mode: "standard-deviation", multipliers: [1, 2] }
  });
  assert.equal(result.status, "computed");
  assert.equal(result.anchorTimestamp, time(4));
  series(result.values, [null, 10, 17.5, 17.5, 30, 36]);
  const firstDeviation = Math.sqrt((1 * 7.5 ** 2 + 3 * 2.5 ** 2) / 4);
  const secondDeviation = Math.sqrt((2 * 6 ** 2 + 3 * 4 ** 2) / 5);
  series(result.bands[0].upper, [
    null,
    10,
    17.5 + firstDeviation,
    17.5 + firstDeviation,
    30,
    36 + secondDeviation
  ]);
  series(result.bands[1].lower, [
    null,
    10,
    17.5 - 2 * firstDeviation,
    17.5 - 2 * firstDeviation,
    30,
    36 - 2 * secondDeviation
  ]);
});

test("VWAP separates absent volume and anchor information from confirmed zero prices", () => {
  const bars = [candle(0, 999, null), candle(1, 999, 0), candle(2, 0, 2), candle(3, 50, null)];
  assert.equal(vwap(bars, null).reason, "anchor-unavailable");
  assert.equal(vwap(bars.slice(1), [time(0)]).reason, "anchor-unavailable");
  assert.equal(vwap(bars.slice(0, 2), [time(0)]).reason, "volume-unavailable");
  assert.equal(vwap([candle(0, null, 10)], [time(0)]).reason, "source-unavailable");
  series(vwap(bars, [time(0)]).values, [null, null, 0, null]);
  assert.throws(() => vwap(bars, [time(1) + 1]), /identify a loaded candle/);
  assert.throws(() => vwap(bars, [time(1), time(0)]), /strictly increasing/);
  assert.throws(() => vwap(bars, [time(0), time(0)]), /strictly increasing/);
  assert.throws(
    () => vwap(bars, [time(0)], { bands: { mode: "percent", multipliers: [-1] } }),
    RangeError
  );
});

test("percentage VWAP bands remain symmetric on a negative price series", () => {
  const result = vwap([candle(0, -100), candle(1, -108)], [time(0)], {
    source: "close",
    bands: { mode: "percent", multipliers: [2] }
  });
  series(result.values, [-100, -104]);
  series(result.bands[0].upper, [-98, -101.92]);
  series(result.bands[0].lower, [-102, -106.08]);
});

test("Auto VWAP shows the last period; extreme selection uses fields independent of price source", () => {
  const bars = [
    { ...candle(0, 10, 2), high: 300 },
    { ...candle(1, 20, 3), high: 40 },
    { ...candle(2, 15, 1), high: 40, low: 8 },
    candle(3, 25, 4),
    candle(4, 50, 1)
  ];
  const period = autoAnchoredVwap(bars, { mode: "period", starts: [time(0), time(3), time(5)] });
  assert.equal(period.anchorTimestamp, time(3));
  series(period.values, [null, null, null, 25, 30]);
  const highest = autoAnchoredVwap(
    bars.slice(0, 4),
    { mode: "highest-high", length: 3 },
    { source: "close" }
  );
  assert.equal(highest.anchorTimestamp, time(2));
  series(highest.values, [null, null, 15, 23]);
  assert.equal(autoAnchoredVwap(bars, { mode: "lowest-low", length: 4 }).anchorTimestamp, time(2));
  assert.equal(
    autoAnchoredVwap(bars, { mode: "highest-volume", length: 2 }).anchorTimestamp,
    time(3)
  );
  assert.equal(
    autoAnchoredVwap([candle(0, null, null)], { mode: "highest-volume", length: 1 }).reason,
    "anchor-unavailable"
  );
});

test("automatic period mapping covers intraday through multimonth intervals", () => {
  assert.deepEqual([1 / 1440, 1, 2, 7, 10, 11, 30, 60, 61, 90].map(automaticVwapPeriod), [
    "session",
    "month",
    "quarter",
    "quarter",
    "quarter",
    "year",
    "year",
    "year",
    "decade",
    "decade"
  ]);
  assert.throws(() => automaticVwapPeriod(0), RangeError);
});

test("TWAP averages OHLC4, ignores trade volume and does not fill gaps with synthetic prices", () => {
  const bars = [
    { ...candle(0, 6, 50), open: 8, high: 12, low: 4 },
    candle(2, 15, null),
    candle(3, null),
    candle(4, 0, 0),
    candle(5, 12, 500),
    candle(6, 18, 1)
  ];
  const result = twap(bars, [time(0), time(5)]);
  assert.equal(result.anchorTimestamp, time(5));
  series(result.values, [7.5, 11.25, null, 7.5, 12, 15]);
  series(twap(bars, [time(0)], "open").values, [8, 11.5, null, 23 / 3, 35 / 4, 53 / 5]);
  assert.equal(twap(bars.slice(1), [time(0)]).reason, "anchor-unavailable");
});

test("visible average changes with viewport and includes range edges", () => {
  const bars = [candle(0, 10), candle(1, 30), candle(2, null), candle(3, 9), candle(4, 12)];
  assert.deepEqual(visibleAveragePrice(bars, { from: time(0), to: time(2) }), {
    status: "computed",
    value: 20,
    from: time(0),
    to: time(2)
  });
  assert.deepEqual(visibleAveragePrice(bars, { from: time(2), to: time(4) }), {
    status: "computed",
    value: 10.5,
    from: time(2),
    to: time(4)
  });
  assert.equal(
    visibleAveragePrice(bars, { from: time(2), to: time(2) }).reason,
    "source-unavailable"
  );
  assert.equal(visibleAveragePrice(bars, null).reason, "viewport-unavailable");
  assert.equal(
    visibleAveragePrice(bars, { from: time(5), to: time(6) }).reason,
    "viewport-unavailable"
  );
  assert.throws(() => visibleAveragePrice(bars, { from: time(3), to: time(2) }), RangeError);
});

const rising = (length) =>
  Array.from({ length }, (_, index) => {
    const close = 10 * (index + 1);
    return Object.freeze({ ...candle(index, close), high: close + 3, low: close - 1 });
  });

test("Ichimoku midpoints and plotting offsets are independent outputs", () => {
  const bars = rising(5);
  const result = ichimokuCloud(bars, {
    conversionLength: 2,
    baseLength: 3,
    spanBLength: 4,
    displacement: 3
  });
  series(result.conversion.values, [null, 16, 26, 36, 46]);
  series(result.base.values, [null, null, 21, 31, 41]);
  series(result.spanA.values, [null, null, 23.5, 33.5, 43.5]);
  series(result.spanB.values, [null, null, null, 26, 36]);
  series(result.lagging.values, [10, 20, 30, 40, 50]);
  assert.deepEqual(
    Object.values(result).map(({ barOffset }) => barOffset),
    [0, 0, 2, 2, -2]
  );
  const defaults = ichimokuCloud(rising(52));
  assert.deepEqual(
    Object.values(defaults).map(({ barOffset }) => barOffset),
    [0, 0, 25, 25, -25]
  );
  assert.deepEqual(
    Object.values(defaults).map(({ values }) => values.findIndex((value) => value !== null)),
    [8, 25, 25, 51, 0]
  );
  assert.equal(ichimokuCloud(bars, { displacement: 1 }).lagging.barOffset, 0);
});

test("Ichimoku requires a complete window of known High and Low values", () => {
  const bars = rising(5);
  bars[2] = { ...bars[2], low: null };
  const result = ichimokuCloud(bars, { conversionLength: 2 });
  series(result.conversion.values, [null, 16, null, null, 46]);
  assert.equal(result.lagging.values[2], 30);
});

test("Alligator uses SMA seed and SMMA recurrence on median price, with 8/5/3 offsets", () => {
  const bars = rising(14);
  const result = williamsAlligator(bars, { jawLength: 2, teethLength: 3, lipsLength: 1 });
  series(result.jaw.values.slice(0, 4), [null, 16, 23.5, 32.25]);
  series(result.teeth.values.slice(0, 4), [null, null, 21, 83 / 3]);
  series(result.lips.values.slice(0, 4), [11, 21, 31, 41]);
  assert.deepEqual(
    Object.values(result).map(({ barOffset }) => barOffset),
    [8, 5, 3]
  );
  assert.deepEqual(
    Object.values(williamsAlligator(bars)).map(({ values }) =>
      values.findIndex((value) => value !== null)
    ),
    [12, 7, 4]
  );
  assert.throws(() => williamsAlligator(bars, { jawOffset: 2.5 }), /Invalid Alligator offset/);
});

test("appending candles changes no historical calculation value for the period or shifted series", () => {
  const bars = Object.freeze(rising(80));
  const prefix = Object.freeze(bars.slice(0, 53));
  for (const calculate of [ichimokuCloud, williamsAlligator]) {
    const full = calculate(bars);
    for (const [id, line] of Object.entries(calculate(prefix))) {
      assert.deepEqual(full[id].values.slice(0, prefix.length), line.values);
      assert.equal(full[id].barOffset, line.barOffset);
    }
  }
  for (const calculate of [vwap, twap]) {
    const full = calculate(bars, [time(0), time(10), time(54)]);
    assert.deepEqual(
      full.values.slice(0, prefix.length),
      calculate(prefix, [time(0), time(10)]).values
    );
  }
});
