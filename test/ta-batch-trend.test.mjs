import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/model/technical-indicators/", import.meta.url));
const modules = new Map();
function load(name) {
  const file = path.resolve(root, name).replace(/\.js$/, ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  });
  new vm.Script(`(function(require,module,exports){${outputText}\n})`, {
    filename: file
  }).runInThisContext()(
    (specifier) => load(path.resolve(path.dirname(file), specifier)),
    module,
    module.exports
  );
  return module.exports;
}

const { linearRegressionChannel, trendStrengthIndex } = load("ta-batch-trend-regression.js");
const { rankCorrelationIndex, rankCorrelationRibbon } = load("ta-batch-trend-rank.js");
const { chopZone, massIndex, pringSpecialK, SPECIAL_K_WARMUP, ulcerIndex } = load(
  "ta-batch-trend-volatility.js"
);

function close(actual, expected) {
  if (expected === null) assert.equal(actual, null);
  else
    assert.ok(
      Number.isFinite(actual) &&
        Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)),
      `${actual} vs ${expected}`
    );
}

function compareSeries(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => close(actual[index], value));
}

function candles(closes, range = 2) {
  return Object.freeze(
    closes.map((close, index) =>
      Object.freeze({
        timestamp: index + 1,
        open: close,
        high: close === null ? null : close + range / 2,
        low: close === null ? null : close - range / 2,
        close,
        volume: 0
      })
    )
  );
}

test("Linear Regression Channel draws one fitted line per band in the last window", () => {
  const input = Object.freeze([40, 10, 12, 14]);
  const straight = linearRegressionChannel(input, 3);
  for (const series of Object.values(straight)) compareSeries(series, [null, 10, 12, 14]);

  const channel = linearRegressionChannel([10, 13, 10], 3, 2, 1);
  compareSeries(channel.center, [11, 11, 11]);
  compareSeries(channel.upper, Array(3).fill(11 + 2 * Math.SQRT2));
  compareSeries(channel.lower, Array(3).fill(11 - Math.SQRT2));
  assert.deepEqual(linearRegressionChannel([10, 13, 10], 3, null).upper, [null, null, null]);
  assert.deepEqual(linearRegressionChannel([1, null, 3], 3).center, [null, null, null]);
  assert.deepEqual(linearRegressionChannel([1, 3], 3).center, [null, null]);
});

test("Trend Strength measures Pearson with bar position and handles large baselines", () => {
  compareSeries(trendStrengthIndex([10, 11, 12, 13], 3), [null, null, 1, 1]);
  compareSeries(trendStrengthIndex([10, 12, 10, 8], 3), [null, null, 0, -1]);
  compareSeries(trendStrengthIndex([2, 2, 2, null, 30, 31, 32], 3), [
    null,
    null,
    null,
    null,
    null,
    null,
    1
  ]);
  const baseline = 1e15;
  compareSeries(trendStrengthIndex([baseline, baseline + 1, baseline + 2], 3), [null, null, 1]);
  compareSeries(trendStrengthIndex([-Number.MAX_VALUE, 0, Number.MAX_VALUE], 3), [null, null, 1]);
});

test("RCI averages ties and Ribbon warms the three lines independently", () => {
  compareSeries(rankCorrelationIndex([10, 12, 15, 12], 4).rci, [
    null,
    null,
    null,
    200 / Math.sqrt(10)
  ]);
  compareSeries(rankCorrelationIndex([9, 6, 3], 3).rci, [null, null, -100]);
  compareSeries(rankCorrelationIndex([7, 7, 7], 3).rci, [null, null, null]);
  const ribbon = rankCorrelationRibbon([2, 3, 5, null, 7, 11, 13], 2, 3, 4);
  compareSeries(ribbon.short, [null, 100, 100, null, null, 100, 100]);
  compareSeries(ribbon.middle, [null, null, 100, null, null, null, 100]);
  assert.ok(ribbon.long.every((value) => value === null));
});

test("RCI supports independent smoothing and volume gaps without shifting bars", () => {
  const input = [1, 2, 1, 2, null];
  const bb = rankCorrelationIndex(input, 2, { kind: "sma-bollinger", length: 2, multiplier: 2 });
  compareSeries(bb.rci, [null, 100, -100, 100, null]);
  compareSeries(bb.average, [null, null, 0, 0, null]);
  compareSeries(bb.upper, [null, null, 200, 200, null]);
  compareSeries(bb.lower, [null, null, -200, -200, null]);

  for (const [kind, expected] of [
    ["sma", [null, null, 0, 0, null]],
    ["ema", [null, 100, -100 / 3, 500 / 9, null]],
    ["rma", [null, null, 0, 50, null]],
    ["wma", [null, null, -100 / 3, 100 / 3, null]]
  ]) {
    const smoothed = rankCorrelationIndex(input, 2, { kind, length: 2 });
    compareSeries(smoothed.average, expected);
    assert.ok(smoothed.upper.every((value) => value === null));
  }
  const weighted = rankCorrelationIndex(input, 2, {
    kind: "vwma",
    length: 2,
    volume: [0, 1, 3, null, 1]
  });
  compareSeries(weighted.average, [null, null, -50, null, null]);
});

