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
const { validateBackup } = load("model/backup-format.js");
const { sanitizeDriveBackup } = load("services/drive/backup.js");
const context = Object.freeze({ historicalVolatilityPeriodsPerYear: 365 });
const defaults = {
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
const publicIds = {
  "STD;Bollinger_Bands_B": "bollinger-percent-b",
  "STD;Bollinger_Bands_Width": "bollinger-bandwidth",
  "STD;Historical_Volatility": "historical-volatility",
  "STD;Awesome_Oscillator": "awesome-oscillator",
  "STD;Balance%1of%1Power": "balance-of-power",
  "STD;Chande_Momentum_Oscillator": "cmo",
  "STD;Ultimate_Oscillator": "ultimate-oscillator",
  "STD;TRIX": "trix"
};
const ids = Object.keys(defaults);
const bars = (prices) =>
  prices.map((close, index) => ({
    timestamp: 1000 + index * 60000,
    open: close,
    high: close === null ? null : close + 1,
    low: close === null ? null : close - 1,
    close,
    volume: null
  }));
const calculate = (id, input, params = {}, calculationContext = context) =>
  core.calculateTechnicalIndicator(make(id, id, { params }), input, calculationContext);
function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else
      assert.ok(
        Number.isFinite(actual[index]) &&
          Math.abs(actual[index] - value) <= 1e-10 * Math.max(1, Math.abs(value)),
        `index ${index}: ${actual[index]} != ${value}`
      );
  });
}

test("45 immutable definitions preserve the original21 ordering and all legacy defaults", () => {
  const old = {
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
    stochastic: { length: 14, smoothK: 3, smoothD: 3 }
  };
  assert.equal(core.technicalIndicatorDefinitions.length, 45);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 21).map((item) => item.id),
    Object.keys(old)
  );
  for (const [id, expected] of Object.entries({ ...old, ...defaults })) {
    assert.deepEqual(make(id, id).params, expected);
    assert.ok(Object.isFrozen(core.getTechnicalIndicatorDefinition(id).parameters));
  }
  const restored = JSON.parse(
    JSON.stringify(Object.keys(old).map((id, order) => make(id, id, { order })))
  );
  assert.equal(core.isTechnicalIndicatorInstanceList(restored), true);
  for (const instance of restored) assert.deepEqual(instance.params, old[instance.definitionId]);
});

test("exact eight public IDs retain42 plus Volume availability with no aliases treated as implementations", () => {
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(entries.filter((entry) => entry.available).length, 46);
    for (const [publicId, id] of Object.entries(publicIds)) {
      assert.equal(catalog.technicalDefinitionForCatalog(publicId), id);
      assert.equal(entries.find((entry) => entry.id === publicId).available, true);
    }
  }
  for (const unknown of ["STD;HV", "STD;BOP", "STD;CMO", "STD;Balance_of_Power", "constructor"])
    assert.equal(catalog.technicalDefinitionForCatalog(unknown), undefined);
});

test("golden BBpercentB and all three BBW outputs use actual configured numeric windows", () => {
  const input = bars([1, 3, 5, 9]);
  series(calculate("bollinger-percent-b", input, { length: 2, multiplier: 1 }).series.value, [
    null,
    1,
    1,
    1
  ]);
  const result = calculate("bollinger-bandwidth", input, {
    length: 2,
    multiplier: 1,
    expansionLength: 2,
    contractionLength: 2
  });
  series(result.series.value, [null, 100, 50, 400 / 7]);
  series(result.series.highestExpansion, [null, 100, 100, 400 / 7]);
  series(result.series.lowestContraction, [null, 100, 50, 50]);
  assert.deepEqual(Object.keys(result.series), ["value", "highestExpansion", "lowestContraction"]);
  const open = input.map((item) => ({ ...item, open: item.close - 1 }));
  series(calculate("bollinger-percent-b", open, { length: 2, source: "open" }).series.value, [
    null,
    0.75,
    0.75,
    0.75
  ]);
});

