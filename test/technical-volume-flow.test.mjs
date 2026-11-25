import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Source-only loader: no build, server, API or version artifact is needed.
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
  cmf,
  chaikinOscillator,
  elderForceIndex,
  easeOfMovement,
  volumeOscillator,
  negativeVolumeIndex,
  positiveVolumeIndex,
  volumeFlowPresets,
  volumeFlowMetadata
} = load("volume-flow/index.js");
const bar = (close, volume = 1, high = close, low = close, timestamp = 1710000000000) => ({
  timestamp,
  open: close,
  high,
  low,
  close,
  volume
});
const bars = (prices, volumes) => prices.map((price, i) => bar(price, volumes ? volumes[i] : 1));
function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else
      assert.ok(
        Number.isFinite(actual[index]) &&
          Math.abs(actual[index] - value) <= 3e-12 * Math.max(1, Math.abs(value)),
        `index ${index}: ${actual[index]} != ${value}`
      );
  });
}
const results = (value) => (Array.isArray(value) ? [value] : Object.values(value));
const functions = [
  cmf,
  chaikinOscillator,
  elderForceIndex,
  easeOfMovement,
  volumeOscillator,
  negativeVolumeIndex,
  positiveVolumeIndex
];

test("CMF and Chaikin independent multiplier/ADL/EMA ledger", () => {
  // MFV [4,-6,0,5], ADL [4,-2,-2,3].
  const input = [bar(10, 4, 10, 0), bar(0, 6, 10, 0), bar(5, 8, 10, 0), bar(7.5, 10, 10, 0)];
  series(cmf(input, 2), [null, -1 / 5, -3 / 7, 5 / 18]);
  // EMA2 [4,0,-4/3,14/9], EMA3 [4,1,-1/2,5/4].
  series(chaikinOscillator(input, 2, 3), [0, -1, -5 / 6, 11 / 36]);
  series(chaikinOscillator(input, 3, 2), [0, 1, 5 / 6, -11 / 36]);
  series(chaikinOscillator(input, 2, 2), [0, 0, 0, 0]);
});

test("EFI uses adjacent close differences and first-valid EMA, not SMA seeding", () => {
  // Raw [na,14,-12,0,12], EMA alpha=2/3.
  series(elderForceIndex(bars([10, 12, 9, 9, 15], [5, 7, 4, 8, 2]), 2), [
    null,
    14,
    -10 / 3,
    -10 / 9,
    206 / 27
  ]);
  series(elderForceIndex(bars([0, 2, 0], [3, 4, 5]), 1), [null, 8, -10]);
});

test("EOM uses midpoint change, current range and configurable divisor before SMA", () => {
  // HL2 [10,12,11,13]; raw divisor10 [na,4,-4,8].
  const input = [bar(10, 10, 12, 8), bar(12, 20, 14, 10), bar(11, 10, 13, 9), bar(13, 15, 16, 10)];
  series(easeOfMovement(input, 2, 10), [null, null, 0, 2]);
  series(easeOfMovement(input, 1, 10), [null, 4, -4, 8]);
  series(easeOfMovement(input, 2, 100), [null, null, 0, 20]);
});

test("Current Volume Oscillator is three-output PVO: independent rational EMA ledger", () => {
  // Fast2 [10,50/3,110/9,650/27], slow3 [10,15,25/2,85/4].
  const output = volumeOscillator(bars([1, 1, 1, 1], [10, 20, 10, 30]), {
    fastLength: 2,
    slowLength: 3,
    signalLength: 2
  });
  series(output.oscillator, [0, 100 / 9, -20 / 9, 6100 / 459]);
  series(output.signal, [0, 200 / 27, 80 / 81, 37960 / 4131]);
  series(output.histogram, [0, 100 / 27, -260 / 81, 16940 / 4131]);
});

test("PVO selectable averages and staged warmup include all numeric lines", () => {
  const input = bars([1, 1, 1, 1], [10, 20, 10, 30]);
  const options = {
    fastLength: 1,
    slowLength: 2,
    signalLength: 2,
    oscillatorAverage: "SMA",
    signalAverage: "SMA"
  };
  const output = volumeOscillator(input, options);
  series(output.oscillator, [null, 100 / 3, -100 / 3, 50]);
  series(output.signal, [null, null, 0, 25 / 3]);
  series(output.histogram, [null, null, -100 / 3, 125 / 3]);
  const mixed = volumeOscillator(input, { ...options, signalAverage: "EMA" });
  series(mixed.signal, [null, 100 / 3, -100 / 9, 800 / 27]);
  const reverse = volumeOscillator(input, { ...options, oscillatorAverage: "EMA" });
  assert.equal(reverse.signal[0], null);
  assert.ok(Number.isFinite(reverse.signal[1]));
});

