import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url)),
  modules = new Map();
function source(relative) {
  const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
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
const actions = source("screens/terminal/technical-indicator-actions.js");
const core = source("model/technical-indicators/instances.js");
const layout = source("model/technical-indicator-layout.js");
const catalog = source("model/technical-indicators/catalog.js");
const { filterIndicatorLibrary } = source("model/indicator-library.js");
function controller(instances = []) {
  let state = {
    owner: "one",
    chartRevision: 1,
    preferences: {
      symbol: "SBER",
      instrumentUid: "uid",
      timeframe: "1d",
      engine: "lightweight",
      technicalIndicators: instances,
      technicalPaneLayout: []
    }
  };
  const listeners = new Set(),
    writes = [],
    session = {};
  const result = {
    getSnapshot: () => state,
    sessionKey: () => session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    async setPreferences(patch, reload, valid) {
      assert.equal(reload, false);
      await result.gate;
      if (!valid()) return;
      result.update({ preferences: { ...state.preferences, ...patch } });
      writes.push(structuredClone(patch));
    },
    writes,
    listeners,
    gate: Promise.resolve()
  };
  return result;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("all 127 public names are searchable in Russian and English with honest 29-plus-volume availability", () => {
  for (const locale of ["ru", "en"]) {
    const entries = catalog.technicalCatalogEntries(locale);
    assert.equal(entries.length, 127);
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 127);
    assert.equal(entries.filter((entry) => entry.available).length, 30);
    assert.ok(
      filterIndicatorLibrary(entries, "technicals", "RSI").some((entry) => entry.id === "STD;RSI")
    );
    assert.ok(filterIndicatorLibrary(entries, "technicals", "Скользящее среднее").length);
    assert.ok(entries.filter((entry) => !entry.available).every((entry) => entry.reason));
  }
  assert.ok(
    catalog
      .technicalCatalogEntries("ru", "busy")
      .every((entry) => !entry.available && entry.reason === "busy")
  );
});

test("queued add operations retain multiple independent instances and separate native panes", async () => {
  const c = controller();
  await Promise.all([
    actions.addTechnicalIndicator(c, "rsi"),
    actions.addTechnicalIndicator(c, "rsi"),
    actions.addTechnicalIndicator(c, "ema")
  ]);
  const p = c.getSnapshot().preferences;
  assert.equal(p.technicalIndicators.length, 3);
  assert.equal(new Set(p.technicalIndicators.map((item) => item.id)).size, 3);
  assert.deepEqual(
    p.technicalIndicators.map((item) => item.pane.kind),
    ["pane", "pane", "overlay"]
  );
  assert.equal(p.technicalPaneLayout.length, 2);
  assert.equal(core.isTechnicalIndicatorInstanceList(p.technicalIndicators), true);
  assert.equal(c.listeners.size, 0);
});

test("group, reorder, hide, collapse and delete preserve unrelated parameters and pane preferences", async () => {
  const a = core.createTechnicalIndicatorInstance("rsi", "a"),
    b = core.createTechnicalIndicatorInstance("rsi", "b", { params: { length: 7 } });
  const c = controller([a, b]);
  await actions.updateTechnicalIndicator(c, "b", (item) => ({ ...item, pane: a.pane }));
  await actions.moveTechnicalIndicator(c, "b", "a");
  assert.deepEqual(
    layout
      .orderedTechnicalIndicators(c.getSnapshot().preferences.technicalIndicators)
      .map((item) => item.id),
    ["b", "a"]
  );
  await actions.updateTechnicalIndicator(c, "b", (item) => ({ ...item, visible: false }));
  await actions.changeTechnicalPane(c, "a", true);
  await actions.persistTechnicalPaneLayout(
    c,
    [{ paneId: "a", heightRatio: 0.35, collapsed: true }],
    () => true
  );
  assert.deepEqual(c.getSnapshot().preferences.technicalPaneLayout, [
    { paneId: "a", heightRatio: 0.35, collapsed: true }
  ]);
  await actions.updateTechnicalIndicator(c, "a", () => null);
  const p = c.getSnapshot().preferences;
  assert.equal(p.technicalIndicators[0].id, "b");
  assert.equal(p.technicalIndicators[0].params.length, 7);
  assert.equal(p.technicalIndicators[0].visible, false);
  assert.equal(p.technicalPaneLayout[0].heightRatio, 0.35);
  await actions.updateTechnicalIndicator(c, "b", () => null);
  assert.deepEqual(c.getSnapshot().preferences.technicalPaneLayout, []);
});

test("a transient owner/import/route boundary cancels queued writes even after returning to the same screen", async () => {
  for (const mutate of [
    (c) => {
      c.update({ owner: "two" });
      c.update({ owner: "one" });
    },
    (c) => {
      c.update({ importingBackup: true });
      c.update({ importingBackup: false });
    },
    (c) => {
      const p = c.getSnapshot().preferences;
      c.update({ preferences: { ...p, symbol: "GAZP" } });
      c.update({ preferences: p });
    }
  ]) {
    const c = controller();
    let release;
    c.gate = new Promise((resolve) => {
      release = resolve;
    });
    const first = actions.addTechnicalIndicator(c, "rsi");
    await tick();
    const second = actions.addTechnicalIndicator(c, "ema");
    mutate(c);
    release();
    await Promise.all([first, second]);
    assert.equal(c.writes.length, 0);
    assert.equal(c.listeners.size, 0);
    await actions.addTechnicalIndicator(c, "sma");
    assert.equal(c.writes.length, 1);
  }
});

test("invalid mutations cannot persist and failed queues recover; 100 separate pane preferences round-trip", async () => {
  const c = controller([core.createTechnicalIndicatorInstance("rsi", "first")]);
  await assert.rejects(
    actions.updateTechnicalIndicator(c, "first", (item) => ({ ...item, params: { length: -1 } }))
  );
  await actions.addTechnicalIndicator(c, "ema");
  assert.equal(c.getSnapshot().preferences.technicalIndicators.length, 2);
  const large = Array.from({ length: 100 }, (_, index) => ({
    paneId: `pane-${index}`,
    heightRatio: 0.2,
    collapsed: false
  }));
  assert.equal(layout.isTechnicalPaneLayout(JSON.parse(JSON.stringify(large))), true);
  assert.equal(
    layout.isTechnicalPaneLayout([
      ...large,
      { paneId: "overflow", heightRatio: 0.2, collapsed: false }
    ]),
    false
  );
});
