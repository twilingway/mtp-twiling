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
  bollingerPercentB,
  bollingerBandwidth,
  historicalVolatility,
  awesomeOscillator,
  balanceOfPower,
  cmo,
  ultimateOscillator,
  trix,
  volatilityMomentumPresets,
  volatilityMomentumMetadata
} = load("volatility-momentum/index.js");
const { RollingMoments } = load("volatility-momentum/windows.js");
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
const bar = (close, open = close, high = close, low = close) => ({
  timestamp: 0,
  open,
  high,
  low,
  close,
  volume: null
});
const bars = (prices) =>
  prices.map((value) =>
    bar(value, value, value === null ? null : value + 1, value === null ? null : value - 1)
  );

test("Bollinger percentB hand ledger is a ratio, not a percentage, and supports outside-band values", () => {
  // Window[1,3]: mean2, populationSD1, multiplier1 bands[1,3].
  series(bollingerPercentB([1, 3, 5, 9], 2, 1), [null, 1, 1, 1]);
  series(bollingerPercentB([1, 3], 2), [null, 0.75]);
  series(bollingerPercentB([1, 3], 2, 0.001), [null, 500.5]);
  series(bollingerPercentB([2, 2, 2], 2), [null, null, null]);
  series(bollingerPercentB([1, null, 3], 2), [null, null, 0.75]);
  series(bollingerPercentB([1e12 + 1, 1e12 + 2, 1e12 + 3], 3), [
    null,
    null,
    0.5 + Math.sqrt(1.5) / 4
  ]);
  series(bollingerPercentB([-1e308, 1e308], 2), [null, 0.75]);
});

test("BandWidth includes both real extrema outputs and counts their windows by bar position", () => {
  const output = bollingerBandwidth([1, 3, 5, 9], 2, 1, 2, 2);
  series(output.value, [null, 100, 50, 400 / 7]);
  series(output.highestExpansion, [null, 100, 100, 400 / 7]);
  series(output.lowestContraction, [null, 100, 50, 50]);
  const gap = bollingerBandwidth([1, 3, null, 5], 2, 1, 2, 2);
  series(gap.value, [null, 100, null, 50]);
  series(gap.highestExpansion, [null, 100, null, 50]);
  series(gap.lowestContraction, [null, 100, null, 50]);
  series(bollingerBandwidth([2, 2], 2).value, [null, 0]);
  series(bollingerBandwidth([-1, 1], 2).value, [null, null]);
  series(bollingerBandwidth([-3, -1], 2).value, [null, -200]);
});

test("HV manual log-return variance uses explicit annualization and population divisor", () => {
  // Log returns1,2,3; every two-value populationSD=.5, three-valueSD=sqrt(2/3).
  const prices = [1, Math.exp(1), Math.exp(3), Math.exp(6)];
  series(historicalVolatility(prices, 1, 2), [null, null, 50, 50]);
  series(historicalVolatility(prices, 365, 2), [
    null,
    null,
    50 * Math.sqrt(365),
    50 * Math.sqrt(365)
  ]);
  series(historicalVolatility(prices, 365 / 7, 3), [
    null,
    null,
    null,
    100 * Math.sqrt(2 / 3) * Math.sqrt(365 / 7)
  ]);
  series(historicalVolatility([5, 5, 5], 1, 2), [null, null, 0]);
  series(historicalVolatility([1, 2], 1, 1), [null, 0]);
  assert.throws(() => historicalVolatility(prices), /periodsPerYear/);
  for (const annualization of [0, -1, NaN, Infinity, "365"])
    assert.throws(() => historicalVolatility(prices, annualization), RangeError);
});

test("HV logarithmic domain and missing adjacent data create gaps without fictitious returns", () => {
  series(historicalVolatility([0, 1, Math.E, Math.exp(3)], 1, 2), [null, null, null, 50]);
  series(historicalVolatility([1, Math.E, null, Math.exp(3), Math.exp(6)], 1, 2), [
    null,
    null,
    null,
    null,
    100
  ]);
  series(historicalVolatility([-1, 0, -2], 1, 1), [null, null, null]);
  const output = historicalVolatility([1e-308, 1e308, 1e-308], 1, 2);
  series(output.slice(2), [100 * (Math.log(1e308) - Math.log(1e-308))]);
});

test("AO fixed5/34 ledger uses midpoints and genuine34-observation warmup", () => {
  const values = [...new Array(29).fill(0), ...new Array(5).fill(10), 0];
  const input = bars(values).map((item) => ({ ...item, close: item.close + 0.5 }));
  const output = awesomeOscillator(input);
  series(output, [...new Array(33).fill(null), 145 / 17, 111 / 17]);
  series(awesomeOscillator(bars(new Array(35).fill(4))).slice(33), [0, 0]);
  const gap = [...bars(new Array(33).fill(4)), bar(null), ...bars([4])];
  series(awesomeOscillator(gap).slice(32), [null, null, 0]);
});

