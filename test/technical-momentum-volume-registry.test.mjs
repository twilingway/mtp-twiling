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
const core = load("model/technical-indicators/index.js");
const catalog = load("model/technical-indicators/catalog.js");
const { validateBackup } = load("model/backup-format.js");
const { sanitizeDriveBackup } = load("services/drive/backup.js");
const make = core.createTechnicalIndicatorInstance;
const expected = {
  momentum: { length: 10, source: "close" },
  roc: { length: 9, source: "close" },
  cci: { length: 20, source: "hlc3" },
  "williams-r": { length: 14, source: "close" },
  mfi: { length: 14 },
  obv: {},
  adl: {},
  pvt: {}
};
const ids = Object.keys(expected);
const catalogIds = {
  "STD;Momentum": "momentum",
  "STD;ROC": "roc",
  "STD;CCI": "cci",
  "STD;Willams_R": "williams-r",
  "STD;Money_Flow": "mfi",
  "STD;On_Balance_Volume": "obv",
  "STD;Accumulation_Distribution": "adl",
  "STD;Price_Volume_Trend": "pvt"
};
const bars = (closes, volumes = closes.map(() => 1)) =>
  closes.map((close, index) => ({
    timestamp: 1000 + index * 60000,
    open: close,
    high: close === null ? null : close + 1,
    low: close === null ? null : close - 1,
    close,
    volume: volumes[index]
  }));
function series(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    if (value === null) assert.equal(actual[index], null, `index ${index}`);
    else
      assert.ok(
        Number.isFinite(actual[index]) && Math.abs(actual[index] - value) < 1e-10,
        `index ${index}: ${actual[index]} != ${value}`
      );
  });
}

test("all47 immutable definitions create independent instances; eight momentum-volume defaults are exact", () => {
  assert.equal(core.technicalIndicatorDefinitions.length, 47);
  assert.equal(new Set(core.technicalIndicatorDefinitions.map((item) => item.id)).size, 47);
  for (const id of ids) {
    const instance = make(id, `first-${id}`),
      second = make(id, `second-${id}`);
    assert.deepEqual(instance.params, expected[id]);
    assert.deepEqual(instance.pane, { kind: "pane", id: `first-${id}` });
    assert.equal(core.isTechnicalIndicatorInstance(instance), true);
    assert.notEqual(instance.params, second.params);
    const definition = core.getTechnicalIndicatorDefinition(id);
    assert.deepEqual(
      definition.outputs.map((item) => item.id),
      ["value"]
    );
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.parameters));
    assert.ok(definition.references[0].startsWith("https://pine-facade.tradingview.com/"));
  }
  assert.equal(core.isTechnicalIndicatorInstanceList(ids.map((id) => make(id, id))), true);
});

test("exact public catalog IDs expose47 plus Volume and CCI describes only its available core output", () => {
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(entries.filter((entry) => entry.available).length, 48);
    for (const [publicId, definitionId] of Object.entries(catalogIds)) {
      assert.equal(catalog.technicalDefinitionForCatalog(publicId), definitionId);
      assert.equal(entries.find((entry) => entry.id === publicId).available, true);
    }
    const cci = entries.find((entry) => entry.id === "STD;CCI");
    assert.match(
      cci.description,
      locale === "ru" ? /Основная линия.*без.*сглаживания/ : /Core CCI.*not included/
    );
  }
  for (const wrong of [
    "STD;Williams_R",
    "STD;MFI",
    "STD;OBV",
    "STD;PVT",
    "constructor",
    "toString"
  ])
    assert.equal(catalog.technicalDefinitionForCatalog(wrong), undefined);
});

test("runtime uses selected sources and HLC3 CCI default with independently calculated ledgers", () => {
  const input = [
    { timestamp: 1000, open: 8, high: 14, low: 8, close: 8, volume: 5 },
    { timestamp: 2000, open: 8, high: 20, low: 8, close: 8, volume: 7 },
    { timestamp: 3000, open: 11, high: 11, low: 11, close: 11, volume: 4 }
  ];
  const calculated = (id, params = {}) =>
    core.calculateTechnicalIndicator(make(id, id, { params }), input);
  series(calculated("momentum", { length: 2, source: "open" }).series.value, [null, null, 3]);
  series(calculated("roc", { length: 2, source: "high" }).series.value, [null, null, -150 / 7]);
  // HLC3 is [10,12,11], whose last observation is exactly its mean. Close CCI would be100.
  series(calculated("cci", { length: 3 }).series.value, [null, null, 0]);
  series(calculated("cci", { length: 3, source: "close" }).series.value, [null, null, 100]);
  series(calculated("williams-r", { length: 3 }).series.value, [null, null, -75]);
  series(calculated("williams-r", { length: 3, source: "volume" }).series.value, [
    null,
    null,
    -400 / 3
  ]);
  // Money flows +12*7=84, -11*4=44 ->100*84/128=525/8.
  series(calculated("mfi", { length: 2 }).series.value, [null, null, 525 / 8]);
  series(calculated("obv").series.value, [null, 0, 4]);
  series(calculated("adl").series.value, [-5, -12, -12]);
  series(calculated("pvt").series.value, [null, 0, 1.5]);
  for (const id of ids) {
    const result = calculated(id, "length" in expected[id] ? { length: 2 } : {});
    assert.deepEqual(result.timestamps, [1000, 2000, 3000]);
    assert.deepEqual(Object.keys(result.series), ["value"]);
    assert.equal(result.status, "computed");
  }
});

