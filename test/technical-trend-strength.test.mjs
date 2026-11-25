import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/model/technical-indicators/", import.meta.url)),
  modules = new Map();
function load(name) {
  const file = path.resolve(root, name).replace(/\.js$/, ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
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
const {
  aroon,
  aroonOscillator,
  dmi,
  adx,
  vortex,
  choppinessIndex,
  trendStrengthPresets,
  trendStrengthMetadata
} = load("trend-strength/index.js");
const { trendTrueRange } = load("trend-strength/inputs.js");
const bar = (high, low, close = (high + low) / 2, timestamp = 1) => ({
  timestamp,
  open: close,
  high,
  low,
  close,
  volume: null
});
const candles = (values) =>
  values.map(([high, low, close], index) => bar(high, low, close, 1000 + index * 60000));
const gap = () => ({ timestamp: 0, open: null, high: null, low: null, close: null, volume: null });
const directionalLedger = () =>
  candles([
    [11, 9, 10],
    [14, 12, 13],
    [13, 10, 12],
    [15, 13, 14],
    [12, 10, 11]
  ]);
const vortexLedger = () =>
  candles([
    [3, 1, 2],
    [5, 2, 4],
    [4, 1, 2],
    [6, 3, 5]
  ]);
function series(actual, expected, tolerance = 2e-12) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else
      assert.ok(
        Number.isFinite(actual[index]) &&
          Math.abs(actual[index] - value) <= tolerance * Math.max(1, Math.abs(value)),
        `index ${index}: ${actual[index]} != ${value}`
      );
  });
}
const outputs = (result) => (Array.isArray(result) ? { value: result } : result);
const calls = [
  (input) => aroon(input, 2),
  (input) => aroonOscillator(input, 2),
  (input) => dmi(input, 2, 2),
  (input) => adx(input, 2, 2),
  (input) => vortex(input, 2),
  (input) => choppinessIndex(input, 2)
];

test("Aroon hand ledger includes the oldest n-back bar in its n+1 positional window", () => {
  const input = candles([
    [5, 1, 3],
    [4, 2, 3],
    [3, 0, 1],
    [6, 3, 4],
    [5, 2, 3]
  ]);
  series(aroon(input, 2).up, [100, 50, 0, 100, 50]);
  series(aroon(input, 2).down, [100, 50, 100, 50, 0]);
  series(aroonOscillator(input, 2), [0, 0, -100, 50, 50]);
  const ramp = candles(Array.from({ length: 16 }, (_, index) => [index + 2, index, index + 1]));
  series(aroon(ramp).up, new Array(16).fill(100));
  series(
    aroon(ramp).down,
    Array.from({ length: 16 }, (_, index) => (100 * Math.max(0, 14 - index)) / 14)
  );
});

test("Aroon most-recent ties and independent high/low gap masks are explicit local policies", () => {
  const input = candles([
    [5, 1, 3],
    [5, 1, 3],
    [4, 2, 3]
  ]);
  series(aroon(input, 2).up, [100, 100, 50]);
  series(aroon(input, 2).down, [100, 100, 50]);
  const partial = [input[0], { ...input[1], high: null }, input[2]];
  series(aroon(partial, 2).up, [100, null, 0]);
  series(aroon(partial, 2).down, [100, 100, 50]);
  series(aroonOscillator(partial, 2), [0, null, -50]);
  assert.doesNotThrow(() => aroon([{ ...input[0], close: NaN }]));
});

test("strict TR and ATR fallback have different first observations", () => {
  const input = directionalLedger();
  series(trendTrueRange(input, false), [null, 4, 3, 3, 4]);
  series(trendTrueRange(input, true), [2, 4, 3, 3, 4]);
  const missingClose = [input[0], { ...input[1], close: null }, input[2]];
  series(trendTrueRange(missingClose, false), [null, 4, null]);
  series(trendTrueRange(missingClose, true), [2, 4, 3]);
});

