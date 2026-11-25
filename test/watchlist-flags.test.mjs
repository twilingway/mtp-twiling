import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sourceModules(overrides = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    const candidate = path.resolve(root, name).replace(/\.js$/, ".ts"),
      file = existsSync(candidate) ? candidate : candidate + "x",
      relative = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename: file }).runInThisContext()(
      (specifier) => Object.hasOwn(overrides, specifier) ? overrides[specifier] :
        load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module, module.exports
    );
    return module.exports;
  }
  return load;
}
function database() {
  const stores = new Map();
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    get: async (name, key) => structuredClone(store(name).get(key)),
    all: async (name) => structuredClone([...store(name).values()]),
    put: async (name, record) => { store(name).set(record.id, structuredClone(record)); },
    flush: async () => {},
    transaction: async (_names, action) => action({ objectStore: (name) => ({
      put: (record) => store(name).set(record.id, structuredClone(record)),
      delete: (id) => store(name).delete(id)
    }) })
  };
}
const row = (symbol, uid = `uid-${symbol}`) => ({
  symbol, ticker: symbol, uid, figi: null, name: symbol, color: "#123456", mark: symbol[0],
  currency: "rub", step: 1, price: 100, previousClose: 99, availability: "available"
});
const load = sourceModules(), flags = load("model/watchlist-flags.js"),
  { validateBackup, isProfilePreferences } = load("model/backup-format.js");
const backup = (layout) => ({ application: "personal-terminal", schemaVersion: 1,
  drawings: [], images: [], layout });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test("stable UID flags distinguish duplicate symbols, share aliases, preserve brand colors and survive reorder", () => {
  const rows = [row("SAME", "one"), row("SAME", "two"), row("ALIAS", "one"), row("OLD", null)],
    before = JSON.stringify(rows);
  let map = flags.updatedWatchlistFlags(undefined, flags.watchlistFlagKey(rows[0]), "red");
  map = flags.updatedWatchlistFlags(map, flags.watchlistFlagKey(rows[1]), "blue");
  map = flags.updatedWatchlistFlags(map, flags.watchlistFlagKey(rows[3]), "pink");
  assert.deepEqual(map, { "uid:one": "red", "uid:two": "blue", "legacy:OLD": "pink" });
  assert.equal(flags.watchlistFlag(map, rows[2]), "red");
  assert.equal(flags.watchlistFlagCounts(rows, map).red, 2);
  const { moveWatchlistRow } = load("services/watchlist-order.js"), position = (index) => ({
    index, uid: rows[index].uid, symbol: rows[index].symbol
  });
  const moved = moveWatchlistRow(rows, { source: position(3), target: position(0), placement: "before" });
  assert.deepEqual(moved.map((item) => flags.watchlistFlag(map, item)), ["pink", "red", "blue", "red"]);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(flags.watchlistFlagKey(row("BAD", "")), null);
  assert.equal(flags.watchlistFlagKey(row("invalid space", null)), null);
});

test("flag validator bounds keys/maps, rejects prototype and arbitrary values, keeps old backup compatible", () => {
  assert.equal(flags.isWatchlistFlags({ "uid:abc-1": "cyan", "legacy:BR-12.26": "yellow" }), true);
  assert.equal(isProfilePreferences({}), true);
  assert.equal(isProfilePreferences({ watchlistFlagFilter: "all" }), true);
  assert.equal(flags.isWatchlistFlags(Object.assign(Object.create(null), { "uid:one": "red" })), true);
  for (const map of [[], null, { x: "red" }, { "uid:": "red" }, { "uid:bad key": "red" },
    { ["uid:" + "a".repeat(197)]: "red" }, { "uid:one": "orange" }, { "uid:one": "#ff5252" },
    { "legacy:a b": "blue" }, JSON.parse('{"__proto__":"red"}'), Object.create({ "uid:a": "red" }),
    Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`uid:${i}`, "red"]))]) {
    assert.equal(flags.isWatchlistFlags(map), false);
    assert.throws(() => validateBackup(backup({ watchlistFlags: map })));
  }
  assert.equal(flags.isWatchlistFlags(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`uid:${i}`, "green"]))), true);
  assert.throws(() => validateBackup(backup({ watchlistFlagFilter: "orange" })));
});