test("HV requires explicit positive context and the same persisted instance follows each supplied timeframe scale", () => {
  const instance = make("historical-volatility", "hv", { params: { length: 2 } });
  const input = bars([1, Math.E, Math.exp(3), Math.exp(6)]),
    before = JSON.stringify(instance);
  series(core.calculateTechnicalIndicator(instance, input, context).series.value, [
    null,
    null,
    50 * Math.sqrt(365),
    50 * Math.sqrt(365)
  ]);
  series(
    core.calculateTechnicalIndicator(instance, input, {
      historicalVolatilityPeriodsPerYear: 365 / 7
    }).series.value,
    [null, null, 50 * Math.sqrt(365 / 7), 50 * Math.sqrt(365 / 7)]
  );
  assert.equal(JSON.stringify(instance), before);
  for (const invalid of [
    undefined,
    null,
    {},
    { historicalVolatilityPeriodsPerYear: 0 },
    { historicalVolatilityPeriodsPerYear: -1 },
    { historicalVolatilityPeriodsPerYear: NaN },
    { historicalVolatilityPeriodsPerYear: Infinity },
    { historicalVolatilityPeriodsPerYear: "365" }
  ])
    assert.throws(
      () => core.calculateTechnicalIndicator(instance, input, invalid),
      /explicit positive.*context/
    );
  assert.throws(
    () => make("historical-volatility", "invalid", { params: { periodsPerYear: 365 } }),
    /Invalid/
  );
  assert.equal(core.isTechnicalIndicatorInstance({ ...instance, context }), false);
  for (const id of ids.filter((id) => id !== "historical-volatility"))
    assert.equal(core.calculateTechnicalIndicator(make(id, id), []).status, "computed");
});

test("runtime golden AO, BOP, CMO, UO and TRIX retain their independent formulas and scales", () => {
  const ao = calculate(
    "awesome-oscillator",
    bars([...new Array(29).fill(0), ...new Array(5).fill(10), 0])
  );
  series(ao.series.value.slice(33), [145 / 17, 111 / 17]);
  assert.equal(
    core.getTechnicalIndicatorDefinition("awesome-oscillator").outputs[0].kind,
    "histogram"
  );
  const bop = [
    { timestamp: 1, open: 2, high: 6, low: 0, close: 5, volume: null },
    { timestamp: 2, open: 5, high: 6, low: 0, close: 2, volume: null }
  ];
  series(calculate("balance-of-power", bop).series.value, [0.5, -0.5]);
  series(calculate("cmo", bars([10, 12, 11, 14, 12]), { length: 3 }).series.value, [
    null,
    null,
    null,
    200 / 3,
    0
  ]);
  const uo = [
    [10, 0, 5],
    [10, 2, 8],
    [12, 4, 6],
    [9, 1, 3]
  ].map(([high, low, close], index) => ({
    timestamp: index + 1,
    open: close,
    high,
    low,
    close,
    volume: null
  }));
  series(
    calculate("ultimate-oscillator", uo, { fastLength: 1, middleLength: 2, slowLength: 3 }).series
      .value,
    [null, null, null, 575 / 21]
  );
  series(calculate("trix", bars([1, Math.E, Math.exp(2)]), { length: 2 }).series.value, [
    null,
    80000 / 27,
    160000 / 27
  ]);
});

test("warmup and finite history include BBW extrema; TRIX retains recursive logEMA dependence", () => {
  const warmups = {
    "bollinger-percent-b": 20,
    "bollinger-bandwidth": 20,
    "historical-volatility": 11,
    "awesome-oscillator": 34,
    "balance-of-power": 1,
    cmo: 10,
    "ultimate-oscillator": 29,
    trix: 2
  };
  for (const [id, warmup] of Object.entries(warmups)) {
    const result = calculate(id, []);
    assert.equal(result.warmupBars, warmup);
    assert.deepEqual(result.timestamps, []);
    assert.ok(Object.values(result.series).every((values) => values.length === 0));
  }
  assert.equal(calculate("bollinger-bandwidth", []).historyRequirement.lookbackBars, 144);
  assert.deepEqual(calculate("trix", []).historyRequirement, {
    kind: "recursive",
    lookbackBars: null,
    seedBars: 1,
    seedPolicy: "first-value-ema-chain",
    convergence: "full-input-dependent"
  });
  assert.equal(
    calculate("ultimate-oscillator", [], { fastLength: 28, middleLength: 2, slowLength: 7 })
      .warmupBars,
    29
  );
});

