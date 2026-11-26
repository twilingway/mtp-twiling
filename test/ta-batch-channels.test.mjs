import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const {
  donchianChannels,
  envelope,
  medianChannel,
  chandeKrollStop,
  volatilityStop,
  bbTrend,
  bollingerBars,
  priceBandPresets
} = sourceLoader()("model/technical-indicators/ta-batch-channels.ts");

const bars = (rows) =>
  rows.map(([high, low, close, open = close], index) => ({
    timestamp: 1700000000 + index * 60,
    high,
    low,
    close,
    open,
    volume: null
  }));
const closes = (values) =>
  bars(
    values.map((value) => (value === null ? [null, null, null] : [value + 1, value - 1, value]))
  );
const gap = { ...closes([null])[0], timestamp: 1700000000 + 9 * 60 };
const input = bars([
  [10, 8, 9],
  [15, 11, 14],
  [14, 10, 11],
  [20, 16, 18],
  [12, 8, 10],
  [13, 9, 12],
  [8, 4, 5]
]);

function assertSeries(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    const point = actual[index];
    if (value === null) assert.equal(point, null, `index ${index}`);
    else
      assert.ok(
        Number.isFinite(point) && Math.abs(point - value) <= 1e-12 * Math.max(1, Math.abs(value)),
        `index ${index}: ${point} != ${value}`
      );
  });
}

test("Donchian uses partial High/Low extrema and keeps its offset out of the calculation", () => {
  const result = donchianChannels(input, { length: 2, displayOffset: -3 });
  assert.deepEqual(result, donchianChannels(input, { length: 2, displayOffset: 7 }));
  assertSeries(result.basis, [9, 11.5, 12.5, 15, 14, 10.5, 8.5]);
  assertSeries(result.upper, [10, 15, 15, 20, 20, 13, 13]);
  assertSeries(result.lower, [8, 8, 10, 10, 8, 8, 4]);
  assert.equal(priceBandPresets["donchian-channels"].defaults.displayOffset, 0);
});

test("Envelope uses percent, an SMA window, or a first-price EMA seed", () => {
  const sample = input.slice(0, 3);
  const sma = envelope(sample, { length: 2, percent: 10 });
  assertSeries(sma.basis, [null, 11.5, 12.5]);
  assertSeries(sma.upper, [null, 12.65, 13.75]);
  assertSeries(sma.lower, [null, 10.35, 11.25]);
  const ema = envelope(sample, { length: 2, source: "high", useExponentialMa: true });
  assertSeries(ema.basis, [10, 40 / 3, 124 / 9]);
  assertSeries(envelope(closes([0, -1, null, 10, 10]), { length: 2, percent: 0 }).upper, [
    null,
    -0.5,
    null,
    null,
    10
  ]);
});

test("Median uses the exact middle pair, its EMA and Wilder ATR envelopes", () => {
  const result = medianChannel(input.slice(0, 3), { length: 2, atrLength: 2, multiplier: 2 });
  assertSeries(result.basis, [null, 11, 12.5]);
  assertSeries(result.average, [null, 11, 12]);
  assertSeries(result.upper, [null, 19, 20.5]);
  assertSeries(result.lower, [null, 3, 4.5]);
  const duplicates = medianChannel(closes([2, 1, 2, 9, 8, 1, 9, null, 10, 3, 3]), {
    length: 3,
    source: "close",
    atrLength: 1
  });
  assertSeries(duplicates.basis, [null, null, 2, 2, 8, 8, 8, null, null, null, 3]);
  assert.equal(duplicates.average.at(-1), 3);
});

test("Chande Kroll Stop takes a second rolling extreme of ATR-adjusted levels", () => {
  const result = chandeKrollStop(input, { atrLength: 2, stopLength: 2 });
  assertSeries(result.highStop, [null, 11, 11, 13.5, 13.5, 11.75, 6.875]);
  assertSeries(result.lowStop, [null, 12, 12, 14, 16.25, 14.125, 11.0625]);
  const recovered = chandeKrollStop([...input, gap, ...input.slice(0, 2)], {
    atrLength: 2,
    stopLength: 2
  });
  assertSeries(recovered.highStop.slice(-3), [null, null, 11]);
  assertSeries(recovered.lowStop.slice(-3), [null, null, 12]);
});

