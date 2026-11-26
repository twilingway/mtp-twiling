import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadChannelAverageSource } from "./helpers/channel-average-source.mjs";

const {
  alma,
  lsma,
  keltnerChannels,
  donchianChannels,
  chandelierExit,
  channelAverageMetadata,
  channelAveragePresets
} = loadChannelAverageSource();
const bar = (high, low = high, close = high, timestamp = 1) => ({
  timestamp,
  high,
  low,
  close,
  open: close,
  volume: null
});
const bars = (rows) =>
  rows.map(([high, low, close], i) => bar(high, low, close, 1700000000 + i * 60));
const ledger = () =>
  bars([
    [10, 8, 9],
    [15, 11, 14],
    [14, 10, 11],
    [20, 16, 18],
    [12, 8, 10],
    [13, 9, 12],
    [8, 4, 5]
  ]);
const gap = () => bar(null, null, null);
const valueSeries = (actual, expected, tolerance = 3e-12) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => {
    if (value === null) assert.equal(actual[i], null, `index ${i}`);
    else
      assert.ok(
        Number.isFinite(actual[i]) &&
          Math.abs(actual[i] - value) <= tolerance * Math.max(1, Math.abs(value)),
        `index ${i}: ${actual[i]} != ${value}`
      );
  });
};
const seriesOf = (result) => (Array.isArray(result) ? { value: result } : result);
const logSigma = 3 * Math.sqrt(2 * Math.log(2));
const ema = [9, 23 / 2, 45 / 4, 117 / 8, 197 / 16, 389 / 32, 549 / 64];
const atr = [null, 4, 4, 13 / 2, 33 / 4, 49 / 8, 113 / 16];
const rangeRma = [null, null, 10 / 3, 32 / 9, 100 / 27, 308 / 81, 940 / 243];
const bands = (basis, ranges, multiplier) => ({
  basis,
  upper: basis.map((v, i) =>
    v === null || ranges[i] === null ? null : v + multiplier * ranges[i]
  ),
  lower: basis.map((v, i) => (v === null || ranges[i] === null ? null : v - multiplier * ranges[i]))
});
const assertOutputs = (actual, expected) => {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [key, values] of Object.entries(expected)) valueSeries(actual[key], values);
};

test("ALMA logarithmic ledger yields rational [1,2,1]/4 weights", () => {
  valueSeries(alma([1, 4, 2, 8, 3], { length: 3, offset: 0.5, sigma: logSigma }), [
    null,
    null,
    11 / 4,
    4,
    21 / 4
  ]);
});
test("ALMA fractional center versus optional floor have independent rational weights", () => {
  const params = { length: 4, offset: 0.5, sigma: 4 * Math.sqrt(2 * Math.log(2)) };
  valueSeries(alma([1, 2, 7, 4], params), [null, null, null, 41 / 10]);
  valueSeries(alma([1, 2, 7, 4], { ...params, floor: true }), [null, null, null, 100 / 33]);
});
test("ALMA orientation weights recent values when offset is one", () => {
  valueSeries(alma([1, 4, 2], { length: 3, offset: 0, sigma: logSigma }), [null, null, 2]);
  valueSeries(alma([1, 4, 2], { length: 3, offset: 1, sigma: logSigma }), [null, null, 13 / 5]);
});
test("ALMA default9 first readiness and no mandatory floor", () => {
  const values = Array.from({ length: 12 }, (_, i) => i + 1);
  const result = alma(values);
  assert.equal(
    result.findIndex((v) => v !== null),
    8
  );
  assert.deepEqual(result, alma(values, { length: 9, offset: 0.85, sigma: 6, floor: false }));
  assert.notDeepEqual(result, alma(values, { floor: true }));
});
test("ALMA length1, zero, negatives and far kernel do not create unknown prices", () => {
  valueSeries(alma([0, -4, null, 3], { length: 1 }), [0, -4, null, 3]);
  valueSeries(alma([0, 0, 0], { length: 3 }), [null, null, 0]);
  valueSeries(alma([3, 3, 3], { length: 3, offset: 100, sigma: 10000 }), [null, null, 3]);
});
test("ALMA null window must refill contiguous history", () => {
  valueSeries(alma([1, 2, null, 4, 6, 8], { length: 3, offset: 0.5, sigma: logSigma }), [
    null,
    null,
    null,
    null,
    null,
    6
  ]);
});