test("strict instance validation enforces new period keys, exact outputs, source guards and bounds", () => {
  const periodKeys = {
    "bollinger-percent-b": ["length"],
    "bollinger-bandwidth": ["length", "expansionLength", "contractionLength"],
    "historical-volatility": ["length"],
    cmo: ["length"],
    "ultimate-oscillator": ["fastLength", "middleLength", "slowLength"],
    trix: ["length"]
  };
  for (const [id, keys] of Object.entries(periodKeys))
    for (const key of keys) {
      assert.equal(make(id, id, { params: { [key]: 1 } }).params[key], 1);
      assert.equal(make(id, id, { params: { [key]: 10000 } }).params[key], 10000);
      for (const invalid of [0, -1, 1.5, 10001, NaN, Infinity, "20"])
        assert.throws(() => make(id, id, { params: { [key]: invalid } }), /Invalid/);
    }
  for (const id of ["bollinger-percent-b", "bollinger-bandwidth"]) {
    assert.equal(make(id, id, { params: { multiplier: 0.001 } }).params.multiplier, 0.001);
    assert.equal(make(id, id, { params: { multiplier: 50 } }).params.multiplier, 50);
    for (const multiplier of [0, 0.0009, 50.001, NaN, "2"])
      assert.throws(() => make(id, id, { params: { multiplier } }), /Invalid/);
  }
  for (const id of ["bollinger-percent-b", "bollinger-bandwidth", "cmo"]) {
    for (const source of core.PRICE_SOURCES)
      assert.equal(make(id, id, { params: { source } }).params.source, source);
    assert.throws(() => make(id, id, { params: { source: "eval(close)" } }), /Invalid/);
  }
  for (const id of [
    "historical-volatility",
    "awesome-oscillator",
    "balance-of-power",
    "ultimate-oscillator",
    "trix"
  ])
    assert.throws(() => make(id, id, { params: { source: "close" } }), /Invalid/);
  const bbw = make("bollinger-bandwidth", "bbw");
  assert.equal(
    core.isTechnicalIndicatorInstance({
      ...bbw,
      styles: { bogus: { color: "#123456", width: 1, visible: true } }
    }),
    false
  );
  for (const id of ids) {
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
  }
});

test("all eight source JSON instances roundtrip strictly; six existing-key shapes also pass current Drive sanitizer", () => {
  const customized = {
    "bollinger-percent-b": { length: 2, multiplier: 1, source: "hl2" },
    "bollinger-bandwidth": {
      length: 2,
      multiplier: 1,
      source: "open",
      expansionLength: 3,
      contractionLength: 4
    },
    "historical-volatility": { length: 2 },
    cmo: { length: 3, source: "open" },
    "ultimate-oscillator": { fastLength: 1, middleLength: 2, slowLength: 3 },
    trix: { length: 2 }
  };
  const instances = ids.map((id, order) =>
    make(id, `portable-${id}`, {
      params: customized[id] ?? {},
      order,
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
  for (const instance of restored.layout.technicalIndicators)
    assert.deepEqual(
      core.calculateTechnicalIndicator(instance, bars([1, 2, 3]), context),
      core.calculateTechnicalIndicator(
        instances.find((entry) => entry.id === instance.id),
        bars([1, 2, 3]),
        context
      )
    );
  // Root owns the separate expansionLength/contractionLength/middleLength Drive allowlist integration.
  const compatible = {
    ...input,
    layout: {
      technicalIndicators: instances.filter(
        (item) => !["bollinger-bandwidth", "ultimate-oscillator"].includes(item.definitionId)
      )
    }
  };
  assert.deepEqual(
    sanitizeDriveBackup(JSON.parse(JSON.stringify(compatible))).layout.technicalIndicators,
    compatible.layout.technicalIndicators
  );
});

test("all outputs preserve real source gaps, positivity domains, alignment and frozen input", () => {
  const input = Object.freeze(bars([1, 2, null, 4, 5]).map(Object.freeze));
  const before = JSON.stringify(input);
  for (const id of ids) {
    const result = calculate(id, input);
    assert.ok(
      Object.values(result.series).every(
        (values) =>
          values.length === 5 &&
          values[2] === null &&
          values.every((value) => value === null || Number.isFinite(value))
      )
    );
    assert.deepEqual(
      result.timestamps,
      input.map((item) => item.timestamp)
    );
  }
  assert.equal(JSON.stringify(input), before);
  series(calculate("trix", bars([1, 0, -1, Math.E]), { length: 1 }).series.value, [
    null,
    null,
    null,
    10000
  ]);
  series(calculate("historical-volatility", bars([1, 0, -1, Math.E]), { length: 1 }).series.value, [
    null,
    null,
    null,
    null
  ]);
});