test("actual profile storage and manual backup round-trip flags/filter without crossing owners", async () => {
  const db = database(), storage = sourceModules({ "services/storage-db.ts": db })("services/storage.js");
  const a = { symbol: "ONE", watchlistFlags: { "uid:one": "green", "legacy:OLD": "yellow" }, watchlistFlagFilter: "green" },
    b = { symbol: "TWO", watchlistFlags: { "uid:two": "purple" }, watchlistFlagFilter: "all" };
  await storage.savePreferences("owner-A", a);
  await storage.savePreferences("owner-B", b);
  assert.deepEqual(await storage.loadPreferences("owner-A"), a);
  const exported = JSON.parse(JSON.stringify(await storage.createBackup("owner-A")));
  assert.deepEqual(exported.layout, a);
  await storage.importBackup("owner-C", exported);
  assert.deepEqual(await storage.loadPreferences("owner-C"), a);
  assert.deepEqual(await storage.loadPreferences("owner-B"), b);
  const invalid = structuredClone(exported); invalid.layout.watchlistFlags["uid:one"] = "invisible";
  await assert.rejects(storage.importBackup("owner-C", invalid));
  assert.deepEqual(await storage.loadPreferences("owner-C"), a);
});

function controllerFixture() {
  const db = database(), module = sourceModules({ "services/storage-db.ts": db }),
    { TerminalController } = module("screens/terminal/controller.js"),
    { persistWatchlistFlagChange } = module("screens/terminal/watchlist-flag-preferences.js"),
    controller = new TerminalController(), rows = [row("ONE"), row("TWO")];
  controller.update({ owner: "profile-A", authenticated: true, ready: true, rows,
    preferences: { ...controller.getSnapshot().preferences, symbol: "ONE", instrumentUid: "uid-ONE" } });
  let reloads = 0, views = 0;
  controller.loadHistory = async () => { reloads++; };
  controller.saveView = async () => { views++; };
  const chart = { camera: { barSpace: 11, rightOffsetBars: -50 } };
  controller.chart = chart;
  return { controller, rows, persist: persistWatchlistFlagChange, db, chart,
    reloads: () => reloads, views: () => views };
}

test("actual controller merges rapid flags/filter/clear without reload, row loss, UID selection or camera changes", async () => {
  const f = controllerFixture(), gate = deferred(), entered = deferred();
  f.controller.saveView = async () => { entered.resolve(); await gate.promise; };
  const first = f.persist(f.controller, { row: f.rows[0], color: "red" });
  await entered.promise;
  const second = f.persist(f.controller, { row: f.rows[1], color: "blue" }),
    filter = f.persist(f.controller, { filter: "blue" });
  gate.resolve();
  await Promise.all([first, second, filter]);
  const state = f.controller.getSnapshot();
  assert.deepEqual(state.preferences.watchlistFlags, { "uid:uid-ONE": "red", "uid:uid-TWO": "blue" });
  assert.equal(state.preferences.watchlistFlagFilter, "blue");
  assert.equal(state.preferences.instrumentUid, "uid-ONE");
  assert.equal(state.preferences.symbol, "ONE");
  assert.equal(state.rows, f.rows);
  assert.equal(f.controller.chart, f.chart);
  assert.equal(f.reloads(), 0);
  const visible = state.rows.filter((item) => flags.matchesWatchlistFlag(item,
    state.preferences.watchlistFlags, state.preferences.watchlistFlagFilter));
  assert.deepEqual(visible, [f.rows[1]]);
  assert.equal(state.preferences.instrumentUid, "uid-ONE");
  await f.persist(f.controller, { clear: true });
  assert.deepEqual(f.controller.getSnapshot().preferences.watchlistFlags, {});
  assert.equal(f.controller.getSnapshot().preferences.watchlistFlagFilter, "all");
  assert.equal(f.reloads(), 0);
  assert.deepEqual((await f.db.get("preferences", "layout:profile-A")).value.watchlistFlags, {});
});