test("Volatility Stop ratchets both ways and reanchors on a close through the stop", () => {
  const result = volatilityStop(closes([10, 14, 13, 10, 7, 8, 10]), { length: 1, multiplier: 1 });
  assertSeries(result.value, [8, 9, 12, 14, 11, 9, 7]);
  assert.deepEqual(result.direction, [1, 1, 1, -1, -1, -1, 1]);
  const gapResult = volatilityStop(closes([10, 9, 1, null, 5, 6]), { length: 2 });
  assertSeries(gapResult.value, [null, 5, 12, null, null, 2]);
  assert.deepEqual(gapResult.direction, [null, 1, -1, null, null, 1]);
});

test("BBTrend returns a signed percentage and distinguishes zero from absent data", () => {
  const options = { shortLength: 1, longLength: 2, multiplier: 2 };
  assertSeries(bbTrend(closes([10, 12, 10, 10, null, 0, 0, 2]), options), [
    null,
    100 / 6,
    -20,
    0,
    null,
    null,
    null,
    100
  ]);
  assertSeries(bbTrend(closes([0, 2, 4]), { shortLength: 2, longLength: 2 }), [null, 0, 0]);
});

test("BBTrend matches independently computed rolling population bands", () => {
  const prices = [7, 9, 12, 5, 8, -6, 12, 6, 23, 8, 3, 10, 5, 2, 4, 22, 11];
  const multiplier = 1.6;
  const bands = (sample) => {
    const basis = sample.reduce((total, value) => total + value, 0) / sample.length;
    const variance =
      sample.reduce((total, value) => total + (value - basis) ** 2, 0) / sample.length;
    const radius = Math.sqrt(variance) * multiplier;
    return { lower: basis - radius, basis, upper: basis + radius };
  };
  const expected = prices.map((_, i) => {
    if (i < 5) return null;
    const short = bands(prices.slice(i - 2, i + 1));
    const long = bands(prices.slice(i - 5, i + 1));
    return (
      ((Math.abs(short.lower - long.lower) - Math.abs(short.upper - long.upper)) / short.basis) *
      100
    );
  });
  assertSeries(bbTrend(closes(prices), { shortLength: 3, longLength: 6, multiplier }), expected);
  const extended = bars([
    [1e308, 1e308, 1e308],
    [-1e308, -1e308, -1e308]
  ]);
  assertSeries(bbTrend(extended, { shortLength: 1, longLength: 2, multiplier: 2 }), [null, 200]);
});

test("Bollinger Bars returns explicit boundaries and roles for both directions and a doji", () => {
  assert.deepEqual(
    bollingerBars(
      bars([
        [10, 2, 7, 4],
        [11, 1, 4, 7],
        [8, 1, 3, 3],
        [null, 2, 3, 4]
      ])
    ),
    [
      { high: 10, bodyTop: 7, bodyBottom: 4, low: 2, direction: "up" },
      { high: 11, bodyTop: 7, bodyBottom: 4, low: 1, direction: "down" },
      { high: 8, bodyTop: 3, bodyBottom: 3, low: 1, direction: "flat" },
      null
    ]
  );
  assert.throws(() => bollingerBars(bars([[5, 1, 3, 6]])), RangeError);
});

test("All recipes are causal and preserve input; metadata identifies seven distinct catalog rows", () => {
  const frozen = Object.freeze(input.map(Object.freeze));
  const resultPairs = [
    [donchianChannels, { length: 3 }],
    [envelope, { length: 3 }],
    [medianChannel, { length: 3, atrLength: 3 }],
    [chandeKrollStop, { atrLength: 3, stopLength: 3 }],
    [volatilityStop, { length: 3 }],
    [bbTrend, { shortLength: 2, longLength: 3 }],
    [bollingerBars, {}]
  ];
  for (const [calculate, options] of resultPairs) {
    const full = calculate(frozen, options);
    const cut = calculate(frozen.slice(0, 4), options);
    if (Array.isArray(full)) assert.deepEqual(full.slice(0, 4), cut);
    else for (const key of Object.keys(full)) assert.deepEqual(full[key].slice(0, 4), cut[key]);
  }
  assert.equal(new Set(Object.values(priceBandPresets).map((preset) => preset.catalogId)).size, 7);
  assert.throws(() => envelope(input, { length: 0 }), RangeError);
  assert.throws(() => medianChannel(input, { atrLength: 1.5 }), RangeError);
  assert.throws(() => chandeKrollStop(input, { multiplier: NaN }), RangeError);
  assert.throws(() => volatilityStop(input, { source: "unknown" }), RangeError);
  assert.throws(() => bbTrend(input, { multiplier: Infinity }), RangeError);
});
