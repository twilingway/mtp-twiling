import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../src/", import.meta.url));
export function sourceModules(overrides = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    const candidate = path.resolve(root, name).replace(/\.js$/, ".ts"),
      file = existsSync(candidate) ? candidate : candidate + "x",
      relative = path.relative(root, file).replaceAll(path.sep, "/");
    assert.ok(file.startsWith(root));
    if (relative === "services/storage-v2.ts") return load("services/storage.ts");
    if (relative === "services/storage-v2-migration.ts")
      return { physicalOwner: (owner) => owner, prepareProfileV2: async () => {} };
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, {
      filename: file
    }).runInThisContext()(
      (specifier) =>
        Object.hasOwn(overrides, specifier)
          ? overrides[specifier]
          : load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
export function database() {
  const stores = new Map();
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    get: async (name, key) => structuredClone(store(name).get(key)),
    all: async (name) => structuredClone([...store(name).values()]),
    put: async (name, record) => {
      store(name).set(record.id, structuredClone(record));
    },
    flush: async () => {},
    transaction: async (_names, action) =>
      action({
        objectStore: (name) => ({
          put: (record) => store(name).set(record.id, structuredClone(record)),
          delete: (id) => store(name).delete(id)
        })
      })
  };
}
export const row = (symbol, uid = `uid-${symbol}`) => ({
  symbol,
  ticker: symbol,
  uid,
  figi: null,
  name: symbol,
  color: "#123456",
  mark: symbol[0],
  currency: "rub",
  step: 1,
  price: 100,
  previousClose: 99,
  availability: "available"
});
export const header = (id, title = id) => ({
  kind: "section",
  id: `section-${id}`,
  title,
  collapsed: false
});
export const backup = (layout) => ({
  application: "personal-terminal",
  schemaVersion: 2,
  drawings: [],
  images: [],
  layout
});
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function controllerFixture() {
  const db = database(),
    load = sourceModules({ "services/storage-db.ts": db }),
    { TerminalController } = load("screens/terminal/controller.js"),
    { persistWatchlistSectionChange: persist } = load(
      "screens/terminal/watchlist-section-preferences.js"
    ),
    model = load("model/watchlist-sections.js"),
    actions = load("model/watchlist-sections-actions.js"),
    controller = new TerminalController(),
    rows = [row("ONE"), row("TWO"), row("THREE")];
  controller.update({
    owner: "profile-A",
    authenticated: true,
    marketReady: true,
    ready: true,
    rows,
    preferences: {
      ...controller.getSnapshot().preferences,
      symbol: "ONE",
      instrumentUid: "uid-ONE"
    }
  });
  let reloads = 0;
  controller.loadHistory = async () => {
    reloads++;
  };
  controller.saveView = async () => {};
  const chart = { camera: { barSpace: 11, rightOffsetBars: -50 } };
  controller.chart = chart;
  return { controller, rows, persist, db, load, model, actions, chart, reloads: () => reloads };
}