test("DMI independent rational ledger verifies Wilder seeds, DI denominators and second ADX smoothing", () => {
  // TR[4,3] seed7/2; DM+ seed3/2; DM- seed1. Next TR13/4, DM+7/4, DM-1/2.
  const result = dmi(directionalLedger(), 2, 2);
  series(result.plusDI, [null, null, 300 / 7, 700 / 13, 700 / 29]);
  series(result.minusDI, [null, null, 200 / 7, 200 / 13, 1400 / 29]);
  // DX seed observations1/5,5/9 =>17/45. Next DX1/3 -> Wilder16/45.
  series(result.adx, [null, null, null, 340 / 9, 320 / 9]);
  series(adx(directionalLedger(), 2, 2), [null, null, null, 340 / 9, 320 / 9]);
});

test("equal positive DM moves select neither direction, unlike an arbitrary >= tie branch", () => {
  const input = candles([
    [11, 9, 10],
    [12, 8, 10],
    [11, 9, 10]
  ]);
  const result = dmi(input, 1, 1);
  series(result.plusDI, [null, 0, 0]);
  series(result.minusDI, [null, 0, 0]);
  series(result.adx, [null, 0, 0]);
});

test("initial zero TR stays unknown; later zero TR holds only a previously known DI via fixnan", () => {
  const point = candles(new Array(8).fill([5, 5, 5]));
  for (const values of Object.values(dmi(point, 2, 2)))
    assert.ok(values.every((value) => value === null));
  const result = dmi(
    candles([
      [11, 9, 10],
      [12, 10, 11],
      [11, 11, 11]
    ]),
    1,
    1
  );
  series(result.plusDI, [null, 50, 50]);
  series(result.minusDI, [null, 0, 0]);
  series(result.adx, [null, 100, 100]);
  const wide = dmi(candles(new Array(5).fill([6, 4, 5])), 2, 2);
  series(wide.plusDI, [null, null, 0, 0, 0]);
  series(wide.minusDI, [null, null, 0, 0, 0]);
  series(wide.adx, [null, null, null, 0, 0]);
});

test("default14/14 DI starts at15 bars and ADX at28, distinct from convergence history", () => {
  const result = dmi(candles(new Array(30).fill([6, 4, 5])));
  series(result.plusDI, [...new Array(14).fill(null), ...new Array(16).fill(0)]);
  series(result.adx, [...new Array(27).fill(null), 0, 0, 0]);
});

test("Vortex hand ledger uses separate VM+/VM- totals and ATR1 true range without clipping at1", () => {
  // VM+4,2,5; VM-1,4,1; TR3,3,4. Two-bar ratios6/6,5/6 then7/7,5/7.
  const result = vortex(vortexLedger(), 2);
  series(result.plusVI, [null, null, 1, 1]);
  series(result.minusVI, [null, null, 5 / 6, 5 / 7]);
  series(vortex(vortexLedger(), 3).plusVI, [null, null, null, 11 / 10]);
  series(vortex(vortexLedger(), 3).minusVI, [null, null, null, 3 / 5]);
});

test("CHOP log ledger includes first-bar ATR and uses actual high/low span", () => {
  // ATR1[2,3,3,4], two-bar sums5,6,7; positional spans4,4,5.
  series(choppinessIndex(vortexLedger(), 2), [
    null,
    (100 * Math.log10(5 / 4)) / Math.log10(2),
    (100 * Math.log10(3 / 2)) / Math.log10(2),
    (100 * Math.log10(7 / 5)) / Math.log10(2)
  ]);
  series(choppinessIndex(candles(new Array(4).fill([3, 1, 2])), 2), [null, 100, 100, 100]);
  assert.ok(
    choppinessIndex(candles(new Array(4).fill([2, 2, 2])), 2).every((value) => value === null)
  );
  assert.ok(choppinessIndex(vortexLedger(), 1).every((value) => value === null));
});

test("CHOP is not clamped at100 after a real market gap; exact history needs the preceding close", () => {
  const input = candles([
    [101, 99, 100],
    [1, 0, 0.5],
    [1, 0, 0.5]
  ]);
  const full = choppinessIndex(input, 2).at(-1);
  series([full], [(100 * Math.log10(101)) / Math.log10(2)]);
  assert.ok(full > 100);
  series([choppinessIndex(input.slice(1), 2).at(-1)], [100]);
  assert.equal(
    trendStrengthMetadata("choppiness-index", { length: 2 }).historyRequirement.lookbackBars,
    3
  );
});