test("owner/import/revision/external-map changes while setPreferences waits cancel stale and queued flag updates", async () => {
  for (const boundary of ["owner", "owner-bounce", "import", "import-finished", "revision", "map", "removed"]) {
    const f = controllerFixture(), gate = deferred(), entered = deferred();
    f.controller.saveView = async () => { entered.resolve(); await gate.promise; };
    const first = f.persist(f.controller, { row: f.rows[0], color: "red" });
    await entered.promise;
    const second = f.persist(f.controller, { row: f.rows[1], color: "green" });
    const current = f.controller.getSnapshot();
    if (boundary === "owner") f.controller.update({ owner: "profile-B" });
    if (boundary === "owner-bounce") {
      f.controller.update({ owner: "profile-B" }); f.controller.update({ owner: "profile-A" });
    }
    if (boundary === "import") f.controller.update({ importingBackup: true, backupBusy: true });
    if (boundary === "import-finished") {
      f.controller.update({ importingBackup: true }); f.controller.update({ importingBackup: false });
    }
    if (boundary === "revision") f.controller.update({ chartRevision: current.chartRevision + 1 });
    if (boundary === "map") f.controller.update({ preferences: { ...current.preferences, watchlistFlags: { "uid:IMPORTED": "pink" } } });
    if (boundary === "removed") f.controller.update({ rows: [] });
    gate.resolve(); await Promise.all([first, second]);
    const final = f.controller.getSnapshot();
    if (boundary === "map") {
      assert.equal(final.preferences.watchlistFlags["uid:IMPORTED"], "pink");
      assert.equal(final.preferences.watchlistFlags["uid:uid-ONE"], undefined);
      // A later queued action merges the latest map instead of overwriting it.
      assert.equal(final.preferences.watchlistFlags["uid:uid-TWO"], "green");
    } else assert.equal(final.preferences.watchlistFlags, undefined);
    if (boundary === "owner") assert.equal(await f.db.get("preferences", "layout:profile-B"), undefined);
  }
});

test("seven palette colors have labels/current selection, unflag works, marker events cannot select/delete/drag rows", () => {
  const actions = [], loader = sourceModules({ "react/jsx-runtime": jsx }),
    { WatchlistFlagPalette } = loader("screens/terminal/WatchlistFlagPalette.js"),
    { WatchlistFlag } = loader("screens/terminal/WatchlistFlag.js"),
    palette = WatchlistFlagPalette({ value: "green", disabled: false, onChange: (color) => actions.push(color) });
  const colors = palette.props.children[0], clear = palette.props.children[1];
  assert.equal(colors.length, 7);
  assert.equal(colors.filter((color) => color.props["aria-checked"]).length, 1);
  assert.equal(colors[2].props["aria-checked"], true);
  for (const color of colors) { assert.ok(color.props["aria-label"]); color.props.onClick(); }
  clear.props.onClick();
  assert.deepEqual(actions, [...Object.keys(flags.WATCHLIST_FLAG_COLORS), null]);
  const html = renderToStaticMarkup(palette);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 8);
  assert.match(html, /aria-checked="true"/);
  const marked = WatchlistFlag({ row: row("ONE"), flags: { "uid:ONE": "red" },
    disabled: false, onOpen: () => actions.push("open") });
  let stopped = 0, prevented = 0;
  const event = { stopPropagation() { stopped++; }, preventDefault() { prevented++; } };
  marked.props.onKeyDown(event); marked.props.onPointerDown(event); marked.props.onDragStart(event);
  marked.props.onClick(event);
  assert.equal(stopped, 4); assert.equal(prevented, 1);
  assert.equal(actions.at(-1), "open");
  assert.equal(marked.props.draggable, false);
  assert.equal(marked.props["aria-haspopup"], "menu");
});
