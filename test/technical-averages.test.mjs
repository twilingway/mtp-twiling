import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/model/technical-indicators/", import.meta.url));
const modules = new Map();
function load(name) {
  const file = path.resolve(root, name).replace(/\.js$/, ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${output}\n})`, {
    filename: file
  }).runInThisContext()(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const { wma, vwma, dema, tema, hma, smma, movingAverageMetadata, movingAveragePresets } =
  load("averages/index.js");
const { RollingAverageWindow } = load("averages/rolling-window.js");

function series(actual, expected, tolerance = 2e-14) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else {
      assert.ok(Number.isFinite(actual[index]), `finite index ${index}`);
      assert.ok(
        Math.abs(actual[index] - value) <= tolerance * Math.max(1, Math.abs(value)),
        `index ${index}: ${actual[index]} != ${value}`
      );
    }
  });
}
const ramp = (count) => Array.from({ length: count }, (_, index) => index + 1);

test("WMA hand ledger uses newest-largest weights and only complete valid observation windows", () => {
  // (1*1 + 2*2 + 3*3)/6=7/3; next (2+6+12)/6=10/3.
  series(wma([1, 2, 3, 4, 5], 3), [null, null, 7 / 3, 10 / 3, 13 / 3]);
  series(wma([null, 1, 2, null, 4, 0], 3), [null, null, null, null, 17 / 6, 5 / 3]);
  series(wma([1, 2, 3], 2), [null, 5 / 3, 8 / 3]);
  series(wma([0, null, -4], 1), [0, null, -4]);
});

test("VWMA rational ledger preserves zero volume and rejects a zero denominator", () => {
  series(vwma([10, 20, 40, 80], [1, 3, 0, 2], 2), [null, 35 / 2, 20, 80]);
  series(vwma([10, 20, 40, 80], [1, 3, 0, 2], 3), [null, null, 35 / 2, 44]);
  series(vwma([10, 20, 30, 40], [0, 0, 1, 0], 2), [null, null, 30, 30]);
  series(vwma([0, 0], [1, 2], 1), [0, 0]);
  series(vwma([10, 20], [0, 2], 1), [null, 20]);
});

test("VWMA missing source and volume form explicit gaps without mixing two different SMA windows", () => {
  // Valid pairs: (1,1), (4,0), (5,3). Missing-volume price3 never enters the numerator.
  series(vwma([1, null, 3, 4, 5], [1, 2, null, 0, 3], 2), [null, null, null, 1, 5]);
  series(vwma([1, 2, 3], [null, null, null], 2), [null, null, null]);
  series(vwma([1, 2, null, 4], [1, 1, 0, 1], 2), [null, 3 / 2, null, 3]);
});

test("DEMA and TEMA use first-value EMA chains with the same period on every stage", () => {
  // N3: E1=[1,3/2,9/4,25/8], E2=[1,5/4,7/4,39/16], E3=[1,9/8,23/16,31/16].
  series(dema([1, 2, 3, 4], 3), [1, 7 / 4, 11 / 4, 61 / 16]);
  series(tema([1, 2, 3, 4], 3), [1, 15 / 8, 47 / 16, 4]);
  // N2: E1=[1,5/3,23/9,95/27], E2=[1,13/9,59/27,83/27].
  series(dema([1, 2, 3, 4], 2), [1, 17 / 9, 79 / 27, 107 / 27]);
  series(tema([1, 2, 3, 4], 2), [1, 53 / 27, 3, 325 / 81]);
  series(dema([null, 1, 2, null, 4, 8], 3), [null, 1, 7 / 4, null, 55 / 16, 225 / 32]);
  series(tema([null, 1, 2, null, 4, 8], 3), [null, 1, 15 / 8, null, 119 / 32, 245 / 32]);
});

test("HMA hand ramp ledgers distinguish floor half and sqrt from nearest rounding", () => {
  series(hma([1, 2, 3, 4], 2), [null, 7 / 3, 10 / 3, 13 / 3]);
  series(hma([1, 2, 3, 4], 3), [null, null, 11 / 3, 14 / 3]);
  // N5: half2/sqrt2; N7: half3/sqrt2; N11: half5/sqrt3.
  // For a ramp at time t: HMA=t+(N-2*half-sqrt+2)/3.
  series(hma(ramp(8), 5), [...Array(5).fill(null), 19 / 3, 22 / 3, 25 / 3]);
  series(hma(ramp(10), 7), [...Array(7).fill(null), 25 / 3, 28 / 3, 31 / 3]);
  series(hma(ramp(15), 11), [...Array(12).fill(null), 13, 14, 15]);
  series(hma([1, 2, null, 4, 8], 3), [null, null, null, 31 / 6, 31 / 3]);
  // A gap cannot become another raw HMA observation just by carrying an old WMA.
  series(hma([5, 5, 5, 5, 5, null, 5], 5), [null, null, null, null, null, null, 5]);
});

test("SMMA matches published reset/reseed branches and differs from na-skipping RMA", () => {
  series(smma([1, 2, 3, 4, 5], 3), [null, null, 2, 8 / 3, 31 / 9]);
  // After the gap, latest three valid observations are2,3,6; reseed=11/3.
  series(smma([1, 2, 3, null, 6, 9], 3), [null, null, 2, null, 11 / 3, 49 / 9]);
  // Literal internal previous-null branch can seed on a second consecutive gap.
  // The renderer gap mask stays null; next valid6 uses internal seed2 =>10/3.
  series(smma([1, 2, 3, null, null, 6], 3), [null, null, 2, null, null, 10 / 3]);
  series(smma([null, 1, null, 3], 2), [null, null, null, 2]);
});

test("constant/zero/length1/short histories stay aligned across all six functions", () => {
  for (const calculate of [wma, dema, tema, hma, smma]) {
    series(calculate([], 3), []);
    series(calculate([null, null], 3), [null, null]);
    series(calculate([0, null, 4, -2], 1), [0, null, 4, -2]);
    assert.ok(
      calculate(Array(20).fill(7), 5)
        .filter((value) => value !== null)
        .every((value) => Math.abs(value - 7) < 1e-13)
    );
    assert.ok(
      calculate(Array(20).fill(0), 5)
        .filter((value) => value !== null)
        .every((value) => value === 0)
    );
  }
  series(vwma([], [], 3), []);
  series(wma([1, 2], 3), [null, null]);
  series(hma([1, 2, 3, 4, 5], 5), Array(5).fill(null));
  series(smma([1, 2], 3), [null, null]);
});

test("high magnitude inputs avoid weighted-product overflow and outputs remain finite-or-null", () => {
  series(wma([Number.MAX_VALUE, Number.MAX_VALUE], 2), [null, Number.MAX_VALUE]);
  series(wma([-1e308, 1e308], 2), [null, 1e308 / 3]);
  series(vwma([1e308, 1e308], [1e308, 1e308], 2), [null, 1e308]);
  series(vwma([-1e308, 1e308], [1e308, 1e308], 2), [null, 0]);
  for (const calculate of [dema, tema, hma, smma]) {
    const output = calculate(Array(8).fill(1e308), 3);
    assert.ok(output.some((value) => value !== null));
    assert.ok(output.every((value) => value === null || Number.isFinite(value)));
    series(
      output.filter((value) => value !== null),
      output.filter((value) => value !== null).map(() => 1e308)
    );
  }
  const largeOffset = wma([1e12 + 1, 1e12 + 2, 1e12 + 3], 3).at(-1);
  assert.ok(Math.abs(largeOffset - 1e12 - 7 / 3) < 0.0003);
  for (const calculate of [dema, tema, hma, smma])
    assert.ok(
      calculate([-1e308, 1e308, -1e308, 1e308], 2).every(
        (value) => value === null || Number.isFinite(value)
      )
    );
});

test("frozen inputs, independent calls, source correction and parameter changes are causal", () => {
  const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
  const volume = Object.freeze([1, 2, 1, 3, 2, 1, 1, 2]);
  const before = JSON.stringify([source, volume]);
  for (const calculate of [
    wma,
    dema,
    tema,
    hma,
    smma,
    (values, length) => vwma(values, volume, length)
  ]) {
    const first = calculate(source, 3);
    assert.notDeepEqual(calculate(source, 2), first);
    assert.deepEqual(calculate(source, 3), first);
    const changed = calculate([...source.slice(0, -1), 100], 3);
    assert.deepEqual(first.slice(0, -1), changed.slice(0, -1));
    assert.notEqual(first.at(-1), changed.at(-1));
    const historical = calculate(
      source.map((value, index) => (index === 6 ? 40 : value)),
      3
    );
    assert.notEqual(first.at(-1), historical.at(-1));
  }
  assert.equal(JSON.stringify([source, volume]), before);
});

test("invalid numeric, sparse, length, volume and alignment inputs fail explicitly", () => {
  for (const calculate of [wma, dema, tema, hma, smma]) {
    for (const length of [0, -1, 1.5, NaN, Infinity, 10001])
      assert.throws(() => calculate([1], length), RangeError);
    for (const input of [[1, NaN], [Infinity], [undefined], new Array(3)])
      assert.throws(() => calculate(input, 2), RangeError);
  }
  assert.throws(() => vwma([1], [], 1), /align/);
  assert.throws(() => vwma([1], [-1], 1), /nonnegative/);
  assert.throws(() => vwma([1], [NaN], 1), /finite/);
  assert.throws(() => vwma([1], [1], 0), /length/);
});

test("data-only presets and history distinguish finite warmup from recursive dependence", () => {
  const defaults = { wma: 9, vwma: 20, dema: 9, tema: 9, hma: 9, smma: 7 };
  assert.equal(movingAveragePresets.length, 6);
  for (const preset of movingAveragePresets) {
    assert.equal(preset.defaultLength, defaults[preset.id]);
    assert.equal(preset.defaultPane, "overlay");
    assert.equal(preset.status, "math-only");
    assert.equal(preset.minLength, preset.id === "hma" ? 2 : 1);
    assert.equal(preset.requiresVolume, preset.id === "vwma");
  }
  assert.deepEqual(JSON.parse(JSON.stringify(movingAveragePresets)), movingAveragePresets);
  assert.throws(() => {
    movingAveragePresets[0].defaultLength = 30;
  }, TypeError);
  for (const id of ["wma", "vwma", "hma"]) {
    const metadata = movingAverageMetadata(id, 7);
    assert.equal(metadata.warmupBars, id === "hma" ? 8 : 7);
    assert.deepEqual(metadata.historyRequirement, {
      kind: "finite",
      lookbackBars: metadata.warmupBars,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    });
  }
  for (const id of ["dema", "tema", "smma"]) {
    assert.deepEqual(movingAverageMetadata(id, 3).historyRequirement, {
      kind: "recursive",
      lookbackBars: null,
      seedBars: id === "smma" ? 3 : 1,
      seedPolicy: id === "smma" ? "sma-of-first-length" : "first-value-ema-chain",
      convergence: "full-input-dependent"
    });
    const calculate = { dema, tema, smma }[id];
    assert.notEqual(calculate([100, 0, 1, 2, 3, 4], 3).at(-1), calculate([1, 2, 3, 4], 3).at(-1));
  }
  assert.equal(movingAverageMetadata("hma", 1).warmupBars, 1);
  assert.throws(() => movingAverageMetadata("unknown", 3), /Unknown/);
  assert.throws(() => movingAverageMetadata("wma", 0), /length/);
});

test("rolling rebases preserve hand ledgers and recover small values after a dominant scale leaves", () => {
  series(wma([3, -2, 7, 0, 4, -1, 8], 3), [null, null, 10 / 3, 2, 19 / 6, 5 / 6, 13 / 3]);
  series(vwma([3, -2, 7, 0, 4, -1, 8], [1, 0, 3, 2, 1, 4, 2], 3), [
    null,
    null,
    6,
    21 / 5,
    25 / 6,
    0,
    16 / 7
  ]);
  const prices = [1e308, 1, 1, 1e-308, 1e-308];
  series(wma(prices, 2), [null, 1e308 / 3, 1, 1 / 3, 1e-308]);
  series(vwma(prices, [1e308, 1, 1, 1, 1], 2), [null, 1e308, 1, 1 / 2, 1e-308]);
  assert.equal(wma(prices, 2).at(-1), 1e-308);
  assert.equal(vwma(prices, [1e308, 1, 1, 1, 1], 2).at(-1), 1e-308);
  assert.equal(vwma([1e308, 1e-308], [0, 1], 2).at(-1), 1e-308);
  // Each price*volume product is1. Independent price/volume normalization would underflow both.
  const tiny = vwma([1e308, 1e-308], [1e-308, 1e308], 2).at(-1);
  assert.ok(Math.abs(tiny / 1e-308 - 2) < 1e-14);
});

test("100k bars and period10k have a deterministic linear operation budget and closed-form ramp values", () => {
  const count = 100000,
    length = 10000;
  for (const positional of [true, false]) {
    const window = new RollingAverageWindow(length, positional);
    let last;
    for (let index = 1; index <= count; index++) last = window.push(index, 1);
    const expected = count - (length - 1) / (positional ? 3 : 2);
    assert.ok(Math.abs(last - expected) < 1e-7);
    assert.equal(window.rebaseCount, count / length);
    assert.ok(window.workUnits <= count * 2, `${window.workUnits} work units`);
  }
  const source = ramp(count),
    volume = Array(count).fill(1);
  const weighted = wma(source, length),
    volumeWeighted = vwma(source, volume, length);
  assert.equal(weighted.length, count);
  assert.equal(volumeWeighted.length, count);
  assert.equal(weighted[length - 2], null);
  assert.equal(volumeWeighted[length - 2], null);
  assert.ok(Math.abs(weighted.at(-1) - (count - (length - 1) / 3)) < 1e-7);
  assert.ok(Math.abs(volumeWeighted.at(-1) - (count - (length - 1) / 2)) < 1e-7);
  const offset = source.map((value) => 1e12 + value);
  assert.ok(Math.abs(wma(offset, length).at(-1) - 1e12 - (count - (length - 1) / 3)) < 0.001);
  assert.ok(
    Math.abs(vwma(offset, volume, length).at(-1) - 1e12 - (count - (length - 1) / 2)) < 0.001
  );
});