test("Mass Index uses the ratio single EMA over double EMA and waits for its sum", () => {
  const ranges = [2, 4, 8];
  const input = ranges.map((range, i) => ({ timestamp: i + 1, high: 10 + range, low: 10 }));
  compareSeries(massIndex(input, 3, 2), [null, 2.2, 2.575]);
  const steady = massIndex(candles(Array(28).fill(10)));
  assert.equal(
    steady.findIndex((value) => value !== null),
    24
  );
  compareSeries(steady.slice(24), [25, 25, 25, 25]);
  compareSeries(massIndex(candles([10, 10, null, 10, 10]), 2, 2), [null, 2, null, null, 2]);
  compareSeries(massIndex(candles([10, 10, 10], 0), 2, 2), [null, null, null]);
});

test("Ulcer Index uses the rolling high on each drawdown and restarts incomplete windows", () => {
  compareSeries(ulcerIndex([10, 9, 8, 10], 2), [
    null,
    null,
    Math.hypot(10, 100 / 9) / Math.SQRT2,
    100 / (9 * Math.SQRT2)
  ]);
  compareSeries(ulcerIndex([1, 2, 3, null, 4, 5, 6], 2), [null, null, 0, null, null, null, 0]);
  compareSeries(ulcerIndex([0, 1, null, 2], 1), [null, 0, null, 0]);
});

test("Pring Special K uses 12 cycle coefficients and twice smooths the signal", () => {
  const source = Array.from({ length: 927 }, (_, i) => 100 * 1.001 ** i);
  const output = pringSpecialK(source);
  assert.equal(
    output.specialK.findIndex((value) => value !== null),
    SPECIAL_K_WARMUP - 1
  );
  assert.equal(
    output.signal.findIndex((value) => value !== null),
    922
  );

  const cycleLookbacks = [10, 15, 20, 30, 40, 65, 75, 100, 195, 265, 390, 530];
  const expected = cycleLookbacks.reduce(
    (sum, n, index) => sum + 100 * (1 + (index % 4)) * (1.001 ** n - 1),
    0
  );
  for (const position of [724, 922, 926]) close(output.specialK[position], expected);
  close(output.signal.at(-1), expected);
  const short = pringSpecialK(source.slice(0, 724));
  assert.ok(short.specialK.every((value) => value === null));

  const varying = pringSpecialK(
    source.map((value, i) => value + Math.sin(i / 7)),
    2,
    3
  );
  for (let i = 727; i < 731; i++) {
    const [a, b, c, d] = varying.specialK.slice(i - 3, i + 1);
    close(varying.signal[i], (a + 2 * b + 2 * c + d) / 6);
  }
  const lastGap = pringSpecialK([...source.slice(0, -1), null]);
  assert.equal(lastGap.specialK.at(-1), null);
  assert.equal(lastGap.signal.at(-1), null);
});

test("Chop Zone uses a full 30-bar range and returns ordinal zones, including missing bars", () => {
  const sideways = chopZone(candles(Array(30).fill(100)));
  compareSeries(sideways.angle, [...Array(29).fill(null), 0]);
  compareSeries(sideways.zone, sideways.angle);
  const ramp = Array.from({ length: 33 }, (_, i) => i + 1000);
  const up = chopZone(candles(ramp, 250));
  const down = chopZone(candles(ramp.slice().reverse(), 250));
  close(up.angle[29], 4);
  close(up.zone[29], 3);
  close(down.angle[29], -4);
  close(down.zone[29], -3);
  assert.deepEqual(
    chopZone(
      candles(
        ramp.map((value) => value * 10),
        2500
      )
    ).angle,
    up.angle
  );
  assert.equal(chopZone(candles([...ramp, null])).zone.at(-1), null);
  assert.equal(chopZone(candles(Array(30).fill(10), 0)).angle.at(-1), null);
});

test("indicators reject invalid lengths, sources, candles and missing VWMA alignment", () => {
  assert.throws(() => linearRegressionChannel([1, 2], 2, -1), RangeError);
  assert.throws(() => trendStrengthIndex([1, 2], 1), RangeError);
  assert.throws(() => rankCorrelationIndex([Infinity], 2), RangeError);
  assert.throws(
    () => rankCorrelationIndex([1, 2], 2, { kind: "vwma", length: 1, volume: [1] }),
    RangeError
  );
  assert.throws(() => ulcerIndex([1, 2], 2.5), RangeError);
  assert.throws(() => pringSpecialK([], 0), RangeError);
  assert.throws(() => massIndex([{ timestamp: 1, high: 4, low: 5 }]), RangeError);
  assert.throws(() => chopZone([{ timestamp: 1, high: 4, low: 3, close: 2 }]), RangeError);
});
