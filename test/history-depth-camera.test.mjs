import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url)), DAY = 86400000,
  today = Math.floor(Date.now() / DAY) * DAY;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
function sources(overrides = {}) {
  const cache = new Map();
  function load(name) {
    const file = path.resolve(root, name).replace(/\.js$/, ".ts"),
      relative = path.relative(root, file).replaceAll(path.sep, "/");
    if (relative === "services/storage-v2.ts") return load("services/storage.ts");
    if (relative === "services/storage-v2-migration.ts") return { physicalOwner: owner => owner, prepareProfileV2: async () => {} };
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename: file }).runInThisContext()(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))), module, module.exports);
    return module.exports;
  }
  return load;
}
function database(records = new Map()) {
  const stores = new Map([["preferences", records]]), writes = [];
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return { records, writes,
    get: async (name, key) => structuredClone(store(name).get(key)),
    all: async (name) => structuredClone([...store(name).values()]),
    put: async (name, record) => { writes.push(record); store(name).set(record.id, structuredClone(record)); },
    flush: async () => {},
    transaction: async (_names, action) => action({ objectStore: (name) => ({
      put: (record) => { writes.push(record); store(name).set(record.id, structuredClone(record)); },
      delete: (id) => store(name).delete(id)
    }) })
  };
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const candle = (timestamp) => ({ timestamp, open: 10, high: 12, low: 9, close: 11, volume: 100 });
const view = (spacing, offset, days) => ({ camera: { barSpace: spacing, rightOffsetBars: offset },
  anchor: { timestamp: today - days * DAY, xFraction: 0.5 },
  from: (today - (days + 50) * DAY) / 1000, to: (today - (days - 50) * DAY) / 1000 });
async function fixture({ engine = "tradingview", records } = {}) {
  const db = database(records), load = sources({ "services/storage-db.ts": db }),
    storage = load("services/storage.js"), camera = load("services/chart-camera.js"),
    { TerminalController } = load("screens/terminal/controller.js"), controller = new TerminalController(),
    bars = Array.from({ length: 5001 }, (_, i) => candle(today - (5000 - i) * DAY)), requests = [],
    rows = ["SBER", "GAZP"].map((symbol) => ({ symbol, ticker: symbol, uid: `uid-${symbol}`, name: symbol,
      color: "#123456", mark: symbol[0], currency: "rub", step: 1, price: 11, previousClose: 10,
      first1dayCandleDate: new Date(today - 5000 * DAY).toISOString() }));
  storage.loadImages = async () => [];
  const client = { owner: "owner", authenticated: true, marketReady: true,
    candles: async (symbol, timeframe, range, options) => {
      requests.push({ symbol, timeframe, range, uid: options.uid });
      return { candles: bars.filter((bar) => bar.timestamp >= range.from && bar.timestamp <= range.to), requests: 0, cached: true };
    }
  };
  controller.session.client = client;
  const saved = records ? await storage.loadPreferences("owner") : {};
  controller.update({ owner: "owner", authenticated: true, marketReady: true, ready: true, historyViewReady: true, rows,
    candles: [...bars], preferences: { ...controller.getSnapshot().preferences,
      engine, symbol: "SBER", instrumentUid: "uid-SBER", ...saved } });
  const key = () => { const p = controller.getSnapshot().preferences; return `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}`; };
  let currentView = view(9, -850, 875);
  const adapter = () => ({ source: { owner: controller.getSnapshot().owner, viewKey: key(),
    uid: controller.getSnapshot().preferences.instrumentUid }, persistView: true,
    getView: () => structuredClone(currentView), plotSize: () => ({ width: 800, height: 500 }) });
  controller.chart = adapter();
  const unsubscribe = controller.subscribe(() => {
    if (controller.chart?.source?.viewKey !== key())
      controller.chart = { source: { owner: controller.getSnapshot().owner, viewKey: key(),
        uid: controller.getSnapshot().preferences.instrumentUid }, persistView: false,
        getView: () => null, plotSize: () => ({ width: 800, height: 500 }) };
  });
  return { controller, storage, camera, db, requests, key, unsubscribe, rows,
    current: () => currentView, changeView: (next) => { currentView = structuredClone(next); },
    async mount() {
      currentView = await camera.loadChartView(controller.getSnapshot().owner, key());
      controller.chart = adapter(); return structuredClone(currentView);
    }
  };
}

test("both engines keep the latest full camera through 365→5→365→5 and reload, replacing stale depth views only", async () => {
  for (const engine of ["tradingview", "kline"]) {
    const f = await fixture({ engine }), a = f.current(), b = view(15, -450, 475), c = view(6.5, -250, 275),
      other = view(21, -5, 30), stale = view(1, 8, 20);
    await f.storage.saveView("owner", `SBER:1d:${engine}:5`, stale);
    await f.storage.saveView("owner", `GAZP:1d:${engine}:5`, other);
    await f.controller.setPreferences({ rangeDays: 5 });
    assert.equal(f.controller.getSnapshot().preferences.rangeDays, 5);
    assert.deepEqual(await f.mount(), a);
    assert.ok(f.requests[0].range.from <= a.from * 1000 - 440 * DAY);
    assert.equal(f.controller.getSnapshot().historyViewReady, true);
    f.changeView(b);
    await f.controller.setPreferences({ rangeDays: 365 });
    assert.deepEqual(await f.mount(), b);
    f.changeView(c);
    await f.controller.setPreferences({ rangeDays: 5 });
    assert.deepEqual(await f.mount(), c);
    assert.deepEqual(await f.storage.loadView("owner", `GAZP:1d:${engine}:5`), other);
    assert.deepEqual(await f.storage.loadView("owner", `SBER:1d:${engine}:365`), c);
    const saved = await f.storage.createBackup("owner");
    assert.ok(saved.views.every((entry) => /^(SBER|GAZP):1d:(tradingview|kline):(5|365)$/.test(entry.key)));
    assert.deepEqual(saved.views.find((entry) => entry.key === f.key()).value, c);
    f.unsubscribe();
    const reboot = await fixture({ engine, records: f.db.records });
    await reboot.controller.loadHistory();
    assert.equal(reboot.controller.getSnapshot().preferences.rangeDays, 5);
    assert.deepEqual(await reboot.mount(), c);
    assert.ok(reboot.requests[0].range.from <= c.from * 1000 - 440 * DAY);
    reboot.unsubscribe();
  }
});

test("switching instruments retains the existing shared zoom semantics and never copies another calendar anchor", async () => {
  const f = await fixture(), original = f.current(), own = view(17, -10, 60);
  await f.storage.saveView("owner", "GAZP:1d:tradingview:365", own);
  await f.controller.setPreferences({ symbol: "GAZP", instrumentUid: "uid-GAZP" });
  const chosen = await f.mount();
  assert.deepEqual(chosen, { camera: original.camera });
  assert.deepEqual(await f.storage.loadView("owner", "GAZP:1d:tradingview:365"), own);
  await f.controller.setPreferences({ rangeDays: 5 });
  assert.deepEqual(await f.mount(), { camera: original.camera });
  assert.equal(f.requests.at(-1).uid, "uid-GAZP");
  assert.deepEqual(await f.storage.loadView("owner", "SBER:1d:tradingview:365"), original);
  f.unsubscribe();
});

test("owner/UID/import/revision changes, including transient boundaries, cancel old depth work before copy", async () => {
  for (const boundary of ["owner", "owner-bounce", "uid", "import", "import-finished", "revision"]) {
    const f = await fixture(), gate = deferred(), entered = deferred(), stale = view(1, 8, 10);
    await f.storage.saveView("owner", "SBER:1d:tradingview:5", stale);
    f.controller.saveView = async () => { entered.resolve(); await gate.promise; };
    const changing = f.controller.setPreferences({ rangeDays: 5 });
    await entered.promise;
    const state = f.controller.getSnapshot();
    if (boundary === "owner" || boundary === "owner-bounce") {
      f.controller.update({ owner: "other" });
      if (boundary === "owner-bounce") f.controller.update({ owner: "owner" });
    }
    if (boundary === "uid") f.controller.update({ preferences: { ...state.preferences, instrumentUid: "other-uid" } });
    if (boundary === "revision") f.controller.update({ chartRevision: state.chartRevision + 1 });
    if (boundary === "import" || boundary === "import-finished") {
      f.controller.update({ importingBackup: true, backupBusy: true });
      if (boundary === "import-finished") f.controller.update({ importingBackup: false, backupBusy: false });
    }
    gate.resolve(); await changing;
    assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365, boundary);
    assert.deepEqual(await f.storage.loadView("owner", "SBER:1d:tradingview:5"), stale);
    assert.equal(await f.storage.loadView("other", "SBER:1d:tradingview:5"), undefined);
    f.unsubscribe();
  }
});

