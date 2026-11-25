import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/model/technical-indicators/", import.meta.url)), modules = new Map();
function load(name) {
  const file = path.resolve(root, name).replace(/\.js$/, ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${output}\n})`, { filename: file }).runInThisContext()(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))), module, module.exports);
  return module.exports;
}
const core = load("index.js"), make = core.createTechnicalIndicatorInstance;
const bars = (closes) => closes.map((close, i) => ({ timestamp: 1000 + i * 60000, open: close,
  high: close === null ? null : close + 1, low: close === null ? null : close - 1, close, volume: close === null ? null : 100 }));
const ohlc = (high, low, close, i = 0) => ({ timestamp: 1000 + i * 60000, open: close, high, low, close, volume: 10 });
function series(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === null) assert.equal(actual[i], null, `index ${i}`);
    else {
      assert.equal(typeof actual[i], "number", `index ${i}`);
      assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance * Math.max(1, Math.abs(expected[i])),
        `index ${i}: ${actual[i]} != ${expected[i]}`);
    }
  }
}

test("EMA first-value seed differs from SMA-seeded Wilder RMA; na observations neither zero-fill nor consume period", () => {
  const input = [null, 1, 2, null, 3, 4];
  series(core.ema(input, 3), [null, 1, 1.5, 1.5, 2.25, 3.125]);
  series(core.sma(input, 3), [null, null, null, null, 2, 3]);
  series(core.rma(input, 3), [null, null, null, null, 2, 8 / 3]);
  series(core.ema([8, null, 9], 1), [8, 8, 9]);
  series(core.rma([8, null, 9], 1), [8, 8, 9]);
});

test("RSI hand ledger gain/loss seed and Wilder updates, including flat100 and zero-gain0 branches", () => {
  // Three changes +1,+2,-1 seed gain=1/loss=1/3. Next +3 gives 5/3 and 2/9.
  // After 0 then -1: gain=20/27, loss=35/81, ratio=12/7.
  series(core.rsi([10, 11, 13, 12, 15, 15, 14], 3), [null, null, null, 75, 1500 / 17, 1500 / 17, 1200 / 19]);
  series(core.rsi([7, 7, 7, 7], 3), [null, null, null, 100]);
  series(core.rsi([7, 6, 5, 4], 3), [null, null, null, 0]);
  series(core.rsi([7, 8, 9, 10], 3), [null, null, null, 100]);
  const defaultRsi = core.calculateTechnicalIndicator(make("rsi", "rsi14"), bars(Array(15).fill(4)));
  assert.equal(defaultRsi.warmupBars, 15);
  series(defaultRsi.series.value, [...Array(14).fill(null), 100]);
});

test("RSI adjacent na changes do not invent a move across missing data; runtime only masks the missing input bar", () => {
  // The 11→99 move crosses na and is excluded. Adjacent 99→12 is a real -87 change.
  series(core.rsi([10, 11, null, 99, 12, 13], 2), [null, null, null, null, 25 / 22, 10 / 3]);
  const result = core.calculateTechnicalIndicator(make("rsi", "gap", { params: { length: 2 } }), bars([1, 2, 3, null, 9, 10]));
  series(result.series.value, [null, null, 100, null, 100, 100]);
});

test("MACD rational EMA ledger and actual12/26/9 defaults have first-observation seeds", () => {
  // EMA2=[1,5/3,23/9,95/27], EMA3=[1,3/2,9/4,25/8]. Signal EMA2 starts at0.
  const result = core.macd([1, 2, 3, 4], 2, 3, 2);
  series(result.macd, [0, 1 / 6, 11 / 36, 85 / 216]);
  series(result.signal, [0, 1 / 9, 13 / 54, 37 / 108]);
  series(result.histogram, [0, 1 / 18, 7 / 108, 11 / 216]);
  const defaults = core.calculateTechnicalIndicator(make("macd", "macd"), bars([1, 2]));
  series(defaults.series.macd, [0, 28 / 351]);
  series(defaults.series.signal, [0, 28 / 1755]);
  series(defaults.series.histogram, [0, 112 / 1755]);
  assert.equal(defaults.warmupBars, 1);
});

test("Bollinger20/2 uses closed-form population variance and remains stable at large price offsets", () => {
  // Uniform integers1..20: mean=10.5, population variance=(20^2-1)/12=33.25.
  const result = core.calculateTechnicalIndicator(make("bollinger-bands", "bb"), bars(Array.from({ length: 21 }, (_, i) => i + 1)));
  series(result.series.basis, [...Array(19).fill(null), 10.5, 11.5]);
  series(result.series.upper.slice(19), [10.5 + 2 * Math.sqrt(33.25), 11.5 + 2 * Math.sqrt(33.25)]);
  series(result.series.lower.slice(19), [10.5 - 2 * Math.sqrt(33.25), 11.5 - 2 * Math.sqrt(33.25)]);
  series(core.populationDeviation([1e9 + 1, 1e9 + 2, 1e9 + 3, 1e9 + 4], 3), [null, null, Math.sqrt(2 / 3), Math.sqrt(2 / 3)]);
  series(core.populationDeviation([5, 5, null, 5], 1), [0, 0, 0, 0]);
  const flat = core.bollingerBands([5, 5, 5], 3, 2);
  series(flat.basis, [null, null, 5]); series(flat.upper, [null, null, 5]); series(flat.lower, [null, null, 5]);
});

test("ATR true range includes overnight gaps, first bar and missing-close fallback; Wilder seed is hand checked", () => {
  const input = [ohlc(11, 9, 10, 0), ohlc(14, 12, 13, 1), ohlc(13, 10, 12, 2), ohlc(15, 13, 14, 3), ohlc(12, 10, 11, 4)];
  series(core.trueRange(input), [2, 4, 3, 3, 4]);
  series(core.atr(input, 3), [null, null, 3, 3, 10 / 3]);
  input[3] = { timestamp: input[3].timestamp, open: null, high: null, low: null, close: null, volume: null };
  series(core.trueRange(input), [2, 4, 3, null, 2]);
  series(core.atr(input, 3), [null, null, 3, 3, 8 / 3]);
  const defaultAtr = core.calculateTechnicalIndicator(make("atr", "atr14"), bars(Array(14).fill(10)));
  series(defaultAtr.series.value, [...Array(13).fill(null), 2]);
});

test("Stochastic raw %K and two independent SMA passes match hand arithmetic; flat windows never invent50", () => {
  const input = [2, 4, 8, 6, 10].map((close, i) => ohlc(10, 0, close, i));
  const result = core.stochastic(input, 3, 2, 2);
  series(result.raw, [20, 40, 80, 60, 100]);
  series(result.k, [null, 30, 60, 70, 80]);
  series(result.d, [null, null, 45, 65, 75]);
  const defaults = core.calculateTechnicalIndicator(make("stochastic", "stoch"), input);
  series(defaults.series.k, [null, null, 140 / 3, 60, 80]);
  series(defaults.series.d, [null, null, null, null, 560 / 9]);
  assert.equal(defaults.warmupBars, 5);
  const flat = core.stochastic(Array.from({ length: 20 }, (_, i) => ohlc(5, 5, 5, i)));
  assert.ok([...flat.raw, ...flat.k, ...flat.d].every((value) => value === null));
});

test("Stochastic extrema count bar positions, ignoring missing extrema without stretching a two-bar window", () => {
  const input = [ohlc(5, 0, 1, 0), ohlc(7, 1, 2, 1), ohlc(8, 2, 3, 2),
    { timestamp: 181000, open: null, high: null, low: null, close: null, volume: null }, ohlc(6, 3, 5, 4)];
  const calculated = core.calculateTechnicalIndicator(make("stochastic", "s", { params: { length: 2, smoothK: 1, smoothD: 1 } }), input);
  assert.equal(calculated.series.k[3], null);
  series(calculated.series.k.slice(4), [200 / 3]);
});

test("all definitions are immutable serializable data; independent instances and styles round-trip with exact output keys", () => {
  const json = JSON.stringify(core.technicalIndicatorDefinitions);
  assert.equal(JSON.parse(json).length, 29);
  assert.ok(core.technicalIndicatorDefinitions.every((definition) => definition.status === "computed" && definition.references.length));
  assert.throws(() => { core.technicalIndicatorDefinitions[0].parameters[0].defaultValue = 999; }, TypeError);
  const a = make("rsi", "first", { params: { length: 2 }, pane: { kind: "pane", id: "osc" }, order: 1,
    styles: { value: { color: "#123456", width: 2, visible: true } } }), b = make("rsi", "second", { params: { length: 3 }, visible: false, order: 2 });
  const restored = JSON.parse(JSON.stringify([a, b]));
  assert.equal(core.isTechnicalIndicatorInstanceList(restored), true);
  assert.equal(core.isTechnicalIndicatorInstanceList([a, { ...b, id: a.id }]), false);
  const input = bars([10, 11, 13, 12]);
  assert.notDeepEqual(core.calculateTechnicalIndicator(a, input).series.value, core.calculateTechnicalIndicator(b, input).series.value);
  assert.equal(core.calculateTechnicalIndicator(b, input).instanceId, "second");
  for (const definition of core.technicalIndicatorDefinitions) {
    const result = core.calculateTechnicalIndicator(make(definition.id, definition.id), input, { historicalVolatilityPeriodsPerYear: 365 });
    assert.deepEqual(Object.keys(result.series), definition.outputs.map((output) => output.id));
    assert.deepEqual(result.timestamps, input.map((bar) => bar.timestamp));
    assert.ok(Object.values(result.series).every((values) => values.length === input.length && values.every((v) => v === null || Number.isFinite(v))));
  }
});

test("instance validation rejects arbitrary keys, code, unknown sources/outputs, invalid schema/length/pane/order and prototype data", () => {
  const base = make("rsi", "test");
  for (const change of [{ schemaVersion: 2 }, { id: "bad id" }, { definitionId: "exec" }, { params: { ...base.params, length: 0 } },
    { params: { ...base.params, length: 2.5 } }, { params: { ...base.params, length: Infinity } }, { params: { ...base.params, length: 10001 } },
    { params: { ...base.params, source: "eval(close)" } }, { params: { ...base.params, code: "alert()" } }, { order: -1 }, { order: NaN },
    { pane: { kind: "pane", id: "bad space" } }, { pane: { kind: "overlay", script: "bad" } }, { visible: "yes" },
    { styles: { unknown: { color: "#123456", width: 1, visible: true } } },
    { styles: { value: { color: "url(evil)", width: 1, visible: true } } }, { calculate: () => 1 }])
    assert.equal(core.isTechnicalIndicatorInstance({ ...base, ...change }), false);
  assert.equal(core.isTechnicalIndicatorInstance(Object.create(base)), false);
  let invoked = false;
  const getter = { ...base }; Object.defineProperty(getter, "params", { get() { invoked = true; return base.params; } });
  assert.equal(core.isTechnicalIndicatorInstance(getter), false);
  assert.equal(invoked, false);
  assert.throws(() => core.calculateTechnicalIndicator(getter, []), /Invalid/);
  assert.equal(invoked, false);
  assert.throws(() => make("macd", "bad", { params: { signalLength: 0 } }), /Invalid/);
});

test("unsupported breadth item exposes its required data and reason and cannot create empty successful points", () => {
  const definition = core.getTechnicalIndicatorDefinition("advance-decline-line");
  assert.equal(definition.status, "unsupported");
  assert.deepEqual(definition.requiredData, ["market-breadth"]);
  assert.ok(definition.reason.length > 20);
  assert.throws(() => make("advance-decline-line", "breadth"), /OHLCV/);
  assert.throws(() => core.calculateTechnicalIndicator({ ...make("rsi", "r"), definitionId: "advance-decline-line" }, bars([1, 2])), /OHLCV/);
  assert.equal(core.getTechnicalIndicatorDefinition("unknown"), null);
});

test("runtime gap masks retain alignment, source selection is explicit, and timestamp holes do not synthesize bars", () => {
  const input = bars([1, 2, null, 4]); input[3] = { ...input[3], timestamp: input[3].timestamp + 86400000 };
  const result = core.calculateTechnicalIndicator(make("ema", "ema", { params: { length: 3 } }), input);
  series(result.series.value, [1, 1.5, null, 2.75]);
  assert.equal(result.timestamps.length, 4);
  const source = [{ timestamp: 1, open: 4, high: 8, low: 2, close: 6, volume: 100 }];
  for (const [field, expected] of [["open", 4], ["high", 8], ["low", 2], ["close", 6], ["hl2", 5], ["hlc3", 16 / 3], ["ohlc4", 5], ["volume", 100]])
    series(core.calculateTechnicalIndicator(make("sma", "source", { params: { length: 1, source: field } }), source).series.value, [expected]);
});

test("frozen full input is not mutated; replacing latest or historical bars recomputes causally without shared instance state", () => {
  const input = Object.freeze(bars([1, 2, 3, 4, 5]).map(Object.freeze)), instance = Object.freeze(make("macd", "m"));
  const before = JSON.stringify(input), first = core.calculateTechnicalIndicator(instance, input),
    changed = [...input.slice(0, -1), { ...input.at(-1), open: 20, high: 21, low: 19, close: 20 }],
    second = core.calculateTechnicalIndicator(instance, changed);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first.series.macd.slice(0, -1), second.series.macd.slice(0, -1));
  assert.notEqual(first.series.macd.at(-1), second.series.macd.at(-1));
  assert.deepEqual(core.calculateTechnicalIndicator(instance, input), first);
  const historical = input.map((bar, i) => i === 1 ? { ...bar, open: 8, high: 9, low: 7, close: 8 } : bar);
  assert.notEqual(core.calculateTechnicalIndicator(instance, historical).series.macd.at(-1), first.series.macd.at(-1));
});

test("empty/short histories are aligned and invalid bars/series fail before producing NaN or synthetic data", () => {
  for (const definition of core.technicalIndicatorDefinitions) {
    const result = core.calculateTechnicalIndicator(make(definition.id, definition.id), [], { historicalVolatilityPeriodsPerYear: 365 });
    assert.deepEqual(result.timestamps, []);
    assert.ok(Object.values(result.series).every((value) => value.length === 0));
  }
  assert.throws(() => core.ema([1, NaN], 2), /finite/);
  assert.throws(() => core.ema(new Array(2), 2), /finite/);
  assert.equal(core.isTechnicalIndicatorInstanceList(new Array(1)), false);
  assert.throws(() => core.rma([1], 0), /length/);
  const basic = bars([1, 2]);
  for (const changed of [[basic[1], basic[0]], [basic[0], basic[0]], [{ ...basic[0], close: Infinity }],
    [{ ...basic[0], high: -1 }], [{ ...basic[0], volume: -1 }], [{ ...basic[0], timestamp: NaN }]])
    assert.throws(() => core.calculateTechnicalIndicator(make("atr", "a"), changed), RangeError);
});

test("serializable history requirements separate Stoch18 full lookback from5 observations and recursive seed dependence", () => {
  const stochastic = core.calculateTechnicalIndicator(make("stochastic", "s"), []);
  assert.equal(stochastic.warmupBars, 5);
  assert.deepEqual(stochastic.historyRequirement, { kind: "finite", lookbackBars: 18,
    seedPolicy: "window", convergence: "exact-after-lookback" });
  for (const id of ["sma", "bollinger-bands"])
    assert.equal(core.technicalIndicatorHistoryRequirement(make(id, id)).lookbackBars, 20);
  assert.deepEqual(core.rmaHistoryRequirement(14), { kind: "recursive", lookbackBars: null,
    seedBars: 14, seedPolicy: "sma-of-first-length", convergence: "full-input-dependent" });
  for (const [id, policy, seed] of [["ema", "first-non-null", 1], ["macd", "first-value-ema-chain", 1],
    ["rsi", "adjacent-change-wilder", 15], ["atr", "true-range-wilder", 14]]) {
    const requirement = core.technicalIndicatorHistoryRequirement(make(id, id));
    assert.deepEqual(JSON.parse(JSON.stringify(requirement)), { kind: "recursive", lookbackBars: null,
      seedBars: seed, seedPolicy: policy, convergence: "full-input-dependent" });
  }
  // Same right edge/window but a different left seed must not be advertised as exact parity.
  const full = core.calculateTechnicalIndicator(make("ema", "e"), bars([100, 0, 1, 2, 3])),
    cropped = core.calculateTechnicalIndicator(make("ema", "e"), bars([1, 2, 3]));
  assert.notEqual(full.series.value.at(-1), cropped.series.value.at(-1));
});