test("LSMA rational OLS endpoint ledger", () => {
  valueSeries(lsma([1, 4, 2, 8, 3], { length: 3 }), [null, null, 17 / 6, 20 / 3, 29 / 6]);
});
test("LSMA offsets evaluate current fit; they do not index past/future bars", () => {
  valueSeries(lsma([1, 4, 2], { length: 3, offset: 1 }), [null, null, 7 / 3]);
  valueSeries(lsma([1, 4, 2], { length: 3, offset: -1 }), [null, null, 10 / 3]);
  valueSeries(lsma([1, 4, 2], { length: 3, offset: 4 }), [null, null, 5 / 6]);
});
test("LSMA asymmetric even length centered normal equations", () => {
  // x=0,1,2,3; y=2,7,-1,4; mean3, covariance -1, sum(x-1.5)^2=5.
  valueSeries(lsma([2, 7, -1, 4], { length: 4 }), [null, null, null, 27 / 10]);
  valueSeries(lsma([2, 7, -1, 4], { length: 4, offset: 2 }), [null, null, null, 31 / 10]);
});
test("LSMA affine series projects exactly at offset and default25", () => {
  const values = Array.from({ length: 30 }, (_, i) => 5 + 3 * i);
  const expected = values.map((v, i) => (i < 24 ? null : v));
  valueSeries(lsma(values), expected);
  valueSeries(
    lsma(values, { offset: -3 }),
    expected.map((v) => (v === null ? null : v + 9))
  );
});
test("LSMA degenerate length1 is explicitly locally unsupported until Pine evidence", () => {
  assert.throws(() => lsma([2], { length: 1 }), RangeError);
  assert.match(channelAverageMetadata("lsma").limitations.join(), /Length1.*unresolved/);
});
test("LSMA null and flat windows keep valid mathematical zero", () => {
  valueSeries(lsma([0, 0, null, -3, -3, -3], { length: 2 }), [null, 0, null, null, -3, -3]);
});

for (const [name, options, expected] of [
  ["ATR2 EMA3", { length: 3, atrLength: 2, multiplier: 2 }, bands(ema, atr, 2)],
  [
    "TR EMA3",
    { length: 3, bandsStyle: "True Range", multiplier: 0.5 },
    bands(ema, [2, 6, 4, 9, 10, 4, 8], 0.5)
  ],
  [
    "Range is RMA3, not raw range",
    { length: 3, bandsStyle: "Range", multiplier: 2 },
    bands(ema, rangeRma, 2)
  ],
  [
    "ATR2 SMA3",
    { length: 3, atrLength: 2, useExponentialMa: false, multiplier: 2 },
    bands([null, null, 34 / 3, 43 / 3, 13, 40 / 3, 9], atr, 2)
  ]
])
  test(`Keltner independent ledger ${name}`, () =>
    assertOutputs(keltnerChannels(ledger(), options), expected));