test("NVI/PVI displayed seed1000 and mandatory EMA are distinct ledgers", () => {
  const input = bars([10, 12, 9, 18, 9], [10, 20, 10, 10, 5]);
  const nvi = negativeVolumeIndex(input, 2),
    pvi = positiveVolumeIndex(input, 2);
  series(nvi.index, [1000, 1000, 750, 750, 375]);
  series(nvi.average, [1000, 1000, 2500 / 3, 7000 / 9, 13750 / 27]);
  series(pvi.index, [1000, 1200, 1200, 1200, 1200]);
  series(pvi.average, [1000, 3400 / 3, 10600 / 9, 32200 / 27, 97000 / 81]);
  series(positiveVolumeIndex(input, 1).average, pvi.index);
});

test("NVI/PVI follow Pine nz zero-close and missing-volume branch behavior", () => {
  series(positiveVolumeIndex(bars([10, 0, 20, 40], [1, 2, 3, 4])).index, [1000, 1000, 1000, 2000]);
  series(
    positiveVolumeIndex(bars([10, null, 20, 40], [1, 2, 3, 4])).index,
    [1000, 1000, 1000, 2000]
  );
  const sparse = [bar(10, 10), bar(12, null), bar(24, 20), bar(48, 0)];
  series(positiveVolumeIndex(sparse).index, [1000, 1000, 2000, 2000]);
  series(negativeVolumeIndex(sparse).index, [1000, 1000, 1000, 2000]);
  // Cancellation rounds the internal state to zero; the reference resets it to1 next bar.
  series(positiveVolumeIndex(bars([1e308, 1, 2], [1, 2, 3])).index, [1000, 0, 2000]);
  series(negativeVolumeIndex([bar(null, null), bar(null, null)]).index, [1000, 1000]);
});

test("Zero range, zero volume and na-skipping smoothing remain explicit", () => {
  series(cmf([bar(4, 10), bar(5, 0), bar(6, 0)], 1), [0, null, null]);
  series(cmf([bar(null, null, 1, 1), bar(2, 2, 3, 1)], 1), [null, 0]);
  const flow = [bar(2, 2, 2, 0), bar(1, null, 2, 0), bar(0, 2, 2, 0)];
  series(cmf(flow, 2), [null, null, 0]);
  series(chaikinOscillator(flow, 1, 2), [0, 0, -2 / 3]);
  series(elderForceIndex([bar(1), bar(3), bar(null), bar(10), bar(11)], 2), [null, 2, 2, 2, 4 / 3]);
  // Raw EOM [na,na,4,0,na,4], SMA2 ignores invalid raw observations.
  const eom = [
    bar(1, 1, 2, 0),
    bar(3, 0, 4, 2),
    bar(5, 1, 6, 4),
    bar(5, 1, 5, 5),
    bar(8, null, 9, 7),
    bar(10, 1, 11, 9)
  ];
  series(easeOfMovement(eom, 2, 1), [null, null, null, 2, 2, 2]);
  const zero = volumeOscillator(bars([1, 2, 3], [0, 0, 0]));
  for (const output of Object.values(zero)) series(output, [null, null, null]);
});

test("No mutation, timestamp ownership, empty input and causal prefixes for all outputs", () => {
  const input = Object.freeze(
    Array.from({ length: 40 }, (_, i) =>
      Object.freeze(bar(10 + (i % 7), i % 6, 18 + (i % 7), 2 + (i % 7), 1710000000123 + i * 71999))
    )
  );
  const before = JSON.stringify(input);
  for (const fn of functions) {
    for (const output of results(fn([]))) assert.deepEqual(output, []);
    const full = results(fn(input));
    for (const output of full) {
      assert.equal(output.length, input.length);
      assert.ok(output.every((value) => value === null || Number.isFinite(value)));
    }
    for (const end of [1, 7, 19, 39]) {
      results(fn(input.slice(0, end))).forEach((output, i) =>
        series(output, full[i].slice(0, end))
      );
    }
  }
  assert.equal(JSON.stringify(input), before);
});

