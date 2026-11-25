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
const {
  momentum,
  roc,
  cci,
  williamsR,
  mfi,
  obv,
  accumulationDistribution,
  pvt,
  momentumVolumeMetadata,
  momentumVolumePresets
} = load("momentum-volume/index.js");

function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else
      assert.ok(
        Number.isFinite(actual[index]) &&
          Math.abs(actual[index] - value) <= 2e-12 * Math.max(1, Math.abs(value)),
        `index ${index}: ${actual[index]} != ${value}`
      );
  });
}
const bar = (close, volume = 1, high = close, low = close) => ({
  timestamp: 0,
  open: close,
  high,
  low,
  close,
  volume
});
const bars = (prices, volumes = prices.map(() => 1)) =>
  prices.map((price, index) => bar(price, volumes[index]));

test("Momentum and ROC use bar offsets, including missing endpoints and zero bases", () => {
  series(momentum([10, 12, 9, 15], 2), [null, null, -1, 3]);
  series(roc([10, 12, 9, 15], 2), [null, null, -10, 25]);
  series(momentum([1, null, 4, 8], 2), [null, null, 3, null]);
  series(roc([0, 4, 0, -2], 1), [null, null, -100, null]);
  series(roc([-2, -1, 1], 1), [null, -50, -200]);
});

test("CCI hand ledger distinguishes mean absolute deviation from standard deviation", () => {
  // [1,2,6]: mean=3, MAD=2, CCI=(6-3)/(.015*2)=100.
  // [2,6,4]: mean=4, MAD=4/3, current equals mean.
  series(cci([1, 2, 6, 4, 8], 3), [null, null, 100, 0, 100]);
  series(cci([1, null, 2, 6, null, 4], 3), [null, null, null, 100, null, 0]);
  series(cci([7, 7, 7], 2), [null, null, null]);
  series(cci([1, 2], 1), [null, null]);
  series(cci([1e12 + 1, 1e12 + 2, 1e12 + 6], 3), [null, null, 100]);
  series(cci([-1e308, 0, 1e308], 3), [null, null, 100]);
});

test("Williams ledger uses high/low extremes, custom source and complete positional windows", () => {
  const input = [bar(8, 1, 10, 4), bar(6, 1, 9, 3), bar(11, 1, 12, 5), bar(7, 1, 8, 2)];
  series(williamsR(input, 3), [null, null, -100 / 9, -50]);
  series(williamsR(input, 3, [5, 5, 3, 12]), [null, null, -100, 0]);
  series(williamsR([bar(1), bar(1), bar(1)], 2), [null, null, null]);
  const gap = [bar(1, 1, 3, 0), bar(2, 1, null, 1), bar(3, 1, 4, 2), bar(4, 1, 5, 3)];
  series(williamsR(gap, 2), [null, null, null, -100 / 3]);
  series(williamsR([bar(0, 1, 1e308, -1e308)], 1), [-50]);
});

test("MFI independent raw-money ledger includes ties and zero volume", () => {
  // price [10,12,9,9,15], volume [5,7,4,8,2], signed flows [+84,-36,0,+30].
  series(mfi(bars([10, 12, 9, 9, 15], [5, 7, 4, 8, 2]), 2), [null, null, 70, 0, 100]);
  series(mfi(bars([3, 2, 1]), 1), [null, 0, 0]);
  series(mfi(bars([1, 2, 3]), 1), [null, 100, 100]);
  series(mfi(bars([1, 1, 1]), 2), [null, null, null]);
  series(mfi(bars([1, 2, 3], [1, 0, 0]), 2), [null, null, null]);
  const typical = [bar(8, 1, 14, 8), bar(8, 2, 20, 8), bar(11, 1, 11, 11)];
  // HLC3 [10,12,11], flows +24,-11 => 2400/35.
  series(mfi(typical, 2), [null, null, 2400 / 35]);
});

