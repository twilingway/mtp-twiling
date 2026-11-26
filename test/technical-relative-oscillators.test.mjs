import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRelativeSource } from "./helpers/relative-oscillator-source.mjs";
import {
  mean,
  stochOracle,
  vigorOracle,
  volatilityOracle,
  coppockOracle,
  bullOracle
} from "./helpers/relative-oscillator-oracle.mjs";

const api = loadRelativeSource();
const {
  stochasticRsi,
  relativeVigorIndex,
  relativeVolatilityIndex,
  coppockCurve,
  bullBearPower,
  relativeOscillatorMetadata: metadata,
  relativeOscillatorPresets: presets,
  VOLATILITY_MA_TYPES
} = api;
const filters = loadRelativeSource("filters");
const numeric = loadRelativeSource("numeric");
const bar = (close, i = 0, volume = 100) => ({
  timestamp: 1700000000 + i * 60,
  open: close,
  high: close === null ? null : close + 2,
  low: close === null ? null : close - 2,
  close,
  volume
});
const rows = (values) => values.map((value, i) => bar(value, i));
const outputs = (value) => (Array.isArray(value) ? { value } : value);
function near(actual, expected, tolerance = 2e-11) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => {
    if (value === null) assert.equal(actual[i], null, `null index ${i}`);
    else
      assert.ok(
        typeof actual[i] === "number" &&
          Number.isFinite(actual[i]) &&
          Math.abs(actual[i] - value) <= tolerance * Math.max(Math.abs(value), 1),
        `index ${i}: ${actual[i]} != ${value}`
      );
  });
}
function same(actual, expected) {
  actual = outputs(actual);
  expected = outputs(expected);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(actual)) near(actual[key], expected[key]);
}
const changing = () =>
  rows(Array.from({ length: 90 }, (_, i) => 20 + i / 7 + (i % 3 === 0 ? 3 : -2)));
const cases = [
  [
    "stochastic-rsi",
    stochasticRsi,
    stochOracle,
    { rsiLength: 3, stochasticLength: 5, smoothK: 2, smoothD: 3 }
  ],
  ["relative-vigor-index", relativeVigorIndex, vigorOracle, { length: 3 }],
  [
    "relative-volatility-index",
    relativeVolatilityIndex,
    volatilityOracle,
    { length: 4, maLength: 3, maType: "SMA + Bollinger Bands" }
  ],
  [
    "coppock-curve",
    coppockCurve,
    coppockOracle,
    { wmaLength: 4, longRocLength: 5, shortRocLength: 2 }
  ],
  ["bull-bear-power", bullBearPower, bullOracle, { length: 4 }]
];

