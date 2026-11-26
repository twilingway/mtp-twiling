import {
  EXPECTED_COMPUTED_COUNT,
  EXPECTED_TECHNICAL_COUNT
} from "./technical-registry-expectation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url)),
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
const core = load("model/technical-indicators/index.js"),
  make = core.createTechnicalIndicatorInstance;
const catalog = load("model/technical-indicators/catalog.js");
const { filterIndicatorLibrary } = load("model/indicator-library.js");
const { validateBackup } = load("model/backup-format.js"),
  { sanitizeDriveBackup } = load("services/drive/backup.js");
const context = Object.freeze({ historicalVolatilityPeriodsPerYear: 365 });
const defaults = {
  aroon: { length: 14 },
  "aroon-oscillator": { length: 14 },
  dmi: { diLength: 14, adxSmoothing: 14 },
  adx: { diLength: 14, adxSmoothing: 14 },
  vortex: { length: 14 },
  "choppiness-index": { length: 14 }
};
const ids = Object.keys(defaults);
const publicIds = {
  "STD;Aroon": "aroon",
  "STD;Aroon_Oscillator": "aroon-oscillator",
  "STD;DMI": "dmi",
  "STD;Average%1Directional%1Index": "adx",
  "STD;Vortex%1Indicator": "vortex",
  "STD;Choppiness_Index": "choppiness-index"
};
const candles = (values) =>
  values.map(([high, low, close], index) => ({
    timestamp: 1000 + index * 60000,
    open: close,
    high,
    low,
    close,
    volume: null
  }));
const ledger = () =>
  candles([
    [11, 9, 10],
    [14, 12, 13],
    [13, 10, 12],
    [15, 13, 14],
    [12, 10, 11]
  ]);
const calculate = (id, bars, params = {}) =>
  core.calculateTechnicalIndicator(make(id, id, { params }), bars, context);
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

test("reviewed definitions retain all original29 defaults/order and unchanged legacy result shapes", () => {
  const legacy = {
    momentum: { length: 10, source: "close" },
    roc: { length: 9, source: "close" },
    cci: { length: 20, source: "hlc3" },
    "williams-r": { length: 14, source: "close" },
    mfi: { length: 14 },
    obv: {},
    adl: {},
    pvt: {},
    wma: { length: 9, source: "close" },
    vwma: { length: 20, source: "close" },
    dema: { length: 9, source: "close" },
    tema: { length: 9, source: "close" },
    hma: { length: 9, source: "close" },
    smma: { length: 7, source: "close" },
    sma: { length: 20, source: "close" },
    ema: { length: 20, source: "close" },
    rsi: { length: 14, source: "close" },
    macd: { fastLength: 12, slowLength: 26, signalLength: 9, source: "close" },
    "bollinger-bands": { length: 20, multiplier: 2, source: "close" },
    atr: { length: 14 },
    stochastic: { length: 14, smoothK: 3, smoothD: 3 },
    "bollinger-percent-b": { length: 20, multiplier: 2, source: "close" },
    "bollinger-bandwidth": {
      length: 20,
      multiplier: 2,
      source: "close",
      expansionLength: 125,
      contractionLength: 125
    },
    "historical-volatility": { length: 10 },
    "awesome-oscillator": {},
    "balance-of-power": {},
    cmo: { length: 9, source: "close" },
    "ultimate-oscillator": { fastLength: 7, middleLength: 14, slowLength: 28 },
    trix: { length: 18 }
  };
  assert.equal(core.technicalIndicatorDefinitions.length, EXPECTED_COMPUTED_COUNT);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 29).map((item) => item.id),
    Object.keys(legacy)
  );
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(29, 35).map((item) => item.id),
    ids
  );
  for (const [id, params] of Object.entries({ ...legacy, ...defaults })) {
    const instance = make(id, id),
      result = core.calculateTechnicalIndicator(instance, ledger(), context);
    assert.deepEqual(instance.params, params);
    assert.ok(Object.isFrozen(core.getTechnicalIndicatorDefinition(id).parameters));
    assert.equal(Object.hasOwn(result, "alwaysUndefined"), false);
    assert.deepEqual(Object.keys(result), [
      "instanceId",
      "definitionId",
      "status",
      "timestamps",
      "warmupBars",
      "historyRequirement",
      "series"
    ]);
    assert.equal(typeof result.warmupBars, "number");
  }
  assert.throws(
    () => core.calculateTechnicalIndicator(make("historical-volatility", "hv"), ledger()),
    /explicit positive/
  );
  const old = JSON.parse(JSON.stringify(Object.keys(legacy).map((id) => make(id, id))));
  assert.equal(core.isTechnicalIndicatorInstanceList(old), true);
  for (const item of old) assert.deepEqual(item.params, legacy[item.definitionId]);
});

