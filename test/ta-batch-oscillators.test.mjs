import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const fromCore = (module) => load(`model/technical-indicators/${module}.js`);
const {
  priceMomentumOscillator,
  percentagePriceOscillator,
  stochasticMomentumIndex,
  smiErgodicIndicator,
  smiErgodicOscillator
} = fromCore("ta-batch-oscillators");
const { connorsRsi } = fromCore("ta-batch-oscillators-rank");
const { detrendedPriceOscillator, detrendedPriceOscillatorShift } = fromCore(
  "ta-batch-oscillators-dpo"
);
const { priceOscillatorPresets, priceOscillatorHistory } = fromCore(
  "ta-batch-oscillators-metadata"
);

function closeTo(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === null) assert.equal(actual[i], null, `bar ${i}`);
    else {
      assert.ok(Number.isFinite(actual[i]), `bar ${i} must be finite`);
      assert.ok(
        Math.abs(actual[i] - expected[i]) <= 2e-12 * Math.max(1, Math.abs(expected[i])),
        `bar ${i}: ${actual[i]} != ${expected[i]}`
      );
    }
  }
}

function bars(prices, highs = prices, lows = prices) {
  return prices.map((close, i) => ({
    open: close,
    close,
    high: highs[i],
    low: lows[i],
    timestamp: 1700000000000 + i * i * 60000,
    volume: null
  }));
}

test("PMO uses 2/N at both stages and the standard EMA for the signal", () => {
  const data = Object.freeze([100, 110, 110, 121]);
  const config = { firstLength: 4, secondLength: 4, signalLength: 3 };
  const result = priceMomentumOscillator(data, config);
  closeTo(result.value, [null, 100, 75, 75]);
  closeTo(result.signal, [null, 100, 87.5, 81.25]);
  closeTo(priceMomentumOscillator([64, 128, 256, 512]).value, [null, 1000, 1000, 1000]);
  const gapped = priceMomentumOscillator([100, 110, null, 200, 200], config);
  closeTo(gapped.value, [null, 100, null, null, 75]);
  closeTo(gapped.signal, [null, 100, null, null, 87.5]);
  assert.throws(() => priceMomentumOscillator(data, { firstLength: 1 }), RangeError);
});

test("PPO has distinct moving average choices and masks undefined ratios", () => {
  const result = percentagePriceOscillator([10, 20, 30, 40, 50], {
    fastLength: 1,
    slowLength: 2,
    signalLength: 2,
    oscillatorAverage: "SMA",
    signalAverage: "SMA"
  });
  closeTo(result.value, [null, 100 / 3, 20, 100 / 7, 100 / 9]);
  closeTo(result.signal, [null, null, 80 / 3, 120 / 7, 800 / 63]);
  closeTo(result.histogram, [null, null, -20 / 3, -20 / 7, -100 / 63]);
  closeTo(percentagePriceOscillator([0, 0, null, 0]).value, [null, null, null, null]);
  assert.throws(() => percentagePriceOscillator([10, 20], { signalAverage: "WMA" }), RangeError);
  assert.throws(() => percentagePriceOscillator([10, Infinity]), RangeError);
});

test("SMI uses candle range, correct scale and own signal length", () => {
  const data = bars([1, 4, 2, 2], [2, 4, 3, 2], [0, 1, 1, 2]);
  const result = stochasticMomentumIndex(data, { kLength: 2, dLength: 1, emaLength: 3 });
  closeTo(result.value, [null, 100, -100 / 3, 0]);
  closeTo(result.signal, [null, 100, 100 / 3, 50 / 3]);
  const double = stochasticMomentumIndex(data, { kLength: 2, dLength: 3, emaLength: 1 });
  closeTo(double.value, [null, 100, 220 / 3, 700 / 13]);
  const flat = stochasticMomentumIndex(bars([2, 2, 2]), { kLength: 2 });
  closeTo(flat.value, [null, null, null]);
  const huge = stochasticMomentumIndex(bars([1e308], [1e308], [-1e308]), { kLength: 1 });
  closeTo(huge.value, [100]);
});

test("SMII reports the unit ratio and SMIO is its signed difference from the signal", () => {
  const data = [100, 102, 101, 103];
  const config = { shortLength: 1, longLength: 3, signalLength: 3 };
  const result = smiErgodicIndicator(data, config);
  closeTo(result.value, [null, 1, 1 / 3, 5 / 7]);
  closeTo(result.signal, [null, 1, 2 / 3, 29 / 42]);
  closeTo(smiErgodicOscillator(data, config).histogram, [null, 0, -1 / 3, 1 / 42]);
  const gapped = smiErgodicIndicator([100, 102, null, 100, 99], config);
  closeTo(gapped.value, [null, 1, null, null, 1 / 3]);
  closeTo(gapped.signal, [null, 1, null, null, 2 / 3]);
});