test("Keltner True Range uses prior close gap and firstbar high-low fallback", () => {
  const result = keltnerChannels(
    bars([
      [3, 1, 2],
      [11, 9, 10]
    ]),
    { length: 1, bandsStyle: "True Range", multiplier: 1 }
  );
  assertOutputs(result, { basis: [2, 10], upper: [4, 19], lower: [0, 1] });
});
test("Keltner basis remains numeric before ATR seeded", () => {
  assertOutputs(
    keltnerChannels(
      bars([
        [2, 0, 1],
        [4, 2, 3]
      ]),
      { length: 3, atrLength: 3 }
    ),
    { basis: [1, 2], upper: [null, null], lower: [null, null] }
  );
});
test("Keltner source options consume exact selected fields", () => {
  const inputs = [{ ...bar(8, 0, 4), open: 2, volume: 12 }];
  for (const [source, expected] of [
    ["close", 4],
    ["high", 8],
    ["low", 0],
    ["open", 2],
    ["volume", 12],
    ["hl2", 4],
    ["hlc3", 4],
    ["ohlc4", 3.5]
  ])
    valueSeries(keltnerChannels(inputs, { length: 1, atrLength: 1, source, multiplier: 0 }).basis, [
      expected
    ]);
});
test("Keltner independent basis and range gaps reset only their own histories", () => {
  const input = bars([
    [2, 0, 1],
    [4, 2, 3],
    [6, 4, null],
    [8, 6, 7],
    [10, 8, 9]
  ]);
  const actual = keltnerChannels(input, { length: 3, atrLength: 2, multiplier: 1 });
  valueSeries(actual.basis, [1, 2, null, 7, 8]);
  // TR=2,3,3,2(fallback previous close null),3; ATR=na,2.5,2.75,2.375,2.6875.
  valueSeries(actual.upper, [null, 4.5, null, 9.375, 10.6875]);
});
test("Keltner default20 EMA/ATR10 firstready and all output values are retained", () => {
  const input = Array.from({ length: 25 }, (_, i) => bar(10, 8, 9, i));
  const actual = keltnerChannels(input);
  valueSeries(
    actual.basis,
    input.map(() => 9)
  );
  valueSeries(
    actual.upper,
    input.map((_, i) => (i < 9 ? null : 13))
  );
  valueSeries(
    actual.lower,
    input.map((_, i) => (i < 9 ? null : 5))
  );
});

test("Donchian rolling extrema and midpoint ledger include partial startup", () => {
  assertOutputs(donchianChannels(ledger(), { length: 3 }), {
    upper: [10, 15, 15, 20, 20, 20, 13],
    lower: [8, 8, 8, 10, 8, 8, 4],
    basis: [9, 11.5, 11.5, 15, 14, 14, 8.5]
  });
});
test("Donchian ties expire by index without early eviction", () => {
  const input = bars([
    [5, 1, 2],
    [5, 1, 2],
    [4, 2, 3],
    [3, 2, 2]
  ]);
  assertOutputs(donchianChannels(input, { length: 2 }), {
    upper: [5, 5, 5, 4],
    lower: [1, 1, 1, 2],
    basis: [3, 3, 3, 3]
  });
});
test("Donchian display offsets never shift calculations or require future bars", () => {
  const unshifted = donchianChannels(ledger());
  assert.deepEqual(donchianChannels(ledger(), { displayOffset: -6 }), unshifted);
  assert.deepEqual(donchianChannels(ledger(), { displayOffset: 7 }), unshifted);
  assert.equal(
    channelAverageMetadata("donchian-channels", { displayOffset: -6 }).presentation.displayOffset,
    -6
  );
});
test("Donchian null resets each independent extrema segment", () => {
  const input = [bar(10, 1, 2), { ...bar(11, 2, 3), high: null }, bar(5, 3, 4)];
  assertOutputs(donchianChannels(input, { length: 3 }), {
    upper: [10, null, 5],
    lower: [1, 1, 1],
    basis: [5.5, null, 3]
  });
});
test("Donchian does not consume open, close or volume", () => {
  const input = [{ ...bar(4, 2, 3), close: NaN, open: undefined, volume: Infinity }];
  assertOutputs(donchianChannels(input), { upper: [4], lower: [2], basis: [3] });
});