test("exact public IDs and existing English/Russian search aliases expose the reviewed TA set", () => {
  const queries = {
    aroon: "Aroon",
    "aroon-oscillator": "Aroon osc",
    dmi: "DMI",
    adx: "ADX",
    vortex: "VI",
    "choppiness-index": "CHOP"
  };
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(entries.filter((item) => item.available).length, EXPECTED_TECHNICAL_COUNT);
    for (const [publicId, id] of Object.entries(publicIds)) {
      assert.equal(catalog.technicalDefinitionForCatalog(publicId), id);
      assert.equal(entries.find((item) => item.id === publicId).available, true);
      assert.ok(
        filterIndicatorLibrary(entries, "technicals", queries[id]).some(
          (item) => item.id === publicId
        )
      );
    }
    assert.ok(
      filterIndicatorLibrary(entries, "technicals", "Арун").some((item) => item.id === "STD;Aroon")
    );
  }
  for (const wrong of ["STD;ADX", "STD;Vortex", "STD;Choppiness", "constructor", "toString"])
    assert.equal(catalog.technicalDefinitionForCatalog(wrong), undefined);
});

test("Aroon runtime preserves n+1 recency, partial warmup and independent output gaps", () => {
  const input = candles([
    [5, 1, 3],
    [4, 2, 3],
    [3, 0, 1],
    [6, 3, 4],
    [5, 2, 3]
  ]);
  const result = calculate("aroon", input, { length: 2 });
  series(result.series.up, [100, 50, 0, 100, 50]);
  series(result.series.down, [100, 50, 100, 50, 0]);
  series(calculate("aroon-oscillator", input, { length: 2 }).series.value, [0, 0, -100, 50, 50]);
  const partial = candles([
    [5, 1, 3],
    [5, 1, 3],
    [4, 2, 3]
  ]);
  partial[1] = { ...partial[1], high: null };
  series(calculate("aroon", partial, { length: 2 }).series.up, [100, null, 0]);
  series(calculate("aroon", partial, { length: 2 }).series.down, [100, 100, 50]);
  assert.equal(result.warmupBars, 1);
  assert.equal(result.historyRequirement.lookbackBars, 3);
});

test("DMI and standalone ADX keep rational Wilder/TR/fixnan golden values", () => {
  const result = calculate("dmi", ledger(), { diLength: 2, adxSmoothing: 2 });
  series(result.series.plusDI, [null, null, 300 / 7, 700 / 13, 700 / 29]);
  series(result.series.minusDI, [null, null, 200 / 7, 200 / 13, 1400 / 29]);
  series(result.series.adx, [null, null, null, 340 / 9, 320 / 9]);
  series(calculate("adx", ledger(), { diLength: 2, adxSmoothing: 2 }).series.value, [
    null,
    null,
    null,
    340 / 9,
    320 / 9
  ]);
  const known = candles([
    [11, 9, 10],
    [12, 10, 11],
    [11, 11, 11]
  ]);
  series(calculate("dmi", known, { diLength: 1, adxSmoothing: 1 }).series.plusDI, [null, 50, 50]);
  series(calculate("adx", known, { diLength: 1, adxSmoothing: 1 }).series.value, [null, 100, 100]);
  const flat = candles(new Array(4).fill([5, 5, 5]));
  assert.ok(
    Object.values(calculate("dmi", flat, { diLength: 1, adxSmoothing: 1 }).series).every((values) =>
      values.every((value) => value === null)
    )
  );
});