test("five exact primary IDs, version/hash/default/output metadata without stored Pine", () => {
  const capture = JSON.parse(
    readFileSync(
      new URL("../docs/RELATIVE_OSCILLATORS_PRIMARY_CAPTURE.json", import.meta.url),
      "utf8"
    )
  );
  const reference = JSON.parse(
    readFileSync(
      new URL("../docs/RELATIVE_OSCILLATORS_REFERENCE_CAPTURE.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(
    reference.payloads[0].sha256,
    "681492fc92bba4f2ec3dfb2435a2c6675a7f84df9a5fc41e3fd113eacdd9f2f8"
  );
  assert.ok(
    reference.payloads.every((p) => p.fullPayloadSaved === false && p.tls.includes("CERT_REQUIRED"))
  );
  assert.equal(reference.facts.pineExecutionPerformed, false);
  assert.equal(reference.facts.highestStartupExplicitlyResolved, false);
  assert.equal(presets.length, 5);
  assert.deepEqual(
    presets.map((p) => p.publicId),
    [
      "STD;Stochastic_RSI",
      "STD;Relative_Vigor_Index",
      "STD;Relative_Volatility_Index",
      "STD;Coppock%1Curve",
      "STD;Bull%Bear%Power"
    ]
  );
  presets.forEach((preset, i) => {
    assert.equal(preset.verifiedVersion, capture[i].version);
    assert.equal(preset.sourceSha256, capture[i].sha256);
    assert.equal(capture[i].status, 200);
    assert.equal(capture[i].fullSourceSaved, false);
    assert.ok(capture[i].tls.includes("CERT_REQUIRED"));
    assert.deepEqual(preset.hiddenNumericOutputs, []);
    assert.deepEqual(preset.omittedNumericOutputs, []);
    assert.equal(preset.status, "math-only");
    assert.equal(Object.isFrozen(preset.defaults), true);
    assert.ok(preset.parityLimits.some((v) => v.includes("no Pine execution")));
  });
  assert.equal(capture[4].plots.length, 1);
  assert.deepEqual(capture[4].plots[0].colorComparison, [["bbp", ">=", "0"]]);
});
test("Stoch RSI RMA/partial-window rational reversal ledger, K and D distinct", () => {
  const result = stochasticRsi(rows([1, 2, 1, 3, 2, 4]), {
    rsiLength: 2,
    stochasticLength: 3,
    smoothK: 2,
    smoothD: 2
  });
  near(result.k, [null, null, null, null, 50, 600 / 13]);
  near(result.d, [null, null, null, null, null, 625 / 13]);
  // A full 3-known-RSI startup gate would leave raw index3 null and K index4 null.
  assert.equal(result.k[4], 50);
});
test("Vigor exact 4SWMA rational ledger and signal", () => {
  const fixture = [4, 7, 5, 8, 3, 6, 2].map((close, i) => ({
    ...bar(close, i),
    open: 4,
    high: 8,
    low: 2
  }));
  const result = relativeVigorIndex(fixture, { length: 1 });
  near(result.value, [null, null, null, 1 / 3, 1 / 3, 1 / 4, 1 / 9]);
  near(result.signal, [null, null, null, null, null, null, 29 / 108]);
});
test("Volatility population SD and directional EMA14 hand ledger with independent BB", () => {
  const result = relativeVolatilityIndex(rows([1, 3, 2, 6, 4]), {
    length: 2,
    maLength: 2,
    maType: "SMA + Bollinger Bands"
  });
  near(result.value, [null, 100, 650 / 7, 11450 / 121, 74425 / 899]);
  near(result.smoothing.slice(0, 3), [null, null, 675 / 7]);
  near(result.upperBand.slice(0, 3), [null, null, 725 / 7]);
  near(result.lowerBand.slice(0, 3), [null, null, 625 / 7]);
});
test("Coppock two ROC plus recent-heavy WMA rational ledger", () => {
  near(
    coppockCurve(rows([2, 4, 8, 6, 12]), { wmaLength: 2, longRocLength: 2, shortRocLength: 1 }),
    [null, null, null, 150, 325 / 3]
  );
});
test("Bull/Bear wrapper returns one sum; EMA first-known seed ledger", () => {
  const fixture = [10, 14, 10, 17].map((close, i) => ({
    ...bar(close, i),
    high: [11, 15, 12, 18][i],
    low: [9, 13, 8, 16][i]
  }));
  near(bullBearPower(fixture, { length: 3 }), [0, 4, -2, 6]);
  assert.deepEqual(presets[4].outputs, ["value"]);
});
test("population deviation rational window and 4SWMA differ from sample/EMA", () => {
  near(filters.numbers(filters.deviation(filters.scalars([1, 2, 3, 4]), 3)), [
    null,
    null,
    Math.sqrt(2 / 3),
    Math.sqrt(2 / 3)
  ]);
  near(filters.numbers(filters.swma(filters.scalars([1, 3, 2, 8, 4]))), [
    null,
    null,
    null,
    19 / 6,
    27 / 6
  ]);
  near(filters.numbers(filters.recursive(filters.scalars([1, null, 3, 8, 2]), 3, "RMA")), [
    null,
    null,
    null,
    4,
    10 / 3
  ]);
});
test("all seven Volatility MA choices match independent direct-window oracle", () => {
  const fixture = changing();
  for (const maType of VOLATILITY_MA_TYPES) {
    const options = { length: 3, maLength: 4, maType, bbMultiplier: 3 };
    same(relativeVolatilityIndex(fixture, options), volatilityOracle(fixture, options));
    const value = relativeVolatilityIndex(fixture, options);
    if (maType === "None") assert.ok(value.smoothing.every((v) => v === null));
    if (maType !== "SMA + Bollinger Bands")
      assert.ok([...value.upperBand, ...value.lowerBand].every((v) => v === null));
  }
});
test("RVI Volatility equality goes to lower branch, fixed close, no flat50 fallback", () => {
  const fixture = rows([1, 3, 3, 2, 2, 5]);
  same(relativeVolatilityIndex(fixture, { length: 3 }), volatilityOracle(fixture, { length: 3 }));
  const flat = rows(Array(40).fill(7));
  assert.ok(relativeVolatilityIndex(flat).value.every((v) => v === null));
  assert.ok(relativeVolatilityIndex(changing(), { length: 1 }).value.every((v) => v === null));
  assert.ok(stochasticRsi(flat).k.every((v) => v === null));
  assert.ok(
    relativeVigorIndex(flat.map((b) => ({ ...b, high: 7, low: 7 }))).value.every((v) => v === null)
  );
});
test("offsets validate but never shift numeric arrays/timestamps; output scopes explicit", () => {
  const fixture = changing();
  same(relativeVigorIndex(fixture, { offset: -500 }), relativeVigorIndex(fixture, { offset: 500 }));
  same(
    relativeVolatilityIndex(fixture, { offset: -500 }),
    relativeVolatilityIndex(fixture, { offset: 500 })
  );
  assert.deepEqual(presets[1].presentation.offsetOutputs, ["value", "signal"]);
  assert.deepEqual(presets[2].presentation.offsetOutputs, ["value"]);
});
test("metadata dynamic first readiness is a lower bound, default and custom histories", () => {
  for (const [id, compute, , options] of cases) {
    const result = outputs(compute(changing(), options));
    const history = metadata(id, options).history;
    for (const [key, series] of Object.entries(result)) {
      const first = series.findIndex((v) => v !== null);
      if (first >= 0) assert.ok(first >= history.firstPossibleIndex[key], `${id}/${key}`);
    }
  }
  assert.deepEqual(metadata("stochastic-rsi").history.firstPossibleIndex, { k: 17, d: 19 });
  assert.deepEqual(metadata("relative-vigor-index").history.firstPossibleIndex, {
    value: 12,
    signal: 15
  });
  assert.deepEqual(metadata("relative-volatility-index").history.firstPossibleIndex, {
    value: 9,
    smoothing: 22,
    upperBand: null,
    lowerBand: null
  });
  assert.deepEqual(metadata("coppock-curve").history.firstPossibleIndex, { value: 23 });
  assert.equal(metadata("relative-volatility-index", { maType: "VWMA" }).requiresVolume, true);
  assert.equal(metadata("stochastic-rsi", { source: "volume" }).requiresVolume, true);
});

for (const [id, compute, oracle, options] of cases) {
  test(`${id}: deterministic random oracle, gaps, prefix, append, correction, immutable inputs`, () => {
    let seed = 79013;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let round = 0; round < 20; round++) {
      const fixture = Array.from({ length: 67 }, (_, i) => {
        const value = i > 9 && random() < 0.12 ? null : 10 + Math.floor(random() * 25);
        return {
          ...bar(value, i, i % 7 === 0 ? 0 : Math.floor(random() * 10)),
          open: value === null ? null : value + random() - 0.5
        };
      });
      const before = structuredClone(fixture);
      fixture.forEach(Object.freeze);
      Object.freeze(fixture);
      const actual = compute(fixture, options);
      const expected = oracle(fixture, options);
      same(actual, expected);
      assert.deepEqual(fixture, before);
      const cut = 19 + round;
      const prefix = outputs(compute(fixture.slice(0, cut), options));
      for (const [key, series] of Object.entries(outputs(actual)))
        assert.deepEqual(series.slice(0, cut), prefix[key]);
      const corrected = [...fixture.slice(0, -1), bar(17, fixture.length - 1)];
      same(compute(corrected, options), oracle(corrected, options));
      const appended = compute([...fixture, bar(19, fixture.length)], options);
      for (const [key, series] of Object.entries(outputs(actual)))
        assert.deepEqual(outputs(appended)[key].slice(0, -1), series);
    }
  });
}
test("skip-null observation windows versus positional SWMA and exact-index ROC gaps", () => {
  near(filters.numbers(filters.rolling(filters.scalars([1, null, 3, 5, null, 7]), 2)), [
    null,
    null,
    2,
    4,
    4,
    6
  ]);
  near(filters.numbers(filters.swma(filters.scalars([1, 2, 3, null, 5, 6, 7, 8]))), [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    6.5
  ]);
  same(
    coppockCurve(rows([2, 4, null, 8, 16, 32]), {
      wmaLength: 1,
      longRocLength: 2,
      shortRocLength: 1
    }),
    coppockOracle(rows([2, 4, null, 8, 16, 32]), {
      wmaLength: 1,
      longRocLength: 2,
      shortRocLength: 1
    })
  );
});
test("no-volume and zero-volume VWMA are null, other modes never consume volume", () => {
  for (const volume of [null, 0]) {
    const fixture = changing().map((b) => ({ ...b, volume }));
    assert.ok(
      relativeVolatilityIndex(fixture, { maType: "VWMA", maLength: 2 }).smoothing.every(
        (v) => v === null
      )
    );
    same(relativeVolatilityIndex(fixture), relativeVolatilityIndex(changing()));
  }
  const fixture = changing().map((b) => ({ ...b, volume: Number.MAX_VALUE }));
  const actual = relativeVolatilityIndex(fixture, { maType: "VWMA", maLength: 3 });
  near(actual.smoothing, mean(actual.value, 3));
});
test("consumed fields only; dense finite/null input, real source choices, unknown options reject", () => {
  const invalidUnused = changing().map((b) => ({
    ...b,
    open: NaN,
    high: Infinity,
    low: undefined,
    volume: -1
  }));
  same(coppockCurve(invalidUnused), coppockCurve(changing()));
  same(stochasticRsi(invalidUnused), stochasticRsi(changing()));
  same(relativeVolatilityIndex(invalidUnused), relativeVolatilityIndex(changing()));
  assert.throws(() => relativeVolatilityIndex(invalidUnused, { maType: "VWMA" }), RangeError);
  for (const [, compute] of cases) {
    for (const invalid of [
      [undefined],
      [null],
      [{ ...bar(2), timestamp: null }],
      [{ ...bar(2), close: NaN }],
      new Array(2)
    ])
      assert.throws(() => compute(invalid), RangeError);
    assert.throws(() => compute([], { mystery: 2 }), RangeError);
    assert.throws(() => compute([], null), RangeError);
    assert.throws(() => compute([], []), RangeError);
  }
  for (const source of ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "volume"]) {
    const fixture = changing();
    assert.equal(stochasticRsi(fixture, { source }).k.length, fixture.length);
  }
  assert.throws(() => stochasticRsi([], { source: "code()" }), RangeError);
  assert.throws(() => bullBearPower([{ ...bar(2), high: 1 }]), RangeError);
});
test("bounds and cost guards are explicit before large intermediate allocation", () => {
  for (const length of [0, -1, 1.5, NaN, Infinity, 10001, null]) {
    assert.throws(() => bullBearPower([], { length }), RangeError);
    assert.throws(() => relativeVigorIndex([], { length }), RangeError);
    assert.throws(() => stochasticRsi([], { rsiLength: length }), RangeError);
    assert.throws(() => relativeVolatilityIndex([], { maLength: length }), RangeError);
    assert.throws(() => coppockCurve([], { shortRocLength: length }), RangeError);
  }
  for (const bbMultiplier of [0, 50.01, NaN])
    assert.throws(() => relativeVolatilityIndex([], { bbMultiplier }), RangeError);
  assert.throws(() => relativeVolatilityIndex([], { maType: "SMA;evil" }), RangeError);
  assert.throws(() => relativeVigorIndex([], { offset: 0.1 }), RangeError);
  assert.throws(() => relativeVolatilityIndex([], { offset: 501 }), RangeError);
  for (const [, compute] of cases) assert.throws(() => compute(new Array(1000001)), /bar cap/);
  assert.throws(
    () =>
      relativeVolatilityIndex(Array(1000000).fill(bar(2)), {
        length: 10000,
        maLength: 10000,
        maType: "SMA + Bollinger Bands"
      }),
    /operation cap/
  );
});
test("extended arithmetic preserves representable MAX/subnormal variance, ratios, cancellation", () => {
  const max = Number.MAX_VALUE,
    tiny = Number.MIN_VALUE;
  const deviation = (values) => filters.numbers(filters.deviation(filters.scalars(values), 2));
  assert.equal(deviation([max, -max])[1], max);
  assert.equal(deviation([0, 2 * tiny])[1], tiny);
  for (const scale of [max, 2 * tiny]) {
    const fixture = Array.from({ length: 9 }, (_, i) => ({
      timestamp: i,
      high: scale,
      low: -scale,
      open: -scale,
      close: scale,
      volume: null
    }));
    near(relativeVigorIndex(fixture, { length: 1 }).value.slice(3), Array(6).fill(1));
    near(relativeVigorIndex(fixture, { length: 1 }).signal.slice(6), Array(3).fill(1));
    assert.ok(bullBearPower(fixture).every((v) => Number.isFinite(v) || v === null));
  }
  assert.deepEqual(
    bullBearPower([{ timestamp: 0, high: max, low: max, close: max, open: max, volume: null }]),
    [0]
  );
  near(
    coppockCurve(rows([-max, max, -max]), { wmaLength: 1, longRocLength: 1, shortRocLength: 1 }),
    [null, -400, -400]
  );
  const tinySeries = filters.numbers(
    filters.rolling(filters.scalars(Array(8).fill(tiny)), 4, true)
  );
  assert.deepEqual(tinySeries.slice(3), Array(5).fill(tiny));
  const stoch = stochasticRsi(rows([max, -max, max, -max, max, -max, max]), {
    rsiLength: 2,
    smoothK: 1,
    smoothD: 1
  });
  assert.ok(stoch.k.slice(3).every((v) => v !== null && v >= 0 && v <= 100));
  const vol = relativeVolatilityIndex(rows([max, -max, max, -max, max]), {
    length: 2,
    maType: "None"
  });
  assert.ok(vol.value.slice(1).every((v) => v !== null && v >= 0 && v <= 100));
  assert.equal(numeric.ratio(numeric.scalar(0), numeric.scalar(0)), null);
});
test("all default kernels and per-output first readiness match independent dense oracle", () => {
  const fixture = changing();
  for (const [id, compute, oracle] of cases) {
    same(compute(fixture), oracle(fixture));
    const expected = metadata(id).history.firstPossibleIndex;
    for (const [key, series] of Object.entries(outputs(compute(fixture))))
      assert.equal(
        series.findIndex((v) => v !== null),
        expected[key] === null ? -1 : expected[key],
        `${id}/${key}`
      );
  }
});
test("window trees against direct independent windows for lengths1..17, null carry, orientation", () => {
  const values = Array.from({ length: 151 }, (_, i) =>
    i % 11 === 0 ? null : ((i * 29) % 71) - 35
  );
  for (let length = 1; length <= 17; length++) {
    const source = filters.scalars(values);
    near(filters.numbers(filters.rolling(source, length)), mean(values, length));
    near(filters.numbers(filters.rolling(source, length, true)), mean(values, length, "WMA"));
    near(filters.numbers(filters.deviation(source, length)), mean(values, length, "SD"));
    for (const kind of ["EMA", "RMA"])
      near(filters.numbers(filters.recursive(source, length, kind)), mean(values, length, kind));
  }
});
test("large common offset population variance retains small representable spread", () => {
  const base = 2 ** 100,
    step = 2 ** 48;
  const source = [0, 2, 4, 6, 8].map((i) => base + i * step);
  near(
    filters.numbers(filters.deviation(filters.scalars(source), 3)),
    [null, null, Math.sqrt(8 / 3) * step, Math.sqrt(8 / 3) * step, Math.sqrt(8 / 3) * step],
    1e-14
  );
});
test("flat RSI decay cannot invent stochastic range; stochasticLength1 remains undefined", () => {
  const fixture = rows([33, 31, 14, 16, 16, 29, 12]);
  const result = stochasticRsi(fixture, {
    rsiLength: 3,
    stochasticLength: 5,
    smoothK: 2,
    smoothD: 1
  });
  assert.ok(result.k.slice(0, 6).every((v) => v === null));
  assert.ok(stochasticRsi(changing(), { stochasticLength: 1 }).k.every((v) => v === null));
  assert.deepEqual(metadata("stochastic-rsi", { stochasticLength: 1 }).history.firstPossibleIndex, {
    k: null,
    d: null
  });
  const partial = stochasticRsi(rows([1, 2, 1, 3, 2, 4]), {
    rsiLength: 1,
    stochasticLength: 10,
    smoothK: 1,
    smoothD: 1
  });
  near(partial.k, [null, null, 0, 100, 0, 100]);
  // Unlike both full-10-bars and full-10-known-RSI startup policies.
  assert.equal(
    partial.k.findIndex((v) => v !== null),
    2
  );
});
test("minimum periods, RSI one-sided/flat cases, strict source options and sparse branches", () => {
  for (const rsiLength of [1, 2, 5]) {
    const p = { rsiLength, stochasticLength: 3, smoothK: 1, smoothD: 1 };
    same(stochasticRsi(changing(), p), stochOracle(changing(), p));
    assert.ok(
      stochasticRsi(rows(Array.from({ length: 20 }, (_, i) => i + 1)), p).k.every((v) => v === null)
    );
    assert.ok(
      stochasticRsi(rows(Array.from({ length: 20 }, (_, i) => 21 - i)), p).k.every(
        (v) => v === null
      )
    );
  }
  for (const maType of VOLATILITY_MA_TYPES) {
    const p = { length: 2, maLength: 1, maType };
    same(relativeVolatilityIndex(changing(), p), volatilityOracle(changing(), p));
  }
  const independentGaps = changing().map((b, i) => ({
    ...b,
    open: i % 8 === 0 ? null : b.open,
    low: i % 11 === 0 ? null : b.low
  }));
  same(
    relativeVigorIndex(independentGaps, { length: 2 }),
    vigorOracle(independentGaps, { length: 2 })
  );
});
test("trailing missing rows preserve exact bar alignment and no fabricated price/output", () => {
  for (const [, compute, oracle, p] of cases) {
    const fixture = [...changing(), ...rows([null, null, null, null])];
    same(compute(fixture, p), oracle(fixture, p));
    for (const series of Object.values(outputs(compute(fixture, p)))) {
      assert.equal(series.length, fixture.length);
      assert.ok(series.every((value) => value === null || Number.isFinite(value)));
    }
  }
  for (const [, compute] of cases)
    for (const series of Object.values(outputs(compute(rows([null, null])))))
      assert.deepEqual(series, [null, null]);
});