test("Chandelier builtin rational ATR2 extrema3 ledger contains both simultaneous exits", () => {
  assertOutputs(chandelierExit(ledger(), { length: 3, atrLength: 2, multiplier: 2 }), {
    longExit: [null, 7, 7, 7, 7 / 2, 31 / 4, -9 / 8],
    shortExit: [null, 16, 16, 23, 49 / 2, 81 / 4, 145 / 8]
  });
});
test("Chandelier intentionally loosens exits and has no ratchet or direction masking", () => {
  const actual = chandelierExit(ledger(), { length: 3, atrLength: 2, multiplier: 2 });
  assert.ok(actual.longExit[4] < actual.longExit[3]);
  assert.ok(actual.shortExit[3] > actual.shortExit[2]);
  assert.deepEqual(Object.keys(actual), ["longExit", "shortExit"]);
});
test("Chandelier length is independent of ATR length and extrema startup is partial", () => {
  assertOutputs(
    chandelierExit(
      bars([
        [4, 0, 3],
        [5, 1, 2]
      ]),
      { length: 20, atrLength: 1, multiplier: 0.5 }
    ),
    { longExit: [2, 3], shortExit: [2, 2] }
  );
});
test("Chandelier default22 seed and source is high/low not closes", () => {
  const input = Array.from({ length: 25 }, (_, i) => bar(10, 4, 5, i));
  const result = chandelierExit(input);
  valueSeries(
    result.longExit,
    input.map((_, i) => (i < 21 ? null : -8))
  );
  valueSeries(
    result.shortExit,
    input.map((_, i) => (i < 21 ? null : 22))
  );
});
test("Chandelier gap resets ATR then reseeds a contiguous window", () => {
  const input = [bar(4, 0, 2), bar(4, 0, 2), gap(), bar(10, 8, 9), bar(12, 10, 11)];
  assertOutputs(chandelierExit(input, { length: 3, atrLength: 2, multiplier: 1 }), {
    longExit: [null, 0, null, null, 9.5],
    shortExit: [null, 4, null, null, 10.5]
  });
});

const calls = [
  ["alma", (values) => alma(values, { length: 3 })],
  ["lsma", (values) => lsma(values, { length: 3, offset: -2 })],
  ["keltner-atr", (values) => keltnerChannels(values, { length: 3, atrLength: 2 })],
  [
    "keltner-sma-tr",
    (values) =>
      keltnerChannels(values, { length: 3, useExponentialMa: false, bandsStyle: "True Range" })
  ],
  ["keltner-range", (values) => keltnerChannels(values, { length: 3, bandsStyle: "Range" })],
  ["donchian", (values) => donchianChannels(values, { length: 3, displayOffset: -7 })],
  ["chandelier", (values) => chandelierExit(values, { length: 4, atrLength: 2 })]
];
for (const [name, calculate] of calls) {
  const numeric = name === "alma" || name === "lsma";
  test(`${name} causal every-prefix and frozen timestamps/input`, () => {
    const input = numeric
      ? Object.freeze([1, 9, 2, -3, 8, 12, 0])
      : Object.freeze(ledger().map(Object.freeze));
    const before = structuredClone(input);
    const entire = seriesOf(calculate(input));
    for (let length = 0; length <= input.length; length++) {
      const prefix = seriesOf(calculate(Object.freeze(input.slice(0, length))));
      for (const key of Object.keys(entire))
        assert.deepEqual(prefix[key], entire[key].slice(0, length));
    }
    assert.deepEqual(input, before);
  });
  test(`${name} empty, all-null, finite output and no Infinity`, () => {
    assert.equal(
      Object.values(seriesOf(calculate([]))).every((s) => s.length === 0),
      true
    );
    const input = numeric ? [null, null, null] : [gap(), gap(), gap()];
    for (const values of Object.values(seriesOf(calculate(input))))
      assert.deepEqual(values, [null, null, null]);
    const extreme = numeric
      ? [1e308, -1e308, 1e308, -1e308, 1e308]
      : [bar(1e308, -1e308, 0), bar(1e308, -1e308, 0), bar(2, 0, 1)];
    for (const values of Object.values(seriesOf(calculate(extreme))))
      assert.ok(values.every((v) => v === null || Number.isFinite(v)));
  });
  test(`${name} sparse and nonfinite consumed inputs are rejected`, () => {
    assert.throws(() => calculate(Array(3)), RangeError);
    assert.throws(() => calculate(numeric ? [1, NaN] : [bar(NaN, 0, 1)]), RangeError);
    assert.throws(() => calculate(numeric ? [Infinity] : [bar(Infinity, 0, 1)]), RangeError);
  });
}