test("retired, staged or mismatched adapter sources cannot seed a new depth key", async () => {
  for (const change of [{ retired: true }, { persistView: false }, { getView: () => null },
    { source: undefined }, { source: { owner: "other", viewKey: "SBER:1d:tradingview:365", uid: "uid-SBER" } },
    { source: { owner: "owner", viewKey: "SBER:1d:tradingview:365", uid: "uid-GAZP" } },
    { source: { owner: "owner", viewKey: "SBER:1d:tradingview:5", uid: "uid-SBER" } }]) {
    const f = await fixture(); Object.assign(f.controller.chart, change);
    await f.controller.setPreferences({ rangeDays: 5 });
    assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
    assert.equal(await f.storage.loadView("owner", "SBER:1d:tradingview:5"), undefined);
    f.unsubscribe();
  }
});

test("a copy committing before import does not overwrite incoming views or publish old depth preferences", async () => {
  const f = await fixture(), target = "SBER:1d:tradingview:5", incoming = view(23, -13, 90),
    gate = deferred(), entered = deferred(), transaction = f.db.transaction;
  f.db.transaction = async (names, action) => {
    await transaction(names, action); entered.resolve(); await gate.promise;
  };
  const changing = f.controller.setPreferences({ rangeDays: 5 });
  await entered.promise;
  f.controller.update({ importingBackup: true, backupBusy: true });
  f.db.transaction = transaction;
  await f.storage.importBackup("owner", { application: "personal-terminal", schemaVersion: 1,
    drawings: [], images: [], views: [{ key: target, value: incoming }] });
  gate.resolve(); await changing;
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
  assert.deepEqual(await f.storage.loadView("owner", target), incoming);
  f.unsubscribe();
});