test("OBV, ADL and PVT hand ledgers use different volume contributions", () => {
  const input = bars([10, 12, 9, 9], [5, 7, 4, 8]);
  series(obv(input), [null, 7, 3, 3]);
  series(pvt(input), [null, 1.4, 0.4, 0.4]);
  // Multiplier [+1,-1,0,+1/2], cumulative [4,-2,-2,3].
  series(
    accumulationDistribution([
      bar(10, 4, 10, 0),
      bar(0, 6, 10, 0),
      bar(5, 8, 10, 0),
      bar(7.5, 10, 10, 0)
    ]),
    [4, -2, -2, 3]
  );
  series(accumulationDistribution([bar(5, 10), bar(6, null), bar(7, 0)]), [0, null, 0]);
  series(pvt(bars([0, 1, 2])), [null, null, 1]);
});

test("Missing volume creates actual gaps; cumulative resumption preserves known contributions only", () => {
  const input = bars([10, 12, 9, 18, 9], [5, 7, null, 2, 1]);
  series(obv(input), [null, 7, null, 9, 8]);
  series(pvt(input), [null, 1.4, null, 3.4, 2.9]);
  series(mfi(input, 2), [null, null, null, null, 80]);
  series(obv(bars([1, null, 2, 3])), [null, null, null, 1]);
  for (const fn of [obv, pvt, accumulationDistribution])
    series(fn(bars([1, 2, 3], [null, null, null])), [null, null, null]);
});

test("Every function is pure, causal, aligned and accepts empty/frozen inputs", () => {
  const source = Object.freeze([1, 2, 3, 4, 5]);
  const input = Object.freeze(bars(source).map(Object.freeze));
  for (const fn of [momentum, roc, cci]) {
    const before = [...source];
    fn(source, 2);
    assert.deepEqual(source, before);
    assert.deepEqual(fn(source, 2).slice(0, 3), fn(source.slice(0, 3), 2));
    assert.deepEqual(fn([], 2), []);
  }
  for (const fn of [williamsR, mfi, obv, pvt, accumulationDistribution]) {
    const before = structuredClone(input);
    fn(input, 2);
    assert.deepEqual(input, before);
    assert.deepEqual(fn(input, 2).slice(0, 3), fn(input.slice(0, 3), 2));
    assert.deepEqual(fn([], 2), []);
  }
});

test("Invalid periods, nonfinite values, holes, misalignment and negative volumes are rejected", () => {
  for (const period of [0, -1, 1.5, 10001, NaN, Infinity])
    for (const fn of [momentum, roc, cci, williamsR, mfi])
      assert.throws(() => fn([], period), RangeError);
  assert.throws(() => mfi([], 2001), RangeError);
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    for (const fn of [momentum, roc, cci]) assert.throws(() => fn([bad], 1), RangeError);
    for (const fn of [mfi, obv, pvt, accumulationDistribution])
      assert.throws(() => fn([{ ...bar(1), volume: bad }], 1), RangeError);
  }
  for (const fn of [mfi, obv, pvt, accumulationDistribution]) {
    assert.throws(() => fn([bar(1, -1)], 1), RangeError);
    assert.throws(() => fn(new Array(2), 1), RangeError);
  }
  assert.throws(() => williamsR([bar(1)], 1, []), RangeError);
  assert.throws(() => williamsR([undefined], 1), RangeError);
  assert.throws(() => williamsR([bar(1, 1, 0, 2)], 1), RangeError);
  assert.throws(() => cci(new Array(3), 1), RangeError);
});

test("Overflow is deterministic, finite windows recover, cumulative accumulator overflow stays unknown", () => {
  series(momentum([-1e308, 1e308], 1), [null, null]);
  series(roc([-1e308, 1e308], 1), [null, -200]);
  const input = bars([1, 2, 3, 2, 1], [1, 1e308, 1e308, 1, 1]);
  series(obv(input), [null, 1e308, null, null, null]);
  // Overflowing raw money flow leaves the two-bar window after two finite flows.
  series(mfi(bars([1, 2, 3, 2, 1], [1, 1e308, 1, 1, 1]), 2), [null, null, null, 60, 0]);
  for (const fn of [mfi, obv, pvt, accumulationDistribution])
    assert.ok(fn(input, 2).every((value) => value === null || Number.isFinite(value)));
});