test("gap masks preserve unknown adjacent movements while internal known Wilder state continues", () => {
  const input = [
    ...candles([
      [11, 9, 10],
      [12, 10, 11]
    ]),
    gap(),
    ...candles([
      [13, 11, 12],
      [14, 12, 13]
    ])
  ];
  const result = dmi(input, 1, 2);
  series(result.plusDI, [null, 50, null, null, 50]);
  series(result.minusDI, [null, 0, null, null, 0]);
  series(result.adx, [null, null, null, null, 100]);
  const original = vortexLedger(),
    missing = [original[0], original[1], gap(), original[2], original[3]];
  series(vortex(missing, 2).plusVI, [null, null, null, null, 9 / 7]);
  series(vortex(missing, 2).minusVI, [null, null, null, null, 2 / 7]);
  assert.equal(choppinessIndex(missing, 2)[2], null);
});

test("price translation and positive scaling preserve trend ratios; reflecting OHLC swaps directions", () => {
  const input = directionalLedger();
  const transformed = input.map((item) => ({
    ...item,
    open: item.open * 7 + 1000,
    high: item.high * 7 + 1000,
    low: item.low * 7 + 1000,
    close: item.close * 7 + 1000
  }));
  for (const fn of calls) {
    const base = outputs(fn(input)),
      changed = outputs(fn(transformed));
    for (const key of Object.keys(base)) series(changed[key], base[key], 1e-10);
  }
  const reflected = input.map((item) => ({
    ...item,
    open: -item.open,
    high: -item.low,
    low: -item.high,
    close: -item.close
  }));
  series(aroon(reflected, 2).up, aroon(input, 2).down);
  series(
    aroonOscillator(reflected, 2),
    aroonOscillator(input, 2).map((value) => (value === null ? null : -value))
  );
  series(dmi(reflected, 2, 2).plusDI, dmi(input, 2, 2).minusDI);
  series(adx(reflected, 2, 2), adx(input, 2, 2));
  series(vortex(reflected, 2).plusVI, vortex(input, 2).minusVI);
  series(choppinessIndex(reflected, 2), choppinessIndex(input, 2));
});

test("all functions are causal, deterministic and preserve frozen OHLC/timestamp alignment", () => {
  const input = Object.freeze(directionalLedger().map(Object.freeze)),
    before = JSON.stringify(input);
  for (const fn of calls) {
    const full = outputs(fn(input)),
      prefix = outputs(fn(input.slice(0, 3)));
    for (const key of Object.keys(full)) {
      assert.equal(full[key].length, input.length);
      assert.deepEqual(full[key].slice(0, 3), prefix[key]);
    }
    for (const values of Object.values(outputs(fn([])))) assert.deepEqual(values, []);
    assert.deepEqual(outputs(fn(input)), full);
  }
  assert.equal(JSON.stringify(input), before);
  const shiftedTime = input.map((item, index) => ({
    ...item,
    timestamp: item.timestamp + index * 86400000
  }));
  for (const fn of calls) assert.deepEqual(fn(shiftedTime), fn(input));
});

test("periods, malformed consumed OHLC, sparse bars and nonfinite values fail explicitly", () => {
  for (const invalid of [0, -1, 1.5, 10001, NaN, Infinity]) {
    for (const fn of [aroon, aroonOscillator, dmi, adx, vortex, choppinessIndex])
      assert.throws(() => fn([], invalid), RangeError);
    assert.throws(() => dmi([], 2, invalid), RangeError);
    assert.throws(() => adx([], 2, invalid), RangeError);
  }
  assert.throws(() => vortex([], 1), RangeError);
  for (const fn of [aroon, aroonOscillator, dmi, adx, vortex, choppinessIndex]) {
    assert.throws(() => fn(new Array(2)), RangeError);
    assert.throws(() => fn([bar(1, 2, 1)]), RangeError);
    for (const value of [NaN, Infinity, -Infinity, undefined])
      assert.throws(() => fn([{ ...bar(3, 1, 2), high: value }]), RangeError);
  }
  for (const fn of [dmi, adx, vortex, choppinessIndex])
    assert.throws(() => fn([bar(3, 1, 4)]), RangeError);
});

