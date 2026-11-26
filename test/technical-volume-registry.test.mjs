import {
  EXPECTED_COMPUTED_COUNT,
  EXPECTED_TECHNICAL_COUNT
} from "./technical-registry-expectation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  core,
  load,
  ids,
  defaults,
  candle,
  candles,
  calculate,
  legacyContract
} from "./technical-volume-registration-fixture.mjs";

const catalog = load("model/technical-indicators/catalog.js");
const { filterIndicatorLibrary } = load("model/indicator-library.js");
const math = load("model/technical-indicators/volume-flow/index.js");
const publicIds = [
  "STD;Chaikin_Money_Flow",
  "STD;Chaikin_Oscillator",
  "STD;EFI",
  "STD;EOM",
  "STD;Volume%1Oscillator",
  "STD;Negative_Volume_Index",
  "STD;Positive_Volume_Index"
];
const outputKeys = [
  ["value"],
  ["value"],
  ["value"],
  ["value"],
  ["oscillator", "signal", "histogram"],
  ["index", "average"],
  ["index", "average"]
];
const make = core.createTechnicalIndicatorInstance;
function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) =>
    value === null
      ? assert.equal(actual[i], null, `index ${i}`)
      : assert.ok(
          Number.isFinite(actual[i]) &&
            Math.abs(actual[i] - value) < 3e-12 * Math.max(1, Math.abs(value)),
          `index ${i}: ${actual[i]} != ${value}`
        )
  );
}

test("reviewed definitions retain seven exact volume presets after an unchanged frozen35 contract", () => {
  assert.equal(core.technicalIndicatorDefinitions.length, EXPECTED_COMPUTED_COUNT);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(35, 42).map((item) => item.id),
    ids
  );
  // Recorded directly from 220b227 source, including every definition, default instance and
  // all legacy runtime results on empty/ordinary/no-volume/sparse mathematical fixtures.
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(legacyContract(core)))
      .digest("hex"),
    "a790d945c7ac9ec5504a97ab3d6ac130a1f7539069c9bef98c6cfddc640cdcbc"
  );
  for (const [i, id] of ids.entries()) {
    const definition = core.getTechnicalIndicatorDefinition(id),
      instance = make(id, id);
    assert.deepEqual(instance.params, defaults[id]);
    assert.deepEqual(
      definition.outputs.map((output) => output.id),
      outputKeys[i]
    );
    assert.equal(definition.defaultPane, "pane");
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.parameters));
    assert.ok(definition.parameters.every(Object.isFrozen));
    assert.equal(core.isTechnicalIndicatorInstance(instance), true);
  }
  const choice = core
    .getTechnicalIndicatorDefinition("volume-oscillator")
    .parameters.find((parameter) => parameter.key === "signalAverage");
  assert.deepEqual(choice, {
    key: "signalAverage",
    type: "choice",
    defaultValue: "EMA",
    choices: ["EMA", "SMA"]
  });
  assert.ok(Object.isFrozen(choice.choices));
});

test("catalog retains all127 entries and exposes the reviewed TA set with exact public IDs/search", () => {
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(entries.filter((entry) => entry.available).length, EXPECTED_TECHNICAL_COUNT);
    for (const [i, publicId] of publicIds.entries()) {
      assert.equal(catalog.technicalDefinitionForCatalog(publicId), ids[i]);
      const entry = entries.find((item) => item.id === publicId);
      assert.equal(entry.available, true);
      for (const query of [entry.label, entry.aliases.at(-1)])
        assert.ok(
          filterIndicatorLibrary(entries, "technicals", query).some((item) => item.id === publicId)
        );
    }
    assert.equal(
      catalog.technicalCatalogEntries(locale, "blocked").filter((entry) => entry.available).length,
      0
    );
  }
  for (const id of ["STD;PVO", "STD;NVI", "STD;PVI", "STD;Volume_Oscillator", "constructor"])
    assert.equal(catalog.technicalDefinitionForCatalog(id), undefined);
});