test("large same-sign ALMA and regression preserve representable finite values", () => {
  const values = Array(12).fill(Number.MAX_VALUE);
  assert.ok(
    alma(values, { length: 3 })
      .slice(2)
      .every((v) => v === Number.MAX_VALUE)
  );
  valueSeries(lsma(values, { length: 3 }).slice(2), Array(10).fill(Number.MAX_VALUE));
  valueSeries(donchianChannels([bar(Number.MAX_VALUE, Number.MAX_VALUE)]).basis, [
    Number.MAX_VALUE
  ]);
});
test("LSMA unrepresentable projection returns null", () => {
  valueSeries(lsma([-1e308, 1e308], { length: 2, offset: -1 }), [null, null]);
});
test("Keltner and Chandelier overflow reset ATR seed and recover without replacement price", () => {
  const input = [bar(1e308, -1e308, 0), bar(4, 2, 3), bar(6, 4, 5), bar(8, 6, 7)];
  const result = chandelierExit(input, { length: 1, atrLength: 2, multiplier: 1 });
  // first TR overflows. Next TR4 (prev close0), then3 -> ATR3.5.
  valueSeries(result.longExit, [null, null, 2.5, 4.75]);
  const kc = keltnerChannels(input, { length: 1, atrLength: 2, multiplier: 1 });
  valueSeries(kc.upper, [null, null, 8.5, 10.25]);
});
test("rolling SMA avoids cancellation when a huge value leaves its window", () => {
  const input = [bar(1e308), bar(1), bar(1), bar(1)];
  valueSeries(
    keltnerChannels(input, { length: 2, atrLength: 1, useExponentialMa: false, multiplier: 0 })
      .basis,
    [null, 5e307, 1, 1]
  );
});

for (const [label, fn] of [
  ["ALMA length0", () => alma([], { length: 0 })],
  ["ALMA sigma0", () => alma([], { sigma: 0 })],
  ["ALMA negative sigma", () => alma([], { sigma: -1 })],
  ["ALMA floor malformed", () => alma([], { floor: 1 })],
  ["ALMA offset NaN", () => alma([], { offset: NaN })],
  ["LSMA fractional offset", () => lsma([], { offset: 0.5 })],
  ["length above cap", () => donchianChannels([], { length: 10001 })],
  ["fractional length", () => chandelierExit([], { atrLength: 1.5 })],
  ["negative multiplier", () => keltnerChannels([], { multiplier: -1 })],
  ["nonfinite multiplier", () => chandelierExit([], { multiplier: Infinity })],
  ["invalid source", () => keltnerChannels([], { source: "bad" })],
  ["invalid average", () => keltnerChannels([], { useExponentialMa: 1 })],
  ["invalid range", () => keltnerChannels([], { bandsStyle: "ATR" })],
  ["fractional display offset", () => donchianChannels([], { displayOffset: 1.5 })],
  ["oversized bars", () => donchianChannels(Array(1000001))],
  ["oversized series", () => alma(Array(1000001))],
  ["ALMA convolution cap", () => alma(Array(16000).fill(1), { length: 5000 })],
  ["LSMA direct operation cap", () => lsma(Array(16000).fill(1), { length: 5000 })],
  ["inverted high/low", () => chandelierExit([bar(1, 3, 2)])],
  ["close outside range", () => keltnerChannels([bar(4, 2, 8)])],
  ["invalid timestamp", () => donchianChannels([bar(4, 2, 3, Infinity)])]
])
  test(`invalid local contract: ${label}`, () => assert.throws(fn, RangeError));

