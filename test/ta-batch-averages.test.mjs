import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  });
  new vm.Script(`(function(require,module,exports){${outputText}\n})`, {
    filename: file
  }).runInThisContext()(
    (name) => load(resolve(dirname(file), name.replace(/\.js$/, ".ts"))),
    module,
    module.exports
  );
  return module.exports;
}
const {
  kaufmanAdaptiveMovingAverage: kama,
  mcginleyDynamic: mcginley,
  movingAverageCross,
  movingAverageRibbon,
  KAMA_DEFAULTS,
  MCGINLEY_DEFAULT_LENGTH,
  MA_CROSS_DEFAULTS,
  MA_RIBBON_DEFAULTS
} = load(
  fileURLToPath(new URL("../src/model/technical-indicators/ta-batch-averages.ts", import.meta.url))
);

const kamaOptions = { erLength: 2, fastLength: 2, slowLength: 3 };
const crossOptions = { shortLength: 1, longLength: 2 };
const candles = (close, volume, open = close) =>
  close.map((value, index) =>
    Object.freeze({
      timestamp: index + 1,
      open: open[index],
      high: Math.max(value, open[index]),
      low: Math.min(value, open[index]),
      close: value,
      volume: volume[index]
    })
  );

function assertSeries(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of expected.entries()) {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else {
      assert.ok(Number.isFinite(actual[index]), `non-finite at index ${index}`);
      assert.ok(
        Math.abs(actual[index] - value) <= 2e-14 * Math.max(1, Math.abs(value)),
        `at ${index}: ${actual[index]} != ${value}`
      );
    }
  }
}

test("KAMA uses squared fast/slow coefficients on trending, choppy and flat windows", () => {
  // ER values at the five complete windows: 1, 0, 0, 1, 0.
  assertSeries(kama([10, 11, 12, 11, 12, 12, 12], kamaOptions), [
    null,
    null,
    103 / 9,
    34 / 3,
    23 / 2,
    211 / 18,
    283 / 24
  ]);
  assertSeries(kama([0, 0, 0, 0], kamaOptions), [null, null, 0, 0]);
});

test("KAMA requires adjacent observations, restarts after gaps and handles large price changes", () => {
  assertSeries(kama([10, 11, 12, null, 20, 21, 22, 23], kamaOptions), [
    null,
    null,
    103 / 9,
    null,
    null,
    null,
    193 / 9,
    1793 / 81
  ]);
  assertSeries(kama([-1e308, 1e308, -1e308], kamaOptions), [null, null, 5e307]);
  assert.deepEqual(kama([1, 2]), [null, null]);
  assert.throws(() => kama([1, 2, 3], { ...kamaOptions, fastLength: 5 }), RangeError);
});

test("McGinley uses a fourth-power ratio and keeps a gap without imputing a missing price", () => {
  // MD2=10+10/(2*2^4)=165/16; the observed price following the gap is MD2/2.
  assertSeries(mcginley([10, 20, null, 165 / 32, 0, 20, 20], 2), [
    10,
    165 / 16,
    null,
    -495 / 16,
    null,
    20,
    20
  ]);
  assertSeries(mcginley([null, 0, 5], 1), [null, null, 5]);
  assertSeries(mcginley([1e-300, 1e300, 8], 3), [1e-300, null, 8]);
  assert.throws(() => mcginley([1, 2, 3], 0), RangeError);
  assert.throws(() => mcginley([1, Infinity]), RangeError);
});

test("MA Cross marks both strict directions and leaves equality and gaps unmarked", () => {
  const result = movingAverageCross([1, 1, 3, 2, 2, 4, null, 0, 0, 1], crossOptions);
  assertSeries(result.short, [1, 1, 3, 2, 2, 4, null, 0, 0, 1]);
  assertSeries(result.long, [null, 1, 2, 2.5, 2, 3, null, 2, 0, 0.5]);
  assertSeries(result.cross, [null, null, 3, 2, null, 4, null, null, null, 1]);
  assert.deepEqual(movingAverageCross([2, 1, 5, 0], { shortLength: 2, longLength: 2 }).cross, [
    null,
    null,
    null,
    null
  ]);
});

test("MA Ribbon lines independently use source, period and averaging method", () => {
  const bars = candles([10, 20, 40, 80], [1, 3, 0, 2], [8, 16, 32, 64]);
  const result = movingAverageRibbon(bars, {
    ma1: { average: "sma", source: "open", length: 2 },
    ma2: { average: "ema", source: "close", length: 3 },
    ma3: { average: "wma", source: "hl2", length: 2 },
    ma4: { average: "vwma", source: "close", length: 2 }
  });
  assertSeries(result.ma1, [null, 12, 24, 48]);
  assertSeries(result.ma2, [10, 15, 27.5, 53.75]);
  assertSeries(result.ma3, [null, 15, 30, 60]);
  assertSeries(result.ma4, [null, 17.5, 20, 80]);
});

test("MA Ribbon leaves unavailable volume local to its line and preserves valid zero prices", () => {
  const bars = candles([0, 10, 30, 20, 10], [0, 0, null, 1, 1]);
  const result = movingAverageRibbon(bars, {
    ma1: { average: "sma", source: "close", length: 2 },
    ma2: { average: "smma", source: "close", length: 2 },
    ma3: { average: "vwma", source: "close", length: 2 },
    ma4: { average: "ema", source: "volume", length: 3 }
  });
  assertSeries(result.ma1, [null, 5, 20, 25, 15]);
  assertSeries(result.ma2, [null, 5, 17.5, 18.75, 14.375]);
  assertSeries(result.ma3, [null, null, null, 20, 15]);
  assertSeries(result.ma4, [0, 0, null, 0.5, 0.75]);
  assert.throws(() => movingAverageRibbon([bars[1], bars[0]]), RangeError);
});

test("warmups and defaults use current chart candles and retain previously calculated prefix", () => {
  assert.deepEqual(KAMA_DEFAULTS, { erLength: 10, fastLength: 2, slowLength: 30 });
  assert.equal(MCGINLEY_DEFAULT_LENGTH, 14);
  assert.deepEqual(MA_CROSS_DEFAULTS, { shortLength: 9, longLength: 21 });
  assert.deepEqual(
    Object.values(MA_RIBBON_DEFAULTS).map((line) => line.length),
    [20, 50, 100, 200]
  );

  const prices = Array.from({ length: 205 }, (_, index) => 100 + (index % 15));
  const bars = Object.freeze(candles(prices, prices));
  const prefix = bars.slice(0, -1);
  assert.equal(
    kama(prices).findIndex((value) => value !== null),
    10
  );
  assert.equal(
    movingAverageCross(prices).long.findIndex((value) => value !== null),
    20
  );
  assert.equal(
    movingAverageRibbon(bars).ma4.findIndex((value) => value !== null),
    199
  );
  for (const calculate of [kama, mcginley]) {
    const previous = calculate(Object.freeze(prices.slice(0, -1)));
    assert.deepEqual(calculate(prices).slice(0, -1), previous);
  }
  for (const [id, full] of Object.entries(movingAverageRibbon(bars))) {
    assert.deepEqual(full.slice(0, -1), movingAverageRibbon(prefix)[id]);
  }
});