test("runtime CMF, Chaikin, EFI and EOM use independent hand-calculated ledgers", () => {
  const flow = [
    candle(10, 4, 10, 0, 0),
    candle(0, 6, 10, 0, 1),
    candle(5, 8, 10, 0, 2),
    candle(7.5, 10, 10, 0, 3)
  ];
  series(calculate("cmf", flow, { length: 2 }).series.value, [null, -1 / 5, -3 / 7, 5 / 18]);
  series(calculate("chaikin-oscillator", flow, { fastLength: 2, slowLength: 3 }).series.value, [
    0,
    -1,
    -5 / 6,
    11 / 36
  ]);
  series(
    calculate("efi", candles([10, 12, 9, 9, 15], [5, 7, 4, 8, 2]), { length: 2 }).series.value,
    [null, 14, -10 / 3, -10 / 9, 206 / 27]
  );
  const eom = [
    candle(10, 10, 12, 8, 0),
    candle(12, 20, 14, 10, 1),
    candle(11, 10, 13, 9, 2),
    candle(13, 15, 16, 10, 3)
  ];
  series(calculate("eom", eom, { length: 2, divisor: 10 }).series.value, [null, null, 0, 2]);
});

test("runtime PVO explicitly maps all three outputs and both MA choices", () => {
  const input = candles([1, 1, 1, 1], [10, 20, 10, 30]);
  const result = calculate("volume-oscillator", input, {
    fastLength: 2,
    slowLength: 3,
    signalLength: 2
  });
  assert.deepEqual(Object.keys(result.series), ["oscillator", "signal", "histogram"]);
  series(result.series.oscillator, [0, 100 / 9, -20 / 9, 6100 / 459]);
  series(result.series.signal, [0, 200 / 27, 80 / 81, 37960 / 4131]);
  series(result.series.histogram, [0, 100 / 27, -260 / 81, 16940 / 4131]);
  const sma = calculate("volume-oscillator", input, {
    fastLength: 1,
    slowLength: 2,
    signalLength: 2,
    oscillatorAverage: "SMA",
    signalAverage: "SMA"
  });
  series(sma.series.oscillator, [null, 100 / 3, -100 / 3, 50]);
  series(sma.series.signal, [null, null, 0, 25 / 3]);
  series(sma.series.histogram, [null, null, -100 / 3, 125 / 3]);
  assert.equal(sma.historyRequirement.seedPolicy, "window");
});

test("runtime NVI/PVI retain displayed1000 seed and mandatory EMA numeric outputs", () => {
  const input = candles([10, 12, 9, 18, 9], [10, 20, 10, 10, 5]);
  const nvi = calculate("nvi", input, { emaLength: 2 }),
    pvi = calculate("pvi", input, { emaLength: 2 });
  series(nvi.series.index, [1000, 1000, 750, 750, 375]);
  series(nvi.series.average, [1000, 1000, 2500 / 3, 7000 / 9, 13750 / 27]);
  series(pvi.series.index, [1000, 1200, 1200, 1200, 1200]);
  series(pvi.series.average, [1000, 3400 / 3, 10600 / 9, 32200 / 27, 97000 / 81]);
});

test("vendor gate blanks exactly11 new outputs for empty, zero and missing volume history", () => {
  const inputs = [
    [],
    candles([10, 20], [0, 0]),
    candles([10, 20], [null, null]),
    candles([10, 20, 30], [0, null, 0]),
    [candle(null, null, null, null)]
  ];
  for (const input of inputs) {
    let count = 0;
    for (const id of ids) {
      const result = calculate(id, input);
      assert.equal(result.unavailableReason, "volume-unavailable");
      assert.deepEqual(
        result.timestamps,
        input.map((bar) => bar.timestamp)
      );
      for (const values of Object.values(result.series)) {
        count++;
        assert.deepEqual(
          values,
          input.map(() => null)
        );
      }
    }
    assert.equal(count, 11);
  }
  for (const input of [
    candles([10, 20, 30], [0, 1, null]),
    candles([10, 20], [Number.MIN_VALUE, 0]),
    candles([10, 20], [1e308, 1e308])
  ]) {
    for (const id of ids)
      assert.equal(Object.hasOwn(calculate(id, input), "unavailableReason"), false);
  }
  const later = candles([10, 20], [0, 1]);
  assert.deepEqual(calculate("pvi", later.slice(0, 1)).series.index, [null]);
  assert.deepEqual(calculate("pvi", later).series.index, [1000, 2000]);
  for (const value of [NaN, Infinity, -1])
    for (const id of ids) assert.throws(() => calculate(id, candles([10], [value])), RangeError);
});

test("all legacy35 results retain their exact keys and never receive volume availability metadata", () => {
  for (const definition of core.technicalIndicatorDefinitions.slice(0, 35)) {
    for (const input of [candles([10, 20], [0, 0]), candles([10, 20], [null, null])]) {
      const result = core.calculateTechnicalIndicator(make(definition.id, definition.id), input, {
        historicalVolatilityPeriodsPerYear: 365
      });
      assert.equal(Object.hasOwn(result, "unavailableReason"), false);
      assert.deepEqual(Object.keys(result), [
        "instanceId",
        "definitionId",
        "status",
        "timestamps",
        "warmupBars",
        "historyRequirement",
        "series"
      ]);
    }
  }
});