test("initial viewless initialization changes lookback without inventing a view; newest depth selection wins", async () => {
  const f = await fixture();
  f.unsubscribe(); f.controller.chart = null; f.controller.update({ candles: [] });
  await f.controller.setPreferences({ rangeDays: 5 });
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 5);
  assert.equal(await f.storage.loadView("owner", "SBER:1d:tradingview:5"), undefined);
  f.unsubscribe();
  const g = await fixture(), gate = deferred(), entered = deferred();
  g.controller.saveView = async () => { entered.resolve(); await gate.promise; };
  const first = g.controller.setPreferences({ rangeDays: 5 }); await entered.promise;
  const latest = g.controller.setPreferences({ rangeDays: 30 });
  gate.resolve(); await Promise.all([first, latest]);
  assert.equal(g.controller.getSnapshot().preferences.rangeDays, 30);
  assert.equal(await g.storage.loadView("owner", "SBER:1d:tradingview:5"), undefined);
  assert.deepEqual(await g.storage.loadView("owner", "SBER:1d:tradingview:30"), g.current());
  g.unsubscribe();
});

test("failed depth camera commit leaves current preferences, candles and adapter intact", async () => {
  const f = await fixture(), state = f.controller.getSnapshot(), chart = f.controller.chart;
  f.db.transaction = async () => { throw new Error("IDB commit failed"); };
  await assert.rejects(f.controller.setPreferences({ rangeDays: 5 }), /IDB commit failed/);
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 365);
  assert.equal(f.controller.getSnapshot().candles, state.candles);
  assert.equal(f.controller.chart, chart);
  assert.equal(f.requests.length, 0);
  assert.equal(await f.storage.loadView("owner", "SBER:1d:tradingview:5"), undefined);
  f.unsubscribe();
});

test("before canvas mount the current saved view carries forward, but a profile change during its read cancels copy", async () => {
  const f = await fixture(), expected = f.current();
  await f.controller.saveView(); f.unsubscribe(); f.controller.chart = null;
  await f.controller.setPreferences({ rangeDays: 5 });
  assert.equal(f.controller.getSnapshot().preferences.rangeDays, 5);
  assert.deepEqual(await f.storage.loadView("owner", "SBER:1d:tradingview:5"), expected);
  const g = await fixture(), gate = deferred(), entered = deferred(), get = g.db.get;
  await g.controller.saveView(); g.unsubscribe(); g.controller.chart = null;
  g.db.get = async (name, id) => {
    if (id === "view:owner:SBER:1d:tradingview:365") { entered.resolve(); await gate.promise; }
    return get(name, id);
  };
  const changing = g.controller.setPreferences({ rangeDays: 5 }); await entered.promise;
  g.controller.update({ owner: "other" }); gate.resolve(); await changing;
  assert.equal(g.controller.getSnapshot().preferences.rangeDays, 365);
  assert.equal(await g.storage.loadView("owner", "SBER:1d:tradingview:5"), undefined);
  assert.equal(await g.storage.loadView("other", "SBER:1d:tradingview:5"), undefined);
});