test("finite and cumulative history metadata retain reviewed policies without fake recursive seeding", () => {
  for (const [id, warmup] of [
    ["momentum", 11],
    ["roc", 10],
    ["cci", 20],
    ["williams-r", 14],
    ["mfi", 15]
  ]) {
    const instance = make(id, id),
      result = core.calculateTechnicalIndicator(instance, []);
    assert.equal(result.warmupBars, warmup);
    assert.deepEqual(result.historyRequirement, {
      kind: "finite",
      lookbackBars: warmup,
      seedPolicy: "window",
      convergence: "exact-after-lookback"
    });
  }
  for (const id of ["obv", "adl", "pvt"]) {
    const instance = make(id, id),
      result = core.calculateTechnicalIndicator(instance, []);
    assert.deepEqual(result.historyRequirement, {
      kind: "cumulative",
      lookbackBars: null,
      seedBars: id === "adl" ? 1 : 2,
      seedPolicy: "zero-before-first-contribution",
      missingPolicy: "gap-preserve-known-total",
      convergence: "full-input-dependent"
    });
    assert.equal(core.technicalIndicatorWarmup(instance), id === "adl" ? 1 : 2);
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.historyRequirement)),
      result.historyRequirement
    );
  }
});

test("source guards, exact empty cumulative params, and period bounds reject unsafe JSON", () => {
  for (const id of ["momentum", "roc", "cci", "williams-r", "mfi"]) {
    const maximum = id === "mfi" ? 2000 : 10000;
    assert.equal(make(id, id, { params: { length: 1 } }).params.length, 1);
    assert.equal(make(id, id, { params: { length: maximum } }).params.length, maximum);
    for (const length of [0, -1, 1.5, maximum + 1, NaN, Infinity, "14"])
      assert.throws(() => make(id, id, { params: { length } }), RangeError);
  }
  for (const id of ["momentum", "roc", "cci", "williams-r"]) {
    for (const source of core.PRICE_SOURCES)
      assert.equal(make(id, id, { params: { source } }).params.source, source);
    for (const source of ["eval(close)", "HLC3", "", null, [], {}, () => 1])
      assert.equal(
        core.isTechnicalIndicatorInstance({ ...make(id, id), params: { ...expected[id], source } }),
        false
      );
  }
  for (const id of ["obv", "adl", "pvt"])
    for (const params of [{ length: 1 }, { source: "close" }, { arbitrary: 0 }])
      assert.equal(core.isTechnicalIndicatorInstance({ ...make(id, id), params }), false);
  assert.throws(() => make("mfi", "mfi", { params: { source: "hlc3" } }), RangeError);
  for (const id of ids) {
    let invoked = false;
    const params = { ...expected[id] };
    Object.defineProperty(params, "code", {
      enumerable: true,
      get() {
        invoked = true;
        return "code";
      }
    });
    assert.equal(core.isTechnicalIndicatorInstance({ ...make(id, id), params }), false);
    assert.equal(invoked, false);
    const bad = { ...make(id, id), params: { ...expected[id], code: "alert(1)" } };
    assert.throws(() => core.calculateTechnicalIndicator(bad, []), /Invalid/);
  }
});

test("all new instances and customized allowed fields survive manual and Drive JSON roundtrips unchanged", () => {
  const instances = ids.map((id, order) =>
    make(id, `portable-${id}`, {
      params:
        "source" in expected[id] ? { length: 3, source: "hl2" } : id === "mfi" ? { length: 2 } : {},
      order,
      visible: order % 2 === 0,
      styles: {
        value: { color: "#123456", width: 2, visible: true, opacity: 0.4, lineStyle: "dashed" }
      }
    })
  );
  const input = {
    application: "personal-terminal",
    schemaVersion: 1,
    layout: { technicalIndicators: instances },
    drawings: [],
    images: []
  };
  const manual = validateBackup(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(manual.layout.technicalIndicators, instances);
  const drive = validateBackup(JSON.parse(JSON.stringify(sanitizeDriveBackup(manual))));
  assert.deepEqual(drive.layout.technicalIndicators, instances);
  assert.equal(core.isTechnicalIndicatorInstanceList(drive.layout.technicalIndicators), true);
  for (const restored of drive.layout.technicalIndicators)
    assert.deepEqual(
      core.calculateTechnicalIndicator(restored, bars([1, 2, 3, 4])),
      core.calculateTechnicalIndicator(
        instances.find((item) => item.id === restored.id),
        bars([1, 2, 3, 4])
      )
    );
  const unsafe = structuredClone(input);
  unsafe.layout.technicalIndicators[0].params.code = "bad";
  assert.throws(() => validateBackup(unsafe));
});

test("runtime preserves genuine gaps and known-only cumulative continuation without zero-filling", () => {
  const input = bars([10, 12, 9, 18, 9], [5, 7, null, 2, 1]);
  const result = (id) =>
    core.calculateTechnicalIndicator(
      make(id, id, { params: "length" in expected[id] ? { length: 2 } : {} }),
      input
    );
  series(result("obv").series.value, [null, 7, null, 9, 8]);
  series(result("pvt").series.value, [null, 1.4, null, 3.4, 2.9]);
  series(result("mfi").series.value, [null, null, null, null, 80]);
  const gap = bars([1, 2, null, 4, 5], [1, 1, null, 1, 1]);
  for (const id of ids) {
    const instance = make(id, id, { params: "length" in expected[id] ? { length: 2 } : {} });
    const calculated = core.calculateTechnicalIndicator(
      instance,
      Object.freeze(gap.map(Object.freeze))
    );
    assert.equal(calculated.series.value[2], null);
    assert.deepEqual(
      calculated.timestamps,
      gap.map((bar) => bar.timestamp)
    );
    assert.ok(calculated.series.value.every((value) => value === null || Number.isFinite(value)));
  }
});