test("reviewed history metadata survives runtime without converting cumulative+EMA to recursive", () => {
  for (const id of ids) {
    const instance = make(id, id),
      expected = math.volumeFlowMetadata(id, instance.params);
    const result = core.calculateTechnicalIndicator(instance, candles([10], [1]));
    assert.deepEqual(
      core.technicalIndicatorHistoryRequirement(instance),
      expected.historyRequirement
    );
    assert.deepEqual(result.historyRequirement, expected.historyRequirement);
    assert.equal(result.warmupBars, expected.warmupBars);
  }
  for (const id of ["chaikin-oscillator", "nvi", "pvi"]) {
    const history = calculate(id, candles([10], [1])).historyRequirement;
    assert.equal(history.kind, "cumulative-plus-ema");
    assert.equal(history.lookbackBars, null);
    assert.equal(history.convergence, "full-input-dependent");
  }
});

test("runtime preserves reviewed smoothing gaps, irregular timestamps, frozen inputs and causal prefixes", () => {
  const input = Object.freeze(
    [
      candle(10, 10, 12, 8, 0),
      candle(12, null, 14, 10, 1),
      candle(null, 3, null, null, 8),
      candle(18, 4, 20, 16, 9),
      candle(9, 2, 11, 7, 20)
    ].map(Object.freeze)
  );
  const before = JSON.stringify(input);
  for (const id of ids) {
    const result = calculate(id, input);
    assert.deepEqual(
      result.timestamps,
      input.map((bar) => bar.timestamp)
    );
    for (const end of [1, 2, 3, 4]) {
      const prefix = calculate(id, input.slice(0, end));
      for (const [key, values] of Object.entries(result.series))
        assert.deepEqual(prefix.series[key], values.slice(0, end));
    }
  }
  assert.equal(JSON.stringify(input), before);
  // Current missing volume must not impose a mask over the reviewed EMA hold.
  series(
    calculate(
      "efi",
      [candle(10, 1, 10, 10, 0), candle(12, 2, 12, 12, 1), candle(14, null, 14, 14, 2)],
      { length: 2 }
    ).series.value,
    [null, 4, 4]
  );
});

test("strict choice/bounds/null/extras/styles validation applies before runtime dispatch", () => {
  for (const id of ids) {
    const instance = make(id, id),
      definition = core.getTechnicalIndicatorDefinition(id);
    for (const parameter of definition.parameters) {
      for (const invalid of [
        null,
        undefined,
        "unknown",
        NaN,
        Infinity,
        ...(parameter.type === "choice"
          ? [0, "ema", "WMA", {}, []]
          : [0, -1, parameter.max + 1, 1.5])
      ]) {
        const candidate = { ...instance, params: { ...instance.params, [parameter.key]: invalid } };
        assert.equal(
          core.isTechnicalIndicatorInstance(candidate),
          false,
          `${id}.${parameter.key}=${String(invalid)}`
        );
        assert.throws(() => core.calculateTechnicalIndicator(candidate, []), RangeError);
      }
      if (parameter.type !== "choice") {
        for (const value of [parameter.min, parameter.max])
          assert.equal(
            core.isTechnicalIndicatorInstance({
              ...instance,
              params: { ...instance.params, [parameter.key]: value }
            }),
            true
          );
      }
    }
    for (const patch of [
      { params: null },
      { params: { ...instance.params, extra: 1 } },
      { historyRequirement: {} },
      { unavailableReason: "volume-unavailable" },
      { styles: null },
      { styles: { wrong: { color: "#123456", width: 1, visible: true } } }
    ])
      assert.equal(core.isTechnicalIndicatorInstance({ ...instance, ...patch }), false);
    const key = definition.outputs[0].id;
    for (const style of [
      { color: null, width: 1, visible: true },
      { color: "#123456", width: 0, visible: true },
      { color: "#123456", width: 1, visible: true, opacity: null },
      { color: "#123456", width: 1, visible: true, lineStyle: "unknown" },
      { color: "#123456", width: 1, visible: true, extra: true }
    ])
      assert.equal(
        core.isTechnicalIndicatorInstance({ ...instance, styles: { [key]: style } }),
        false
      );
  }
});
