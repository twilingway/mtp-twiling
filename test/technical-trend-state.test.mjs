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
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${source}\n})`, {
    filename: file
  }).runInThisContext()(
    (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
    module,
    module.exports
  );
  return module.exports;
}
const api = load("trend-state/index.js");
const {
  supertrend,
  parabolicSar,
  tsi,
  kst,
  fisherTransform,
  trendStateMetadata,
  trendStatePresets,
  dpoResearch
} = api;
const candle = (high, low, close = high / 2 + low / 2, timestamp = 1) => ({
  timestamp,
  high,
  low,
  close,
  open: close,
  volume: null
});
const bars = (rows) =>
  rows.map(([high, low, close], i) => candle(high, low, close, 1000 + 60000 * i));
const closes = (values) => values.map((v, i) => candle(v, v, v, 1000 + 60000 * i));
const gap = () => candle(null, null, null);
const ledger = () =>
  bars([
    [10, 8, 9],
    [12, 10, 11],
    [14, 12, 13],
    [15, 13, 14],
    [14, 11, 12],
    [12, 9, 10],
    [13, 10, 12]
  ]);
function series(actual, expected, tolerance = 2e-12) {
  assert.equal(actual.length, expected.length);
  expected.forEach((v, i) => {
    if (v === null) assert.equal(actual[i], null, `index ${i}`);
    else
      assert.ok(
        typeof actual[i] === "number" &&
          Number.isFinite(actual[i]) &&
          Math.abs(actual[i] - v) <= tolerance * Math.max(1, Math.abs(v)),
        `index ${i}: ${actual[i]} != ${v}`
      );
  });
}
const outputs = (value) => (Array.isArray(value) ? { value } : value);
const calls = [
  (b) => supertrend(b, 2, 1),
  (b) => parabolicSar(b, 0.2, 0.2, 0.4),
  (b) => tsi(b, 3, 3, 3),
  (b) => kst(b, { rocLengths: [1, 2, 3, 4], smaLengths: [1, 2, 1, 2], signalLength: 2 }),
  (b) => fisherTransform(b, 3)
];

test("SAR hand ledger: projection, two prior lows/highs, two reversals and AF cap", () => {
  // EP/AF after bars1..6: 12/.2,14/.4,15/.4,11/.2,9/.4,13/.2.
  // Bar3 projection10.4 clamps to two-back low10; bar4 reversal uses old EP15.
  series(parabolicSar(ledger(), 0.2, 0.2, 0.4), [null, 8, 8, 10, 15, 15, 9]);
});
test("SAR tie close seeds above, immediate reversal and start greater than maximum are explicit", () => {
  series(
    parabolicSar(
      bars([
        [10, 8, 9],
        [9, 7, 9]
      ]),
      0.2,
      0.2,
      0.4
    ),
    [null, 10]
  );
  series(
    parabolicSar(
      bars([
        [10, 8, 9],
        [12, 7, 11]
      ]),
      0.2,
      0.2,
      0.4
    ),
    [null, 12]
  );
  // Start .8 remains above max .2 until the first strict EP extension, which clamps AF.
  series(
    parabolicSar(
      bars([
        [10, 8, 9],
        [12, 11.5, 11.5],
        [14, 12, 13],
        [15, 13, 14]
      ]),
      0.8,
      0.2,
      0.2
    ),
    [null, 8, 8, 9.2]
  );
  series(parabolicSar(ledger().slice(0, 4), 0, 0, 0), [null, 8, 8, 8]);
});
test("Supertrend hand ATR/band ledger and split direction outputs", () => {
  // TR=2,3,3,2,3,3,3; Wilder2=na,2.5,2.75,2.375,2.6875,2.84375,2.921875.
  const result = supertrend(ledger(), 2, 1);
  series(result.value, [null, 13.5, 13.5, 11.625, 11.625, 13.34375, 13.34375]);
  series(result.direction, [1, 1, 1, -1, -1, 1, 1]);
  series(result.upTrend, [null, null, null, 11.625, 11.625, null, null]);
  series(result.downTrend, [null, 13.5, 13.5, null, null, 13.34375, 13.34375]);
  series(result.bodyMiddle, [null, 11, 13, 14, 12, 10, 12]);
});
test("Supertrend length1 hides first value but retains reference direction and strict crossing", () => {
  const source = bars([
    [10, 8, 9],
    [12, 10, 11],
    [14, 12, 13],
    [15, 13, 14],
    [17, 15, 16]
  ]);
  // Initial previous-band nz=0; upper becomes14 on bar1. Bar3 close14 equals upper -> still down.
  const result = supertrend(source, 1, 1);
  series(result.value, [null, 14, 14, 14, 13]);
  series(result.direction, [1, 1, 1, 1, -1]);
  assert.equal(supertrend(closes([0, 0, 0]), 1).value[1], 0);
});
test("Stateful unknown HLC resets segment and redoes contiguous seed", () => {
  const first = ledger().slice(0, 3),
    second = ledger().slice(0, 3);
  const input = [...first, gap(), ...second];
  series(parabolicSar(input, 0.2, 0.2, 0.4), [null, 8, 8, null, null, 8, 8]);
  const result = supertrend(input, 2, 1);
  series(result.value, [null, 13.5, 13.5, null, null, 13.5, 13.5]);
  series(result.direction, [1, 1, 1, null, 1, 1, 1]);
  const lengthOne = supertrend(input, 1, 1).value;
  assert.equal(
    lengthOne[4],
    null,
    "first new-segment bar stays hidden even when ATR length1 is known"
  );
  series(lengthOne.slice(4), supertrend(second, 1, 1).value);
});
test("TSI independent double EMA ledger and signal use first change seed", () => {
  // Changes2,-1,3; double EMA numerators2,5/4,3/2; denominators2,7/4,2.
  const result = tsi(closes([10, 12, 11, 14]), 3, 3, 3);
  series(result.value, [null, 100, 500 / 7, 75]);
  series(result.signal, [null, 100, 600 / 7, 1125 / 14]);
  series(tsi(closes([10, 12, 11, 14]), 1, 1, 1).value, [null, 100, -100, 100]);
});
test("KST independent percent ROC and weights, signal SMA and default warmup", () => {
  const options = { rocLengths: [1, 1, 1, 1], smaLengths: [1, 1, 1, 1], signalLength: 2 };
  const result = kst(closes([1, 2, 4, 2]), options);
  series(result.value, [null, 1000, 1000, -500]);
  series(result.signal, [null, null, 1000, 250]);
  const distinct = kst(closes([1, 2, 4, 8, 16]), {
    rocLengths: [1, 2, 3, 4],
    smaLengths: [1, 1, 1, 1],
    signalLength: 1
  });
  series(distinct.value, [null, null, null, null, 8800]);
  const defaults = kst(closes(Array.from({ length: 60 }, (_, i) => 2 ** i)));
  assert.equal(
    defaults.value.findIndex((v) => v !== null),
    44
  );
  assert.equal(
    defaults.signal.findIndex((v) => v !== null),
    52
  );
  series(defaults.value.slice(44), Array(16).fill(429817957400));
});
test("Fisher hand log ledger uses hl2 partial extrema and one-bar trigger", () => {
  // hl2=1,2,3 -> normalized na,.33,.5511. First Fisher .5 ln(133/67).
  const a = 0.5 * Math.log(133 / 67),
    b = 0.5 * Math.log(15511 / 4489) + 0.5 * a;
  const result = fisherTransform(closes([1, 2, 3]), 9);
  series(result.value, [null, a, b]);
  series(result.trigger, [null, null, a]);
  // HLC close does not drive Fisher; hl2 alone does.
  const varied = bars([
    [2, 0, 0],
    [3, 1, 1],
    [4, 2, 4]
  ]);
  series(fisherTransform(varied, 9).value, result.value);
});
test("Fisher clamp saturates to .999 and decay yields bounded recurrence", () => {
  const result = fisherTransform(closes(Array.from({ length: 100 }, (_, i) => i)), 9);
  // Monotonic normalization 1-.67^n first exceeds .99 at bar12.
  // At a long endpoint, Fisher tends to ln(1999), from .5ln(1999)+.5previous.
  assert.ok(Math.abs(result.value.at(-1) - Math.log(1999)) < 1e-12);
  assert.ok(result.value.every((v) => v === null || (v >= 0 && v <= Math.log(1999))));
  const reflected = fisherTransform(closes(Array.from({ length: 100 }, (_, i) => -i)), 9);
  series(
    reflected.value,
    result.value.map((v) => (v === null ? null : -v))
  );
});
test("Flat denominators stay null, true zero oscillator is preserved, Fisher length1 undefined", () => {
  const flat = closes(Array(60).fill(10));
  assert.ok(tsi(flat).value.every((v) => v === null));
  assert.ok(fisherTransform(flat).value.every((v) => v === null));
  assert.ok(fisherTransform(ledger(), 1).value.every((v) => v === null));
  assert.equal(trendStateMetadata("fisher-transform", { length: 1 }).alwaysUndefined, true);
  assert.equal(trendStateMetadata("fisher-transform", { length: 1 }).warmupBars, null);
  assert.equal(kst(flat).value[44], 0);
  const zero = closes(Array(60).fill(0));
  assert.ok(kst(zero).value.every((v) => v === null));
});
test("TSI/KST gaps mask current output and Fisher carries only its explicit delayed plot", () => {
  const source = closes([1, 2, null, 4, 8]);
  series(tsi(source, 1, 1, 1).value, [null, 100, null, null, 100]);
  series(
    kst(source, { rocLengths: [1, 1, 1, 1], smaLengths: [1, 1, 1, 1], signalLength: 1 }).value,
    [null, 1000, null, null, 1000]
  );
  const fisher = fisherTransform(source, 3),
    a = 0.5 * Math.log(133 / 67);
  series(fisher.value, [null, a, null, a, 0.5 * Math.log(15511 / 4489) + 0.5 * a]);
  series(fisher.trigger, [null, null, a, null, a]);
});
test("All functions preserve frozen inputs, timestamp positions and every prefix", () => {
  const input = Object.freeze(ledger().map((b) => Object.freeze(b)));
  const before = JSON.stringify(input);
  for (const call of calls) {
    const result = outputs(call(input));
    for (let n = 0; n <= input.length; n++) {
      const prefix = outputs(call(input.slice(0, n)));
      for (const key of Object.keys(result)) series(prefix[key], result[key].slice(0, n));
    }
    const alternate = input.map((b, i) => ({ ...b, timestamp: 900000 - i * 77 }));
    assert.deepEqual(call(alternate), call(input));
  }
  assert.equal(JSON.stringify(input), before);
});
test("Dense scale invariants and negative-price translation do not alter oscillator definitions", () => {
  const input = ledger(),
    scaled = input.map((b) => ({
      ...b,
      open: b.open * 3,
      high: b.high * 3,
      low: b.low * 3,
      close: b.close * 3
    }));
  for (const call of [(b) => parabolicSar(b, 0.2, 0.2, 0.4), (b) => supertrend(b, 2, 1).value])
    series(
      call(scaled),
      call(input).map((v) => (v === null ? null : v * 3))
    );
  for (const call of [
    (b) => tsi(b, 3, 3, 3).value,
    (b) => kst(b, { rocLengths: [1, 1, 1, 1], smaLengths: [1, 1, 1, 1], signalLength: 1 }).value,
    (b) => fisherTransform(b, 3).value
  ])
    series(call(scaled), call(input));
  const translated = input.map((b) => ({
    ...b,
    open: b.open - 100,
    high: b.high - 100,
    low: b.low - 100,
    close: b.close - 100
  }));
  series(tsi(translated, 3, 3, 3).value, tsi(input, 3, 3, 3).value);
  series(fisherTransform(translated, 3).value, fisherTransform(input, 3).value);
  series(
    parabolicSar(translated, 0.2, 0.2, 0.4),
    parabolicSar(input, 0.2, 0.2, 0.4).map((v) => (v === null ? null : v - 100))
  );
});
test("Invalid consumed fields, sparse arrays, inconsistent ranges and resource cap reject", () => {
  for (const call of calls) {
    assert.throws(() => call([undefined]), RangeError);
    assert.throws(() => call(new Array(2)), RangeError);
    assert.throws(() => call(new Array(1_000_001)), RangeError);
    const field = call === calls[2] || call === calls[3] ? "close" : "high";
    for (const bad of [undefined, NaN, Infinity, "1"])
      assert.throws(() => call([{ ...ledger()[0], [field]: bad }]), RangeError);
  }
  for (const call of [calls[0], calls[1], calls[4]])
    assert.throws(() => call([candle(1, 2, 1)]), RangeError);
  for (const call of [calls[0], calls[1]]) assert.throws(() => call([candle(2, 1, 3)]), RangeError);
});
test("Unconsumed prices/volume/timestamps do not become fabricated data requirements", () => {
  const source = ledger();
  series(
    tsi(
      source.map((b) => ({
        ...b,
        high: undefined,
        low: undefined,
        volume: Infinity,
        timestamp: NaN
      }))
    ).value,
    tsi(source).value
  );
  series(
    fisherTransform(source.map((b) => ({ ...b, close: undefined, open: undefined }))).value,
    fisherTransform(source).value
  );
  series(parabolicSar(source.map((b) => ({ ...b, open: undefined }))), parabolicSar(source));
  const result = supertrend(
    source.map((b) => ({ ...b, open: null })),
    2,
    1
  );
  assert.ok(result.bodyMiddle.every((v) => v === null));
  series(result.value, supertrend(source, 2, 1).value);
});
test("Strict period/factor/AF/options bounds and metadata reject invalid inputs", () => {
  for (const bad of [0, -1, 1.5, 10001, NaN, Infinity, null]) {
    assert.throws(() => supertrend([], bad), RangeError);
    assert.throws(() => tsi([], bad), RangeError);
    assert.throws(() => fisherTransform([], bad), RangeError);
    assert.throws(() => kst([], { signalLength: bad }), RangeError);
    assert.throws(() => trendStateMetadata("tsi", { longLength: bad }), RangeError);
  }
  for (const bad of [0, 0.001, 1_000_001, Infinity])
    assert.throws(() => supertrend([], 1, bad), RangeError);
  for (const bad of [-0.1, 1.1, Infinity, null])
    assert.throws(() => parabolicSar([], bad), RangeError);
  for (const options of [
    { unknown: 1 },
    { rocLengths: [1, 2, 3] },
    { smaLengths: [1, , 2, 3] },
    null
  ])
    assert.throws(() => kst([], options), RangeError);
  assert.throws(() => trendStateMetadata("dpo"), RangeError);
  assert.throws(() => trendStateMetadata("tsi", { length: 2 }), RangeError);
});
test("Finite extremes yield null overflow, recover without poison and never emit NaN/Infinity", () => {
  const input = closes([1e308, -1e308, 1, 2, 3, 4]);
  for (const call of calls)
    for (const output of Object.values(outputs(call(input))))
      assert.ok(output.every((v) => v === null || Number.isFinite(v)));
  assert.equal(tsi(input, 1, 1, 1).value[1], null);
  assert.equal(parabolicSar(input)[1], null);
  assert.equal(supertrend(input, 1, 1).value[1], null);
  assert.equal(parabolicSar(input)[2], null);
  assert.ok(Number.isFinite(parabolicSar(input)[3]));
  assert.ok(Number.isFinite(supertrend(input, 1, 1).value[3]));
  const mixed = bars([
    [1e308, -1e308, 0],
    [2, 1, 1],
    [3, 2, 2],
    [4, 3, 3]
  ]);
  assert.equal(supertrend(mixed, 2, 1).value[0], null);
  assert.ok(Number.isFinite(supertrend(mixed, 2, 1).value[2]));
  assert.ok(fisherTransform(closes([-1e308, 1e308]), 2).value.every((v) => v === null));
  series(
    kst(closes([1e-308, 1, 2]), {
      rocLengths: [1, 1, 1, 1],
      smaLengths: [1, 1, 1, 1],
      signalLength: 1
    }).value,
    [null, null, 1000]
  );
});
test("Metadata defaults, exact IDs/hashes/history and explicit DPO unresolved are immutable", () => {
  assert.equal(trendStatePresets.length, 5);
  assert.deepEqual(
    trendStatePresets.map((p) => p.publicId),
    [
      "STD;Supertrend",
      "STD;PSAR",
      "STD;True%1Strength%1Indicator",
      "STD;Know_Sure_Thing",
      "STD;Fisher_Transform"
    ]
  );
  for (const p of trendStatePresets) {
    assert.equal(p.status, "math-only");
    assert.match(p.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(p.defaults));
    assert.ok(Object.isFrozen(p.outputs));
    assert.deepEqual(p.omittedNumericOutputs, []);
  }
  assert.equal(trendStateMetadata("supertrend").warmupBars, 10);
  assert.equal(trendStateMetadata("tsi").warmupBars, 2);
  assert.equal(trendStateMetadata("kst").historyRequirement.lookbackBars, 53);
  assert.equal(trendStateMetadata("kst").outputWarmup.value, 45);
  for (const id of ["supertrend", "parabolic-sar", "tsi", "fisher-transform"])
    assert.equal(trendStateMetadata(id).historyRequirement.convergence, "full-input-dependent");
  assert.equal(dpoResearch.status, "unresolved");
  assert.equal(dpoResearch.defaults.length, 21);
  assert.equal(api.dpo, undefined);
  assert.throws(() => {
    dpoResearch.defaults.centered = true;
  }, TypeError);
  for (const fn of [supertrend, parabolicSar, tsi, kst, fisherTransform])
    assert.ok(Object.values(outputs(fn([]))).every((line) => line.length === 0));
});
test("Large positional extrema and resource-bounded windows retain independent closed-form endpoint", () => {
  const source = closes(Array.from({ length: 100000 }, (_, i) => i + 1));
  const result = fisherTransform(source, 10000);
  assert.equal(result.value[0], null);
  assert.ok(Math.abs(result.value.at(-1) - Math.log(1999)) < 1e-12);
  const strength = tsi(source, 10000, 10000, 10000);
  assert.equal(strength.value[1], 100);
  assert.equal(strength.value.at(-1), 100);
  const window = kst(source, {
    rocLengths: [1, 1, 1, 1],
    smaLengths: [10000, 10000, 10000, 10000],
    signalLength: 1
  });
  assert.equal(
    window.value.findIndex((v) => v !== null),
    10000
  );
  // Last10000 previous prices span90000..99999; weighted mean ROC lies strictly between endpoints.
  assert.ok(window.value.at(-1) > 1000 / 99999 && window.value.at(-1) < 1000 / 90000);
});