test("Consumed malformed input and out-of-bound parameters fail without mutation", () => {
  for (const fn of functions) {
    assert.throws(() => fn([bar(1, NaN)]), RangeError);
    assert.throws(() => fn([bar(1, Infinity)]), RangeError);
    assert.throws(() => fn([bar(1, -1)]), RangeError);
    assert.throws(() => fn(new Array(1)), RangeError);
  }
  for (const fn of [
    cmf,
    chaikinOscillator,
    elderForceIndex,
    negativeVolumeIndex,
    positiveVolumeIndex
  ])
    assert.throws(() => fn([bar(NaN)]), RangeError);
  for (const fn of [cmf, chaikinOscillator, easeOfMovement])
    assert.throws(() => fn([bar(1, 2, 0, 2)]), RangeError);
  for (const value of [0, -1, 1.1, NaN, Infinity, 10001]) {
    for (const fn of [
      cmf,
      chaikinOscillator,
      elderForceIndex,
      easeOfMovement,
      negativeVolumeIndex,
      positiveVolumeIndex
    ])
      assert.throws(() => fn([], value), RangeError);
    assert.throws(() => volumeOscillator([], { signalLength: value }), RangeError);
  }
  assert.throws(() => easeOfMovement([], 14, 1000000001), RangeError);
  assert.throws(() => volumeOscillator([], { oscillatorAverage: "WMA" }), RangeError);
  // Volume-only consumes no price or timestamp fields.
  assert.doesNotThrow(() => volumeOscillator([bar(NaN, 1, NaN, NaN, NaN)]));
});

test("Overflow is finite-or-null; cumulative overflow cannot become a false held line", () => {
  series(cmf([bar(1e308, 1e308, 1e308, -1e308)], 1), [1]);
  const huge = [bar(1, 1e308, 1, 0), bar(1, 1e308, 1, 0), bar(0, 1, 1, 0)];
  series(chaikinOscillator(huge, 1, 2), [0, null, null]);
  const indexed = positiveVolumeIndex(bars([1, 1e308, 2, 3], [1, 2, 3, 4]), 2);
  series(indexed.index, [1000, null, null, null]);
  series(indexed.average, [1000, null, null, null]);
  for (const fn of functions) {
    for (const output of results(
      fn([bar(-1e308, 1e308, 1e308, -1e308), bar(1e308, 1e308, 1e308, -1e308)])
    ))
      assert.ok(output.every((value) => value === null || Number.isFinite(value)));
  }
});

test("Manifest public IDs exist in current catalog; all actual plots are represented", () => {
  const catalog = [1, 2, 3]
    .map((i) => readFileSync(path.join(root, `catalog-data-part${i}.ts`), "utf8"))
    .join("\n");
  assert.equal(volumeFlowPresets.length, 7);
  assert.deepEqual(
    volumeFlowPresets.map((item) => item.outputs.length),
    [1, 1, 1, 1, 3, 2, 2]
  );
  for (const item of volumeFlowPresets) {
    assert.ok(catalog.includes(`"${item.publicId}"`), item.publicId);
    assert.equal(item.status, "math-only");
    assert.equal(item.verifiedOn, "2026-11-26");
    assert.ok(item.requiredData.includes("volume"));
    assert.ok(item.reference.includes(encodeURIComponent(item.publicId)));
    assert.ok(
      Object.isFrozen(item) && Object.isFrozen(item.parameters) && Object.isFrozen(item.outputs)
    );
    const metadata = volumeFlowMetadata(item.id);
    assert.ok(
      Object.isFrozen(metadata) &&
        Object.isFrozen(metadata.historyRequirement) &&
        Object.isFrozen(metadata.historyRequirement.emaLengths)
    );
    for (const output of item.outputs) assert.ok(metadata.outputWarmupBars[output.id] >= 1);
    for (const parameter of item.parameters) {
      assert.ok(Object.isFrozen(parameter));
      if (parameter.type === "integer") {
        assert.throws(() => volumeFlowMetadata(item.id, { [parameter.key]: 0 }), RangeError);
        assert.throws(
          () => volumeFlowMetadata(item.id, { [parameter.key]: parameter.max + 1 }),
          RangeError
        );
        assert.doesNotThrow(() => volumeFlowMetadata(item.id, { [parameter.key]: parameter.max }));
      }
    }
  }
  assert.equal(
    volumeFlowPresets.find((item) => item.id === "volume-oscillator").title,
    "Percentage Volume Oscillator"
  );
});