test("Verified presets are deeply immutable and history describes actual warmup and cumulative seed", () => {
  const lengths = {
    momentum: 10,
    roc: 9,
    cci: 20,
    "williams-r": 14,
    mfi: 14,
    obv: null,
    adl: null,
    pvt: null
  };
  assert.ok(Object.isFrozen(momentumVolumePresets));
  assert.equal(momentumVolumePresets.length, 8);
  for (const item of momentumVolumePresets) {
    assert.equal(item.defaultLength, lengths[item.id]);
    assert.equal(item.defaultPane, "pane");
    assert.equal(item.status, "math-only");
    assert.ok(Object.isFrozen(item));
    assert.ok(item.reference.startsWith("https://pine-facade.tradingview.com/"));
    const info = momentumVolumeMetadata(item.id);
    assert.ok(Object.isFrozen(info));
    assert.ok(Object.isFrozen(info.historyRequirement));
  }
  assert.equal(momentumVolumePresets.find((item) => item.id === "cci").defaultSource, "hlc3");
  assert.equal(momentumVolumePresets.find((item) => item.id === "mfi").maxLength, 2000);
  assert.equal(momentumVolumeMetadata("momentum", 3).warmupBars, 4);
  assert.equal(momentumVolumeMetadata("cci", 3).warmupBars, 3);
  assert.equal(momentumVolumeMetadata("mfi", 3).warmupBars, 4);
  assert.deepEqual(momentumVolumeMetadata("obv").historyRequirement, {
    kind: "cumulative",
    lookbackBars: null,
    seedBars: 2,
    seedPolicy: "zero-before-first-contribution",
    missingPolicy: "gap-preserve-known-total",
    convergence: "full-input-dependent"
  });
  assert.equal(momentumVolumeMetadata("adl").warmupBars, 1);
  assert.throws(() => momentumVolumeMetadata("obv", 14), RangeError);
  assert.throws(() => momentumVolumeMetadata("unknown"), RangeError);
  assert.throws(() => momentumVolumeMetadata("mfi", 2001), RangeError);
});

test("Default function periods agree with verified presets and produce genuine warmup gaps", () => {
  const ramp = Array.from({ length: 22 }, (_, index) => index + 1);
  assert.deepEqual(momentum(ramp).slice(0, 10), new Array(10).fill(null));
  assert.equal(momentum(ramp)[10], 10);
  assert.equal(roc(ramp)[9], 900);
  assert.deepEqual(cci(ramp).slice(0, 19), new Array(19).fill(null));
  series([cci(ramp)[19]], [380 / 3]);
  assert.equal(mfi(bars(ramp))[13], null);
  assert.equal(mfi(bars(ramp))[14], 100);
  assert.equal(williamsR(bars(ramp))[12], null);
  assert.equal(williamsR(bars(ramp))[13], 0);
});

test("Rolling windows recover small contributions when a dominant old flow exits", () => {
  // At index 4, flows 0,+3,-2 give positive=3, negative=2 => 60.
  const input = bars([1, 2, 2, 3, 2], [1, 5e307, 1, 1, 1]);
  series(mfi(input, 3), [null, null, null, 100, 60]);
  const mixed = bars([1, 2, 3, 4, 2], [1, 5e307, 1, 1, 1]);
  series(mfi(mixed, 3), [null, null, null, 100, 700 / 9]);
});

test("Large ordinary windows preserve endpoint formulas without quadratic extrema scans", () => {
  const count = 100000;
  const input = Array.from({ length: count }, (_, index) =>
    bar(index + 100, 1, index + 102, index + 98)
  );
  const range = williamsR(input, 10000),
    flow = mfi(input, 2000);
  series([range[9999], range.at(-1)], [-200 / 10003, -200 / 10003]);
  assert.equal(flow[1999], null);
  series([flow[2000], flow.at(-1)], [100, 100]);
  assert.equal(range.length, count);
  assert.equal(flow.length, count);
});