test("metadata exact defaults, IDs and source hashes match127 catalog", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../reference/tradingview-indicators/catalog.json", import.meta.url),
      "utf8"
    )
  );
  const all = Object.values(catalog).flat();
  for (const preset of channelAveragePresets) {
    assert.ok(
      all.some((entry) => entry?.id === preset.publicId && entry.category === "indicators")
    );
    assert.equal(preset.status, "math-only");
    assert.equal(preset.defaultPane, "overlay");
    assert.match(preset.sourceSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(preset.omittedNumericOutputs, []);
    assert.ok(Object.isFrozen(preset.defaults));
  }
  assert.deepEqual(channelAveragePresets[0].defaults, { length: 9, offset: 0.85, sigma: 6 });
  assert.equal(channelAverageMetadata("alma").parameters.floor, false);
  assert.equal(channelAveragePresets[1].defaults.length, 25);
  assert.deepEqual(channelAveragePresets[2].defaults, {
    length: 20,
    multiplier: 2,
    source: "close",
    useExponentialMa: true,
    bandsStyle: "Average True Range",
    atrLength: 10
  });
  assert.deepEqual(channelAveragePresets[4].defaults, { length: 22, atrLength: 22, multiplier: 3 });
});
test("metadata per-output warmup, finite versus recursive and no implicit presentation shift", () => {
  assert.deepEqual(
    channelAverageMetadata("keltner-channels", { length: 3, atrLength: 7 }).firstReadyBars,
    { basis: 1, upper: 7, lower: 7 }
  );
  assert.equal(
    channelAverageMetadata("keltner-channels", {
      length: 3,
      bandsStyle: "True Range",
      useExponentialMa: false
    }).historyRequirement.lookbackBars,
    3
  );
  assert.equal(channelAverageMetadata("keltner-channels").historyRequirement.kind, "recursive");
  assert.equal(
    channelAverageMetadata("chandelier-exit", { length: 50, atrLength: 2 }).warmupBars,
    2
  );
  assert.equal(channelAverageMetadata("donchian-channels").warmupBars, 1);
  assert.equal(channelAverageMetadata("donchian-channels").historyRequirement.lookbackBars, 20);
  assert.equal(channelAverageMetadata("lsma", { offset: -5 }).presentation.displayOffset, 0);
  assert.throws(() => channelAverageMetadata("unknown"), RangeError);
  assert.throws(() => channelAverageMetadata("lsma", { length: 1 }), RangeError);
});
test("bounded largest periods on short inputs and long linear extrema workload", () => {
  assert.deepEqual(alma([1, 2], { length: 10000 }), [null, null]);
  assert.deepEqual(lsma([1, 2], { length: 10000 }), [null, null]);
  const input = Array.from({ length: 100000 }, (_, i) => bar(i + 2, i, i + 1, i));
  const result = donchianChannels(input, { length: 10000 });
  assert.equal(result.upper.at(-1), 100001);
  assert.equal(result.lower.at(-1), 90000);
});

test("subnormal flat prices remain prices rather than artificial zero", () => {
  const tiny = Number.MIN_VALUE;
  const input = Array.from({ length: 4 }, (_, i) => bar(tiny, tiny, tiny, i));
  assert.deepEqual(alma(Array(4).fill(tiny), { length: 2 }), [null, tiny, tiny, tiny]);
  assert.deepEqual(lsma(Array(4).fill(tiny), { length: 2 }), [null, tiny, tiny, tiny]);
  assert.deepEqual(donchianChannels(input).basis, [tiny, tiny, tiny, tiny]);
  for (const useExponentialMa of [true, false]) {
    const result = keltnerChannels(input, {
      length: 2,
      atrLength: 1,
      multiplier: 0,
      source: "hl2",
      useExponentialMa
    });
    assert.deepEqual(
      result.basis,
      useExponentialMa ? [tiny, tiny, tiny, tiny] : [null, tiny, tiny, tiny]
    );
  }
  assert.deepEqual(chandelierExit(input, { atrLength: 2 }).longExit, [null, tiny, tiny, tiny]);
});