test("BOP uses unsmoothed OHLC range and never invents a value for a zero range", () => {
  series(balanceOfPower([bar(5, 2, 6, 0), bar(2, 5, 6, 0), bar(2, 2, 6, 0), bar(5)]), [
    0.5,
    -0.5,
    0,
    null
  ]);
  series(balanceOfPower([bar(1e308, -1e308, 1e308, -1e308)]), [1]);
  series(balanceOfPower([{ ...bar(1, 0, 2, 0), open: null }]), [null]);
});

test("CMO gain/loss ledger uses simple sums with verified default9 rather than20", () => {
  // +2,-1,+3 =>gain5/loss1; next-1,+3,-2 =>gain3/loss3.
  series(cmo([10, 12, 11, 14, 12], 3), [null, null, null, 200 / 3, 0]);
  series(cmo([3, 2, 1], 1), [null, -100, -100]);
  series(cmo([1, 2, 3], 1), [null, 100, 100]);
  series(cmo([1, 1, 1], 2), [null, null, null]);
  series(cmo([1, 2, null, 4, 5, 6], 2), [null, null, null, null, null, 100]);
  const defaults = cmo(Array.from({ length: 11 }, (_, index) => index));
  series(defaults, [...new Array(9).fill(null), 100, 100]);
});

test("UO combines independent hand-ledger buying pressure and true-range totals", () => {
  const input = [
    bar(5, 5, 10, 0),
    bar(8, 8, 10, 2),
    bar(6, 6, 12, 4),
    bar(3, 3, 9, 1),
    bar(12, 12, 14, 8)
  ];
  // BP=[6,2,2,9], TR=[8,8,8,11]. At fourth bar ratios1/4,1/4,5/12.
  series(ultimateOscillator(input, 1, 2, 3), [
    null,
    null,
    null,
    575 / 21,
    (100 / 7) * (36 / 11 + 22 / 19 + 13 / 27)
  ]);
  series(ultimateOscillator(input, 3, 1, 2).slice(3, 4), [725 / 21]);
  assert.ok(ultimateOscillator(new Array(32).fill(bar(1))).every((value) => value === null));
  const withGap = [...input.slice(0, 3), { ...input[3], close: null }, ...input.slice(0, 4)];
  assert.ok(
    ultimateOscillator(withGap, 1, 2, 3)
      .slice(3, 7)
      .every((value) => value === null)
  );
});

test("TRIX public logEMA formula and scale are distinguished from textbook percentROC", () => {
  series(trix([1, Math.E, Math.exp(2)], 1), [null, 10000, 10000]);
  // alpha2/3, EMA3(log prices0,1,2)=[0,8/27,8/9].
  series(trix([1, Math.E, Math.exp(2)], 2), [null, 80000 / 27, 160000 / 27]);
  series(trix([2, 2, 2], 18), [null, 0, 0]);
  series(trix([1, Math.E, null, Math.exp(2)], 2), [null, 80000 / 27, null, 400000 / 81]);
  series(trix([null, 0, -1, 1, Math.E], 1), [null, null, null, null, 10000]);
});

test("all functions are aligned, deterministic, causal and accept frozen inputs without mutation", () => {
  const values = Object.freeze([1, 2, 3, 4, 5]),
    input = Object.freeze(bars(values).map(Object.freeze));
  const numeric = [
    (source) => bollingerPercentB(source, 2),
    (source) => historicalVolatility(source, 365, 2),
    (source) => cmo(source, 2),
    (source) => trix(source, 2)
  ];
  for (const fn of numeric) {
    const before = JSON.stringify(values),
      output = fn(values);
    assert.equal(JSON.stringify(values), before);
    assert.deepEqual(output.slice(0, 3), fn(values.slice(0, 3)));
    assert.deepEqual(fn([]), []);
  }
  for (const fn of [
    awesomeOscillator,
    balanceOfPower,
    (source) => ultimateOscillator(source, 1, 2, 3)
  ]) {
    const before = JSON.stringify(input),
      output = fn(input);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(output.slice(0, 3), fn(input.slice(0, 3)));
    assert.deepEqual(fn([]), []);
  }
  const result = bollingerBandwidth(values, 2, 2, 2, 3);
  for (const [key, output] of Object.entries(result))
    assert.deepEqual(output.slice(0, 3), bollingerBandwidth(values.slice(0, 3), 2, 2, 2, 3)[key]);
  assert.deepEqual(bollingerBandwidth([]), {
    value: [],
    highestExpansion: [],
    lowestContraction: []
  });
});