test("Vortex/CHOP runtime keeps ATR1 first-bar behavior and unclipped logarithmic values", () => {
  const input = candles([
    [3, 1, 2],
    [5, 2, 4],
    [4, 1, 2],
    [6, 3, 5]
  ]);
  const vi = calculate("vortex", input, { length: 2 });
  series(vi.series.plusVI, [null, null, 1, 1]);
  series(vi.series.minusVI, [null, null, 5 / 6, 5 / 7]);
  series(calculate("vortex", input, { length: 3 }).series.plusVI, [null, null, null, 11 / 10]);
  series(calculate("choppiness-index", input, { length: 2 }).series.value, [
    null,
    (100 * Math.log10(5 / 4)) / Math.log10(2),
    (100 * Math.log10(3 / 2)) / Math.log10(2),
    (100 * Math.log10(7 / 5)) / Math.log10(2)
  ]);
  const priceGap = candles([
    [101, 99, 100],
    [1, 0, 0.5],
    [1, 0, 0.5]
  ]);
  series(calculate("choppiness-index", priceGap, { length: 2 }).series.value.slice(2), [
    (100 * Math.log10(101)) / Math.log10(2)
  ]);
});

test("CHOP length1 is valid with null warmup and an explicit runtime-only true flag", () => {
  const instance = make("choppiness-index", "chop-one", { params: { length: 1 } });
  assert.equal(core.isTechnicalIndicatorInstance(instance), true);
  assert.equal(
    core.isTechnicalIndicatorInstanceList([
      instance,
      ...ids.filter((id) => id !== "choppiness-index").map((id) => make(id, id))
    ]),
    true
  );
  for (const input of [[], ledger(), candles([[5, 5, 5]])]) {
    const result = core.calculateTechnicalIndicator(instance, input);
    assert.equal(result.warmupBars, null);
    assert.equal(result.alwaysUndefined, true);
    assert.equal(result.status, "computed");
    assert.ok(result.series.value.every((value) => value === null));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
  assert.equal(core.technicalIndicatorWarmup(instance), null);
  assert.equal(core.isTechnicalIndicatorInstance({ ...instance, alwaysUndefined: true }), false);
  assert.equal(core.isTechnicalIndicatorInstance({ ...instance, warmupBars: null }), false);
  assert.throws(
    () => make("choppiness-index", "bad", { params: { length: 1, alwaysUndefined: true } }),
    /Invalid/
  );
  assert.equal(Object.hasOwn(instance, "alwaysUndefined"), false);
  const normal = calculate("choppiness-index", ledger(), { length: 2 });
  assert.equal(normal.warmupBars, 2);
  assert.equal(Object.hasOwn(normal, "alwaysUndefined"), false);
});

test("history describes full-input Wilder seeding and CHOP preceding-close lookback without EMA substitution", () => {
  for (const id of ["dmi", "adx"]) {
    const result = calculate(id, []);
    assert.equal(result.warmupBars, 28);
    assert.deepEqual(result.historyRequirement, {
      kind: "recursive",
      lookbackBars: null,
      seedBars: 28,
      seedPolicy: "adjacent-change-wilder",
      convergence: "full-input-dependent"
    });
  }
  const expected = {
    aroon: [1, 15],
    "aroon-oscillator": [1, 15],
    vortex: [15, 15],
    "choppiness-index": [14, 15]
  };
  for (const [id, [warmup, lookback]] of Object.entries(expected)) {
    const result = calculate(id, []);
    assert.equal(result.warmupBars, warmup);
    assert.deepEqual(result.historyRequirement, {
      kind: "finite",
      lookbackBars: lookback,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    });
  }
});

test("exact parameter/output guards reject unknown source, code, metadata, unsafe accessors and invalid bounds", () => {
  for (const id of ids) {
    const keys = id === "dmi" || id === "adx" ? ["diLength", "adxSmoothing"] : ["length"],
      minimum = id === "vortex" ? 2 : 1;
    for (const key of keys) {
      assert.equal(make(id, id, { params: { [key]: minimum } }).params[key], minimum);
      assert.equal(make(id, id, { params: { [key]: 10000 } }).params[key], 10000);
      for (const invalid of [0, -1, minimum - 1, 1.5, 10001, NaN, Infinity, "14", null])
        assert.throws(() => make(id, id, { params: { [key]: invalid } }), /Invalid/);
    }
    assert.throws(() => make(id, id, { params: { source: "close" } }), /Invalid/);
    assert.throws(() => make(id, id, { params: { code: "bad" } }), /Invalid/);
    let invoked = false;
    const params = { ...defaults[id] };
    Object.defineProperty(params, "injected", {
      get() {
        invoked = true;
        return 1;
      }
    });
    assert.equal(core.isTechnicalIndicatorInstance({ ...make(id, id), params }), false);
    assert.equal(invoked, false);
    assert.equal(
      core.isTechnicalIndicatorInstance({
        ...make(id, id),
        styles: { bogus: { color: "#123456", width: 1, visible: true } }
      }),
      false
    );
  }
  assert.throws(() => make("vortex", "invalid-one", { params: { length: 1 } }), /Invalid/);
  assert.throws(() => make("dmi", "wrong-key", { params: { length: 14 } }), /Invalid/);
  assert.throws(() => make("choppiness-index", "offset", { params: { offset: 1 } }), /Invalid/);
});

test("all six customized source instances roundtrip JSON; four current-key shapes pass Drive until root adds two keys", () => {
  const instances = ids.map((id, order) =>
    make(id, `portable-${id}`, {
      order,
      params:
        id === "dmi" || id === "adx"
          ? { diLength: 2, adxSmoothing: 3 }
          : { length: id === "choppiness-index" ? 1 : 2 },
      styles: Object.fromEntries(
        core
          .getTechnicalIndicatorDefinition(id)
          .outputs.map((output) => [
            output.id,
            { color: "#123456", width: 2, visible: true, opacity: 0.4, lineStyle: "dashed" }
          ])
      )
    })
  );
  const input = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: { technicalIndicators: instances },
    drawings: [],
    images: []
  };
  const restored = validateBackup(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(restored.layout.technicalIndicators, instances);
  assert.equal(core.isTechnicalIndicatorInstanceList(restored.layout.technicalIndicators), true);
  for (const instance of restored.layout.technicalIndicators)
    assert.deepEqual(
      core.calculateTechnicalIndicator(instance, ledger()),
      core.calculateTechnicalIndicator(
        instances.find((item) => item.id === instance.id),
        ledger()
      )
    );
  // Root owns the future diLength/adxSmoothing Drive allowlist extension; no aliases are substituted here.
  const compatible = {
    ...input,
    layout: {
      technicalIndicators: instances.filter((item) => !["dmi", "adx"].includes(item.definitionId))
    }
  };
  assert.deepEqual(
    sanitizeDriveBackup(JSON.parse(JSON.stringify(compatible))).layout.technicalIndicators,
    compatible.layout.technicalIndicators
  );
  assert.equal(
    Object.hasOwn(
      restored.layout.technicalIndicators.find((item) => item.definitionId === "choppiness-index"),
      "alwaysUndefined"
    ),
    false
  );
});

test("runtime keeps every output aligned, causal and immutable through real gaps and timestamp holes", () => {
  const source = ledger();
  source[2] = { ...source[2], open: null, high: null, low: null, close: null };
  source[3] = { ...source[3], timestamp: source[3].timestamp + 86400000 };
  source[4] = { ...source[4], timestamp: source[4].timestamp + 86400000 };
  const input = Object.freeze(source.map(Object.freeze)),
    before = JSON.stringify(input);
  for (const id of ids) {
    const params = id === "dmi" || id === "adx" ? { diLength: 2, adxSmoothing: 2 } : { length: 2 };
    const full = calculate(id, input, params),
      prefix = calculate(id, input.slice(0, 3), params);
    assert.deepEqual(
      Object.keys(full.series),
      core.getTechnicalIndicatorDefinition(id).outputs.map((output) => output.id)
    );
    for (const [key, values] of Object.entries(full.series)) {
      assert.equal(values.length, input.length);
      assert.equal(values[2], null);
      assert.ok(values.every((value) => value === null || Number.isFinite(value)));
      assert.deepEqual(values.slice(0, 3), prefix.series[key]);
    }
    assert.deepEqual(
      full.timestamps,
      input.map((item) => item.timestamp)
    );
  }
  assert.equal(JSON.stringify(input), before);
});