test("History metadata separates output warmup, windows, cumulative seeds and convergence", () => {
  assert.equal(volumeFlowMetadata("cmf").warmupBars, 20);
  assert.equal(volumeFlowMetadata("eom").warmupBars, 15);
  assert.equal(volumeFlowMetadata("efi").warmupBars, 2);
  assert.equal(volumeFlowMetadata("nvi").warmupBars, 1);
  assert.equal(
    volumeFlowMetadata("pvi").historyRequirement.seedPolicy,
    "internal-one-displayed-thousand"
  );
  assert.equal(
    volumeFlowMetadata("chaikin-oscillator").historyRequirement.kind,
    "cumulative-plus-ema"
  );
  assert.equal(volumeFlowMetadata("nvi").historyRequirement.convergence, "full-input-dependent");
  assert.equal(volumeFlowMetadata("cmf").historyRequirement.lookbackBars, null);
  const sma = volumeFlowMetadata("volume-oscillator", {
    fastLength: 2,
    slowLength: 4,
    signalLength: 3,
    oscillatorAverage: "SMA",
    signalAverage: "SMA"
  });
  assert.deepEqual(sma.outputWarmupBars, { oscillator: 4, signal: 6, histogram: 6 });
  assert.equal(sma.historyRequirement.convergence, "exact-after-valid-observations");
  assert.equal(
    volumeFlowMetadata("volume-oscillator").historyRequirement.convergence,
    "full-input-dependent"
  );
  assert.throws(() => volumeFlowMetadata("unknown"), RangeError);
  assert.throws(() => volumeFlowMetadata("nvi", { length: 2 }), RangeError);
});

test("PVO window seeding applies only when both smoothing stages are SMA", () => {
  for (const oscillatorAverage of ["SMA", "EMA"]) {
    for (const signalAverage of ["SMA", "EMA"]) {
      const metadata = volumeFlowMetadata("volume-oscillator", {
        fastLength: 2,
        slowLength: 4,
        signalLength: 3,
        oscillatorAverage,
        signalAverage
      });
      const allSma = oscillatorAverage === "SMA" && signalAverage === "SMA";
      assert.equal(metadata.historyRequirement.seedPolicy, allSma ? "window" : "first-non-null");
      assert.equal(
        metadata.historyRequirement.convergence,
        allSma ? "exact-after-valid-observations" : "full-input-dependent"
      );
      assert.deepEqual(metadata.historyRequirement.emaLengths, [
        ...(oscillatorAverage === "EMA" ? [2, 4] : []),
        ...(signalAverage === "EMA" ? [3] : [])
      ]);
      if (allSma) {
        assert.equal(metadata.historyRequirement.seedBars, 6);
        assert.deepEqual(metadata.outputWarmupBars, { oscillator: 4, signal: 6, histogram: 6 });
      }
    }
  }
});

test("Default calculations agree with verified current preset parameters", () => {
  const input = Array.from({ length: 270 }, (_, i) =>
    bar(10 + (i % 7), 10 + (i % 6), 18 + (i % 7), 2 + (i % 7))
  );
  assert.deepEqual(cmf(input), cmf(input, 20));
  assert.deepEqual(chaikinOscillator(input), chaikinOscillator(input, 3, 10));
  assert.deepEqual(elderForceIndex(input), elderForceIndex(input, 13));
  assert.deepEqual(easeOfMovement(input), easeOfMovement(input, 14, 10000));
  assert.deepEqual(negativeVolumeIndex(input), negativeVolumeIndex(input, 255));
  assert.deepEqual(positiveVolumeIndex(input), positiveVolumeIndex(input, 255));
  assert.deepEqual(
    volumeOscillator(input),
    volumeOscillator(input, {
      fastLength: 12,
      slowLength: 26,
      signalLength: 9,
      oscillatorAverage: "EMA",
      signalAverage: "EMA"
    })
  );
  assert.deepEqual(cmf(input).slice(0, 19), Array(19).fill(null));
  assert.deepEqual(easeOfMovement(input).slice(0, 14), Array(14).fill(null));
  assert.equal(negativeVolumeIndex(input).average[0], 1000);
});

test("Large input preserves length at maximum application bounds", () => {
  const input = Array.from({ length: 50000 }, (_, i) =>
    bar(10 + (i % 7), 10 + (i % 6), 18 + (i % 7), 2 + (i % 7))
  );
  const outputs = [
    cmf(input, 2000),
    chaikinOscillator(input, 2000, 1),
    elderForceIndex(input, 2000),
    easeOfMovement(input, 2000, 1000000000),
    ...results(
      volumeOscillator(input, {
        fastLength: 10000,
        slowLength: 9999,
        signalLength: 10000,
        oscillatorAverage: "SMA",
        signalAverage: "SMA"
      })
    ),
    ...results(negativeVolumeIndex(input, 10000)),
    ...results(positiveVolumeIndex(input, 10000))
  ];
  for (const output of outputs) {
    assert.equal(output.length, input.length);
    assert.ok(Number.isFinite(output.at(-1)));
  }
});