test("unrepresentable ranges/movements become null, never NaN/Infinity or manufactured zeros", () => {
  const extreme = candles([
    [2, 0, 1],
    [1e308, -1e308, 0],
    [2, 0, 1],
    [3, 1, 2],
    [4, 2, 3]
  ]);
  assert.equal(trendTrueRange(extreme, false)[1], null);
  assert.equal(choppinessIndex(extreme, 2)[1], null);
  assert.equal(dmi(extreme, 1, 1).plusDI[1], null);
  for (const fn of calls)
    for (const values of Object.values(outputs(fn(extreme))))
      assert.ok(values.every((value) => value === null || Number.isFinite(value)));
});

test("immutable metadata states exact presets, per-output warmup and undefined CHOP length1", () => {
  const expected = {
    aroon: "STD;Aroon",
    "aroon-oscillator": "STD;Aroon_Oscillator",
    dmi: "STD;DMI",
    adx: "STD;Average%1Directional%1Index",
    vortex: "STD;Vortex%1Indicator",
    "choppiness-index": "STD;Choppiness_Index"
  };
  assert.equal(trendStrengthPresets.length, 6);
  assert.ok(Object.isFrozen(trendStrengthPresets));
  for (const item of trendStrengthPresets) {
    assert.equal(item.publicId, expected[item.id]);
    assert.equal(item.status, "math-only");
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.defaults));
    assert.ok(Object.isFrozen(item.limits));
    assert.ok(Object.isFrozen(item.outputs));
    assert.deepEqual(item.omittedNumericOutputs, []);
    assert.ok(item.reference.includes(encodeURIComponent(item.publicId)));
    const meta = trendStrengthMetadata(item.id);
    assert.ok(Object.isFrozen(meta));
    assert.ok(Object.isFrozen(meta.historyRequirement));
  }
  assert.deepEqual(trendStrengthMetadata("dmi").outputWarmup, { plusDI: 15, minusDI: 15, adx: 28 });
  assert.deepEqual(trendStrengthMetadata("adx").historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: 28,
    seedPolicy: "adjacent-change-wilder",
    convergence: "full-input-dependent"
  });
  assert.equal(trendStrengthMetadata("aroon").warmupBars, 1);
  assert.equal(trendStrengthMetadata("aroon").historyRequirement.lookbackBars, 15);
  assert.equal(trendStrengthMetadata("vortex").warmupBars, 15);
  assert.equal(trendStrengthMetadata("choppiness-index").warmupBars, 14);
  const undefinedChop = trendStrengthMetadata("choppiness-index", { length: 1 });
  assert.equal(undefinedChop.warmupBars, null);
  assert.equal(undefinedChop.alwaysUndefined, true);
  assert.equal(trendStrengthPresets.find((item) => item.id === "vortex").limits.length.min, 2);
  assert.deepEqual(
    trendStrengthPresets.find((item) => item.id === "choppiness-index").presentationInputs,
    [{ key: "offset", defaultValue: 0, min: -500, max: 500 }]
  );
  assert.throws(() => trendStrengthMetadata("unknown"), RangeError);
  assert.throws(() => trendStrengthMetadata("vortex", { length: 1 }), RangeError);
  assert.throws(() => trendStrengthMetadata("aroon", { diLength: 2 }), RangeError);
  assert.deepEqual(JSON.parse(JSON.stringify(trendStrengthPresets)), trendStrengthPresets);
});

test("large 100000-bar/10000-period paths retain closed-form endpoints", () => {
  const count = 100000,
    length = 10000;
  const input = Array.from({ length: count }, (_, index) =>
    bar(index + 101, index + 99, index + 100, index + 1)
  );
  series([aroon(input, length).up.at(-1), aroon(input, length).down.at(-1)], [100, 0]);
  assert.equal(aroonOscillator(input, length).at(-1), 100);
  const directional = dmi(input, length, length);
  series(
    [directional.plusDI.at(-1), directional.minusDI.at(-1), directional.adx.at(-1)],
    [50, 0, 100]
  );
  assert.equal(directional.adx[2 * length - 2], null);
  assert.equal(directional.adx[2 * length - 1], 100);
  const vi = vortex(input, length);
  series([vi.plusVI.at(-1), vi.minusVI.at(-1)], [1.5, 0.5]);
  series(
    [choppinessIndex(input, length).at(-1)],
    [(100 * Math.log10((2 * length) / (length + 1))) / Math.log10(length)],
    1e-10
  );
});