test("nonfinite values, holes, invalid lengths/multipliers and malformed consumed OHLC are rejected", () => {
  for (const source of [[NaN], [Infinity], [-Infinity], [undefined], new Array(2)]) {
    for (const fn of [bollingerPercentB, bollingerBandwidth, cmo, trix])
      assert.throws(() => fn(source), RangeError);
    assert.throws(() => historicalVolatility(source, 365), RangeError);
  }
  for (const length of [0, -1, 1.5, 10001, NaN, Infinity]) {
    for (const fn of [bollingerPercentB, bollingerBandwidth, cmo, trix])
      assert.throws(() => fn([], length), RangeError);
    assert.throws(() => historicalVolatility([], 365, length), RangeError);
    assert.throws(() => ultimateOscillator([], length, 1, 1), RangeError);
  }
  for (const mult of [0, -1, 0.0009, 50.01, NaN, Infinity])
    for (const fn of [bollingerPercentB, bollingerBandwidth])
      assert.throws(() => fn([], 2, mult), RangeError);
  assert.throws(() => bollingerBandwidth([], 2, 2, 0), RangeError);
  for (const fn of [awesomeOscillator, balanceOfPower, ultimateOscillator]) {
    assert.throws(() => fn(new Array(2)), RangeError);
    assert.throws(() => fn([bar(1, 1, 0, 2)]), RangeError);
    assert.throws(() => fn([{ ...bar(1), high: NaN }]), RangeError);
  }
});

test("extreme scales recover after dominant observations leave and never leak nonfinite outputs", () => {
  series(bollingerPercentB([1e308, 1, 2, 3], 2), [null, 0.25, 0.75, 0.75]);
  series(cmo([-1e308, 1e308, 1, 2, 3], 2), [null, null, null, -100, 100]);
  const output = ultimateOscillator([bar(-1e308), bar(1e308), bar(1), bar(2), bar(3)], 1, 1, 1);
  series(output, [null, null, 0, 100, 100]);
  for (const prices of [
    [1e308, -1e308, 1],
    [1e308, 1, -1e308]
  ]) {
    const moments = new RollingMoments(3);
    let final;
    for (const price of prices) final = moments.push(price);
    series([final.mean], [1 / 3]);
  }
});

test("immutable metadata records exact built-ins, HV required context and all BBW outputs/history", () => {
  assert.equal(volatilityMomentumPresets.length, 8);
  assert.ok(Object.isFrozen(volatilityMomentumPresets));
  for (const item of volatilityMomentumPresets) {
    assert.equal(item.status, "math-only");
    assert.equal(item.defaultPane, "pane");
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.defaults));
    assert.ok(Object.isFrozen(item.limits));
    assert.ok(Object.isFrozen(item.outputs));
    assert.deepEqual(item.omittedNumericOutputs, []);
    assert.ok(item.reference.includes(encodeURIComponent(item.publicId)));
    const metadata = volatilityMomentumMetadata(item.id);
    assert.ok(Object.isFrozen(metadata));
    assert.ok(Object.isFrozen(metadata.historyRequirement));
  }
  const hv = volatilityMomentumPresets.find((item) => item.id === "historical-volatility");
  assert.deepEqual(hv.requiredContext, ["periodsPerYear"]);
  assert.equal(hv.defaults.builtinAnnual, 365);
  assert.equal(volatilityMomentumPresets.find((item) => item.id === "cmo").defaults.length, 9);
  assert.equal(volatilityMomentumPresets.find((item) => item.id === "trix").defaults.scale, 10000);
  const bbw = volatilityMomentumPresets.find((item) => item.id === "bollinger-bandwidth");
  assert.deepEqual(bbw.outputs, ["value", "highestExpansion", "lowestContraction"]);
  assert.equal(volatilityMomentumMetadata("bollinger-bandwidth").warmupBars, 20);
  assert.equal(
    volatilityMomentumMetadata("bollinger-bandwidth").historyRequirement.lookbackBars,
    144
  );
  assert.equal(volatilityMomentumMetadata("historical-volatility").warmupBars, 11);
  assert.equal(volatilityMomentumMetadata("ultimate-oscillator").warmupBars, 29);
  assert.deepEqual(volatilityMomentumMetadata("trix").historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: 1,
    seedPolicy: "first-value-ema-chain",
    convergence: "full-input-dependent"
  });
  assert.throws(() => volatilityMomentumMetadata("unknown"), RangeError);
  assert.throws(() => volatilityMomentumMetadata("awesome-oscillator", { length: 2 }), RangeError);
  assert.throws(() => volatilityMomentumMetadata("cmo", { length: 0 }), RangeError);
  assert.deepEqual(
    JSON.parse(JSON.stringify(volatilityMomentumPresets)),
    volatilityMomentumPresets
  );
});

test("rolling population moments have a deterministic linear work budget on100000 bars/10000 window", () => {
  const count = 100000,
    length = 10000,
    window = new RollingMoments(length);
  let first, last;
  for (let index = 1; index <= count; index++) {
    last = window.push(index);
    if (index === length) first = last;
  }
  series([first.mean, last.mean], [(length + 1) / 2, count - (length - 1) / 2]);
  series(
    [first.normalizedDeviation * first.scale, last.normalizedDeviation * last.scale],
    [Math.sqrt((length * length - 1) / 12), Math.sqrt((length * length - 1) / 12)],
    1e-10
  );
  assert.ok(window.workUnits <= 4 * count, `${window.workUnits} workUnits`);
});
