import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
const overrides = new Map();
function source(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
  const key = path.relative(root, file).replaceAll(path.sep, "/");
  if (overrides.has(key)) return overrides.get(key);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${output}\n})`, {
    filename: file
  }).runInThisContext()(
    (name) => source(path.relative(root, path.resolve(path.dirname(file), name))),
    module,
    module.exports
  );
  return module.exports;
}
const model = source("model/technical-indicator-layout.js");
const { createTechnicalIndicatorInstance: make } = source(
  "model/technical-indicators/instances.js"
);
const { isProfilePreferences, validateBackup } = source("model/backup-format.js");
const { sanitizeDriveBackup } = source("services/drive/backup.js");
const clone = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const layout = () => [
  { paneId: "strength", heightRatio: 0.2, collapsed: false },
  { paneId: "range", heightRatio: 0.15, collapsed: true }
];
const instances = () => [
  make("rsi", "rsi7", { params: { length: 7 }, pane: { kind: "pane", id: "strength" }, order: 10 }),
  make("rsi", "rsi14", { pane: { kind: "pane", id: "strength" }, order: 20 }),
  make("sma", "average", { order: 9 }),
  make("atr", "range", { pane: { kind: "pane", id: "range" }, order: 1 })
];
const backup = (preferences = {}) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: preferences,
  watchlist: [],
  drawings: [],
  images: [],
  views: []
});

test("grouping keeps price separate, honors durable pane order and does not combine independent RSI periods", () => {
  const input = freeze(instances());
  const preferences = freeze(layout().reverse());
  const before = clone(input);
  const groups = model.technicalIndicatorGroups(input, preferences);
  assert.deepEqual(
    groups.map((item) => item.key),
    ["price", "pane:range", "pane:strength"]
  );
  assert.deepEqual(
    groups[2].instances.map((item) => item.params.length),
    [7, 14]
  );
  assert.equal(groups[1].preference.collapsed, true);
  assert.equal(groups[1].preference.heightRatio, 0.15);
  assert.deepEqual(input, before);
  assert.equal(model.technicalPaneKey({ kind: "pane", id: "price" }), "pane:price");
});

test("reorder moves within one pane, retains parameter/style identity and leaves foreign panes unchanged", () => {
  const input = freeze(instances());
  const before = clone(input);
  const next = model.reorderTechnicalIndicators(input, "rsi14", "rsi7");
  const group = model.technicalIndicatorGroups(next).find((item) => item.key === "pane:strength");
  assert.deepEqual(
    group.instances.map((item) => item.id),
    ["rsi14", "rsi7"]
  );
  assert.equal(next[0].params, input[0].params);
  assert.equal(next[1].pane, input[1].pane);
  assert.equal(next[2], input[2]);
  assert.equal(next[3], input[3]);
  assert.deepEqual(input, before);
  const after = model.reorderTechnicalIndicators(input, "rsi7", "rsi14", "after");
  assert.deepEqual(
    model
      .technicalIndicatorGroups(after)
      .find((item) => item.key === "pane:strength")
      .instances.map((item) => item.id),
    ["rsi14", "rsi7"]
  );
  for (const [moved, target] of [
    ["rsi7", "range"],
    ["absent", "rsi14"],
    ["rsi7", "rsi7"]
  ])
    assert.equal(model.reorderTechnicalIndicators(input, moved, target), input);
});

test("pane reorder preserves height/collapse preferences and rejects absent targets without mutations", () => {
  const input = freeze(layout());
  const next = model.reorderTechnicalPanes(input, "range", "strength");
  assert.deepEqual(
    next.map((item) => item.paneId),
    ["range", "strength"]
  );
  assert.equal(next[0], input[1]);
  assert.equal(next[1], input[0]);
  assert.equal(model.reorderTechnicalPanes(input, "range", "absent"), input);
  assert.equal(model.reorderTechnicalPanes(input, "strength", "range"), input);
});

test("layout validation bounds ratios, IDs, duplicates and unsafe object shapes without invoking accessors", () => {
  assert.equal(model.isTechnicalPaneLayout([]), true);
  assert.equal(model.isTechnicalPaneLayout(layout()), true);
  for (const heightRatio of [0, 0.049, 0.801, NaN, Infinity, "0.2", null])
    assert.equal(model.isTechnicalPaneLayout([{ ...layout()[0], heightRatio }]), false);
  for (const value of [
    null,
    {},
    [layout()[0], layout()[0]],
    [{ ...layout()[0], extra: true }],
    [{ ...layout()[0], paneId: "__proto__" }],
    [{ ...layout()[0], collapsed: 1 }],
    Array.from({ length: 101 }, (_, i) => ({ ...layout()[0], paneId: `pane-${i}` }))
  ])
    assert.equal(model.isTechnicalPaneLayout(value), false);
  let calls = 0;
  const accessor = {
    heightRatio: 0.2,
    collapsed: false,
    get paneId() {
      calls++;
      throw Error("getter");
    }
  };
  assert.equal(model.isTechnicalPaneLayout([accessor]), false);
  assert.equal(calls, 0);
});

test("legacy backups remain valid and new instance/pane preferences survive manual JSON and Drive projection", () => {
  assert.equal(validateBackup(backup()).schemaVersion, 1);
  const preferences = { technicalIndicators: instances(), technicalPaneLayout: layout() };
  assert.equal(isProfilePreferences(preferences), true);
  const input = backup(preferences);
  const manual = validateBackup(clone(input));
  assert.deepEqual(manual.layout, preferences);
  const cloud = sanitizeDriveBackup({ ...input, owner: "local-only", token: "not-a-real-key" });
  assert.deepEqual(cloud.layout, preferences);
  assert.equal(Object.hasOwn(cloud, "owner"), false);
  assert.equal(Object.hasOwn(cloud, "token"), false);
  const restored = validateBackup(clone(cloud));
  assert.deepEqual(restored.layout.technicalIndicators[0].pane, { kind: "pane", id: "strength" });
  assert.equal(restored.layout.technicalIndicators[0].params.length, 7);
});

test("real profile storage preserves instances and panes across reload and isolates owners", async () => {
  const records = new Map();
  overrides.set("services/storage-db.ts", {
    db: {},
    get: async (store, key) => structuredClone(records.get(`${store}:${key}`)),
    put: async (store, value) => {
      records.set(`${store}:${value.id}`, structuredClone(value));
    },
    all: async () => [],
    transaction: () => {
      throw Error("Unexpected transaction");
    },
    flush: async () => {}
  });
  const storage = source("services/storage.js");
  const alice = { technicalIndicators: instances(), technicalPaneLayout: layout() };
  const bob = { technicalIndicators: [make("rsi", "bob-rsi", { params: { length: 21 } })] };
  await storage.savePreferences("alice", alice);
  await storage.savePreferences("bob", bob);
  assert.deepEqual(await storage.loadPreferences("alice"), alice);
  assert.deepEqual(await storage.loadPreferences("bob"), bob);
  assert.deepEqual(await storage.loadPreferences("guest"), {});
  const first = await storage.loadPreferences("alice");
  first.technicalIndicators[0].params.length = 99;
  assert.equal((await storage.loadPreferences("alice")).technicalIndicators[0].params.length, 7);
  assert.equal((await storage.loadPreferences("bob")).technicalIndicators[0].params.length, 21);
  assert.deepEqual([...records.keys()].sort(), [
    "preferences:layout:alice",
    "preferences:layout:bob"
  ]);
});

test("invalid persisted instances fail before import instead of becoming an apparently successful empty indicator", () => {
  const good = instances();
  for (const changed of [
    { ...good[0], params: { length: 0, source: "close" } },
    { ...good[0], definitionId: "not-computed" },
    { ...good[0], pane: { kind: "pane", id: "" } },
    { ...good[0], params: { ...good[0].params, injected: "code" } }
  ]) {
    const preferences = { technicalIndicators: [changed], technicalPaneLayout: layout() };
    assert.equal(isProfilePreferences(preferences), false);
    assert.throws(() => validateBackup(backup(preferences)));
  }
  assert.throws(() =>
    sanitizeDriveBackup(
      backup({ technicalIndicators: [{ ...good[0], params: { length: 0, source: "close" } }] })
    )
  );
  assert.equal(isProfilePreferences({ technicalIndicators: [good[0], good[0]] }), false);
});
