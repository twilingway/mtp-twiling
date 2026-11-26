import test from "node:test";
import assert from "node:assert/strict";
import {
  core,
  load,
  ids,
  defaults,
  make,
  calculate,
  candles,
  candle,
  series,
  contractHash,
  FROZEN42_SHA256
} from "./technical-state-oscillator-fixture.mjs";
const catalog = load("model/technical-indicators/catalog.js");
const math = load("model/technical-indicators/trend-state/index.js");
const publicIds = ["STD;True%1Strength%1Indicator", "STD;Know_Sure_Thing", "STD;Fisher_Transform"];

test("append-only45 definitions preserve independent frozen42 Git contract exactly", () => {
  assert.equal(core.technicalIndicatorDefinitions.length, 45);
  assert.equal(contractHash(core), FROZEN42_SHA256);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(42).map((d) => d.id),
    ids
  );
  ids.forEach((id, i) => {
    const definition = core.getTechnicalIndicatorDefinition(id),
      instance = make(id, id);
    assert.deepEqual(instance.params, defaults[id]);
    assert.equal(instance.pane.kind, "pane");
    assert.equal(definition.defaultPane, "pane");
    assert.deepEqual(
      definition.outputs.map((o) => o.id),
      ["value", id === "fisher-transform" ? "trigger" : "signal"]
    );
    assert.ok(definition.outputs.every((o) => o.kind === "line"));
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.parameters));
    assert.equal(catalog.technicalDefinitionForCatalog(publicIds[i]), id);
  });
});
test("catalog46 available TA and deferred state renderers remain unavailable", () => {
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(entries.filter((e) => e.available).length, 46);
    for (const publicId of publicIds)
      assert.equal(entries.find((e) => e.id === publicId).available, true);
    for (const id of ["STD;Supertrend", "STD;PSAR", "STD;DPO", "STD;Trend%1Strength%1Index"]) {
      assert.equal(catalog.technicalDefinitionForCatalog(id), undefined);
      assert.equal(entries.find((e) => e.id === id).available, false);
    }
    assert.equal(
      catalog.technicalCatalogEntries(locale, "blocked").filter((e) => e.available).length,
      0
    );
  }
});
test("TSI runtime independent double EMA ledger and exact recursive seed", () => {
  const result = calculate("tsi", candles([10, 12, 11, 14]), {
    longLength: 3,
    shortLength: 3,
    signalLength: 3
  });
  series(result.series.value, [null, 100, 500 / 7, 75]);
  series(result.series.signal, [null, 100, 600 / 7, 1125 / 14]);
  assert.equal(result.warmupBars, 2);
  assert.deepEqual(result.historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: 2,
    seedPolicy: "first-known-ema-chain",
    convergence: "full-input-dependent"
  });
});
test("KST flat scalar lengths bridge only into math options and preserve finite dense history", () => {
  const p = {
    roc1Length: 1,
    roc2Length: 1,
    roc3Length: 1,
    roc4Length: 1,
    sma1Length: 1,
    sma2Length: 1,
    sma3Length: 1,
    sma4Length: 1,
    signalLength: 2
  };
  const result = calculate("kst", candles([1, 2, 4, 2]), p);
  series(result.series.value, [null, 1000, 1000, -500]);
  series(result.series.signal, [null, null, 1000, 250]);
  assert.equal(result.warmupBars, 2);
  assert.deepEqual(result.historyRequirement, {
    kind: "finite",
    lookbackBars: 3,
    seedPolicy: "known-observation-window",
    convergence: "exact-after-dense-lookback"
  });
  const defaultResult = calculate("kst", candles(Array.from({ length: 60 }, (_, i) => 2 ** i)));
  assert.equal(defaultResult.warmupBars, 45);
  assert.equal(defaultResult.historyRequirement.lookbackBars, 53);
  series(defaultResult.series.value.slice(44), Array(16).fill(429817957400));
});
test("Fisher runtime hand log ledger, trigger and length1 result-only nullable state", () => {
  const a = 0.5 * Math.log(133 / 67),
    b = 0.5 * Math.log(15511 / 4489) + 0.5 * a;
  const result = calculate("fisher-transform", candles([1, 2, 3]));
  series(result.series.value, [null, a, b]);
  series(result.series.trigger, [null, null, a]);
  assert.equal(result.historyRequirement.kind, "recursive");
  assert.equal(result.historyRequirement.seedPolicy, "partial-extrema-explicit-previous-state-nz");
  assert.equal(result.historyRequirement.seedBars, 2);
  const instance = make("fisher-transform", "fisher1", { params: { length: 1 } });
  const undefinedResult = core.calculateTechnicalIndicator(instance, candles([1, 2, 3]));
  assert.ok(
    Object.values(undefinedResult.series).every((values) => values.every((v) => v === null))
  );
  assert.equal(undefinedResult.warmupBars, null);
  assert.equal(undefinedResult.alwaysUndefined, true);
  assert.deepEqual(undefinedResult.historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: null,
    seedPolicy: "partial-extrema-explicit-previous-state-nz",
    convergence: "full-input-dependent"
  });
  assert.equal(core.technicalIndicatorWarmup(instance), null);
  assert.deepEqual(
    core.technicalIndicatorHistoryRequirement(instance),
    undefinedResult.historyRequirement
  );
  assert.equal(Object.hasOwn(instance, "alwaysUndefined"), false);
});
test("runtime preserves reviewed gaps/trigger, prefix causality, timestamps and no fake zeros", () => {
  const bars = Object.freeze(
    [
      candle(1, null, 1, 1, 0),
      candle(2, null, 2, 2, 1),
      candle(null, null, null, null, 2),
      candle(4, null, 4, 4, 3),
      candle(8, null, 8, 8, 4)
    ].map(Object.freeze)
  );
  const expected = {
    tsi: math.tsi(bars),
    kst: math.kst(bars),
    "fisher-transform": math.fisherTransform(bars)
  };
  const before = JSON.stringify(bars);
  for (const id of ids) {
    const result = calculate(id, bars);
    assert.deepEqual(result.series, expected[id]);
    assert.deepEqual(
      result.timestamps,
      bars.map((b) => b.timestamp)
    );
    for (let n = 0; n <= bars.length; n++) {
      const prefix = calculate(id, bars.slice(0, n));
      for (const [key, line] of Object.entries(result.series))
        assert.deepEqual(prefix.series[key], line.slice(0, n));
    }
    assert.equal(Object.hasOwn(result, "unavailableReason"), false);
  }
  assert.ok(calculate("tsi", candles(Array(60).fill(0))).series.value.every((v) => v === null));
  assert.ok(
    calculate("fisher-transform", candles(Array(60).fill(0))).series.value.every((v) => v === null)
  );
  assert.ok(calculate("kst", candles(Array(60).fill(0))).series.value.every((v) => v === null));
  assert.equal(JSON.stringify(bars), before);
  const overflow = candles([1e308, -1e308, 1, 2]);
  for (const id of ids)
    for (const line of Object.values(calculate(id, overflow).series))
      assert.ok(line.every((v) => v === null || Number.isFinite(v)));
});
test("root validator rejects missing/null/array/unknown/extra scalar params and styles before dispatch", () => {
  for (const id of ids) {
    const instance = make(id, id),
      definition = core.getTechnicalIndicatorDefinition(id);
    const invalid = [
      { ...instance, params: null },
      { ...instance, params: [] },
      { ...instance, params: { ...instance.params, rocLengths: [1, 2, 3, 4] } },
      { ...instance, styles: null },
      { ...instance, styles: [] },
      { ...instance, alwaysUndefined: true },
      { ...instance, historyRequirement: {} },
      { ...instance, styles: { unknown: { color: "#123456", width: 1, visible: true } } }
    ];
    for (const p of definition.parameters) {
      for (const value of [null, undefined, [], {}, "2", NaN, Infinity, 0, -1, 1.5, 10001])
        invalid.push({ ...instance, params: { ...instance.params, [p.key]: value } });
      const missing = { ...instance.params };
      delete missing[p.key];
      invalid.push({ ...instance, params: missing });
      assert.equal(
        core.isTechnicalIndicatorInstance({
          ...instance,
          params: { ...instance.params, [p.key]: 10000 }
        }),
        true
      );
    }
    for (const patch of [
      { color: "red" },
      { width: null },
      { width: 5 },
      { opacity: null },
      { opacity: 2 },
      { lineStyle: "unknown" },
      { extra: 1 }
    ])
      invalid.push({
        ...instance,
        styles: { value: { color: "#123456", width: 1, visible: true, ...patch } }
      });
    for (const candidate of invalid) {
      assert.equal(core.isTechnicalIndicatorInstance(candidate), false);
      assert.throws(() => core.calculateTechnicalIndicator(candidate, []), RangeError);
    }
  }
});