test("Connors RSI includes only preceding returns, handles equal values and restarts the streak", () => {
  const config = { priceLength: 1, streakLength: 1, rankLength: 2 };
  closeTo(connorsRsi([64, 128, 256, 256, 512], config).value, [null, null, null, 100 / 3, 250 / 3]);
  closeTo(connorsRsi([64, 128, 256, 512], config).value, [null, null, null, 200 / 3]);
  closeTo(connorsRsi([64, 128, null, 256, 512, 256, 128], config).value, [
    null,
    null,
    null,
    null,
    null,
    null,
    0
  ]);
});

test("Connors RSI rank matches a positional scan and stable prefixes on longer data", () => {
  const { rsi } = fromCore("calculations");
  const config = { priceLength: 3, streakLength: 2, rankLength: 33 };
  const data = Array.from({ length: 600 }, (_, i) => (i % 47 === 10 ? null : 500 + ((i * i) % 81)));
  const returns = data.map((price, i) =>
    price === null || data[i - 1] == null ? null : (price - data[i - 1]) / data[i - 1]
  );
  const run = [];
  for (let i = 0; i < data.length; i++) {
    const close = data[i],
      previous = data[i - 1];
    if (close === null) run.push(null);
    else if (previous == null || close === previous) run.push(0);
    else if (close > previous) run.push(1 + Math.max(0, run[i - 1]));
    else run.push(-1 + Math.min(0, run[i - 1]));
  }
  const priceRsi = rsi(data, config.priceLength),
    streakRsi = rsi(run, config.streakLength);
  const expected = returns.map((value, i) => {
    const prior = returns.slice(Math.max(0, i - config.rankLength), i);
    if (value === null || prior.length !== config.rankLength || prior.some((v) => v === null))
      return null;
    const rank = (100 * prior.filter((v) => v < value).length) / prior.length;
    return (priceRsi[i] + streakRsi[i] + rank) / 3;
  });
  const result = connorsRsi(data, config).value;
  closeTo(result, expected);
  closeTo(connorsRsi(data.slice(0, 335), config).value, result.slice(0, 335));
});

test("DPO aligns both modes by candle index and excludes unresolved points on the right", () => {
  const source = [1, 2, 5, 10, 11, 13, 17, 22];
  const timestamps = bars(source).map((bar) => bar.timestamp);
  assert.equal(detrendedPriceOscillatorShift(3), 2);
  assert.equal(detrendedPriceOscillatorShift(4), 3);
  closeTo(detrendedPriceOscillator(source, { length: 3 }).value, [
    null,
    null,
    null,
    null,
    25 / 3,
    22 / 3,
    25 / 3,
    32 / 3
  ]);
  const centered = detrendedPriceOscillator(source, { length: 3, centered: true }).value;
  closeTo(centered, [-5 / 3, -11 / 3, -11 / 3, -4 / 3, -8 / 3, -13 / 3, null, null]);
  assert.deepEqual(
    timestamps.filter((_, index) => centered[index] !== null),
    timestamps.slice(0, -2)
  );
  assert.equal(
    detrendedPriceOscillator([1, 2, null, 9], { length: 2, centered: true }).value[0],
    null
  );
});

test("preset keys match series and the metadata distinguishes warmup from history", () => {
  const data = Array.from({ length: 125 }, (_, i) => i + 1);
  const calculate = {
    pmo: (params) => priceMomentumOscillator(data, params),
    ppo: (params) => percentagePriceOscillator(data, params),
    smi: (params) => stochasticMomentumIndex(bars(data), params),
    "smi-ergodic-indicator": (params) => smiErgodicIndicator(data, params),
    "smi-ergodic-oscillator": (params) => smiErgodicOscillator(data, params),
    "connors-rsi": (params) => connorsRsi(data, params),
    dpo: (params) => detrendedPriceOscillator(data, params)
  };
  for (const [id, preset] of Object.entries(priceOscillatorPresets)) {
    const parameters = Object.fromEntries(
      preset.parameters.map(({ key, defaultValue }) => [key, defaultValue])
    );
    const result = calculate[id](parameters);
    assert.deepEqual(result, calculate[id]());
    assert.deepEqual(
      preset.outputs.map(({ id }) => id),
      Object.keys(result)
    );
    const { warmupBars } = priceOscillatorHistory[id](parameters);
    const [first] = Object.values(result);
    assert.equal(first.findIndex((value) => value !== null) + 1, warmupBars, id);
  }
  const ppoSma = priceOscillatorHistory.ppo({
    fastLength: 2,
    slowLength: 5,
    signalLength: 3,
    oscillatorAverage: "SMA",
    signalAverage: "SMA"
  });
  assert.equal(ppoSma.warmupBars, 5);
  assert.equal(ppoSma.historyRequirement.lookbackBars, 7);
  assert.equal(priceOscillatorHistory.dpo({ length: 21, centered: true }).lookAheadBars, 11);
});
