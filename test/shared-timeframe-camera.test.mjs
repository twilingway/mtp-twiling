import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { deferred, routingFixture, until } from "./controller-preference-routing-fixture.mjs";

const clone = (value) => structuredClone(value);
const camera = (barSpace = 13, rightOffsetBars = -24.5) => ({ barSpace, rightOffsetBars });
const full = (value = camera()) => ({
  camera: value,
  anchor: { timestamp: 1700000000000, xFraction: 0.3 },
  from: 1699900000,
  to: 1700100000
});
const key = (symbol, timeframe, engine = "tradingview") => `${symbol}:${timeframe}:${engine}:365`;

function fixture(records = new Map(), hooks = {}) {
  const db = {
    async get(_store, id) {
      const value = clone(records.get(id));
      await hooks.get?.(id);
      return value;
    },
    async put(_store, record) {
      await hooks.put?.(record);
      records.set(record.id, clone(record));
    },
    all: async () => [...records.values()],
    transaction: async (_stores, action) => action({ objectStore: () => ({ delete: (id) => records.delete(id) }) })
  };
  const load = sourceLoader({
    "services/storage-db.ts": db,
    "services/storage-v2-migration.ts": {
      physicalOwner: (owner) => `physical:${owner}`,
      prepareProfileV2: async () => {}
    },
    "services/storage-v2.ts": {
      loadView: async (owner, viewKey) => clone(records.get(`view:${owner}:${viewKey}`)?.value),
      saveView: async (owner, viewKey, value) => db.put("preferences", { id: `view:${owner}:${viewKey}`, value })
    }
  });
  return {
    load,
    records,
    native: load("model/intervals/native-timeframes.ts").NATIVE_TIMEFRAMES,
    main: load("services/chart-camera.ts"),
    workspace: load("services/workspace-camera.ts")
  };
}

test("shared-window refresh drops only its stale camera memory and preserves the peer's canonical camera", async () => {
  const records = new Map(), stale = fixture(records), peer = fixture(records);
  const viewKey = key("GAZP", "1h");
  await stale.main.saveChartView("owner", viewKey, full(camera(7, -10)));
  await peer.main.saveChartView("owner", viewKey, full(camera(19, -31)));
  const before = clone([...records]);
  assert.equal((await stale.main.loadChartView("owner", viewKey)).camera.barSpace, 7);
  await stale.main.resetSharedChartCamera("owner", true);
  assert.deepEqual(clone([...records]), before);
  assert.deepEqual(clone(await stale.main.loadChartView("owner", viewKey)), full(camera(19, -31)));
});

test("both engines carry live spacing and signed gap across every supported timeframe and reload", async () => {
  for (const engine of ["tradingview", "kline"]) {
    for (const symbol of ["GAZP", "BYBIT:linear:BTCUSDT", "OKX:SWAP:BTC-USDT-SWAP"]) {
      let f = fixture();
      let current = full();
      let previous = "1d";
      await f.main.saveChartView("owner", key(symbol, previous, engine), current);
      for (const timeframes of [f.native, f.native.toReversed()]) {
        for (const timeframe of timeframes) {
          if (timeframe !== previous)
            f.records.set(`view:owner:${key(symbol, timeframe, engine)}`, { value: full(camera(2, 90)) });
          const actual = await f.main.loadChartView("owner", key(symbol, timeframe, engine));
          assert.deepEqual(clone(actual.camera), current.camera);
          if (timeframe !== previous) assert.deepEqual(clone(actual), { camera: current.camera });
          current = full(camera(current.camera.barSpace + 0.25, current.camera.rightOffsetBars - 1));
          await f.main.saveChartView("owner", key(symbol, timeframe, engine), current);
          previous = timeframe;
        }
        f = fixture(f.records);
        assert.deepEqual(clone(await f.main.loadChartView("owner", key(symbol, previous, engine))), current);
        for (const timeframe of f.native.filter((value) => value !== previous))
          assert.deepEqual(clone(await f.main.loadChartView("owner", key(symbol, timeframe, engine))), { camera: current.camera });
      }
      assert.equal(await f.main.loadChartView("other", key(symbol, "1m", engine)), undefined);
      assert.equal(await f.main.loadChartView("owner", key(symbol, "1m", engine === "kline" ? "tradingview" : "kline")), undefined);
    }
  }
});

function callbackFixture(hooks = {}, workspace = false) {
  const f = fixture(undefined, hooks);
  const cloudSession = {};
  let view = full(camera(5, 5));
  let state = {
    owner: "owner", chartRevision: 0, authenticated: true, marketReady: true,
    profileTransition: false, importingBackup: false, importRecoveryRequired: false,
    workspaceMigrationIncomplete: false, loading: false, historyViewReady: true,
    preferences: { symbol: "GAZP", timeframe: "1d", engine: "tradingview", rangeDays: 365 },
    rows: [{ symbol: "GAZP", uid: "uid-GAZP" }]
  };
  const chart = {
    source: { owner: state.owner, viewKey: key("GAZP", "1d"), uid: "uid-GAZP" },
    getView: () => clone(view)
  };
  const controller = {
    ...(workspace ? { workspaceSlot: 2 } : {}),
    chart,
    getSnapshot: () => state,
    subscribe: () => () => {},
    sessionKey: () => chart,
    cloudSessionKey: () => cloudSession,
    notify: () => {}
  };
  const sync = f.load("screens/terminal/controller-camera-sync.ts");
  const callbacks = sync.cameraCallbacks(controller, () => chart, () => true, (owner, viewKey, value) =>
    workspace ? f.workspace.saveWorkspaceView(owner, 2, viewKey, value) : f.main.saveChartView(owner, viewKey, value));
  return {
    ...f, controller, sync, callbacks,
    capture: () => f.load("screens/terminal/controller-camera.ts").saveControllerView(controller),
    view: (spacing) => { view = full(camera(spacing, spacing)); return view; },
    switch: () => { state = { ...state, preferences: { ...state.preferences, timeframe: "1h" } }; }
  };
}

for (const workspace of [false, true]) {
  test(`${workspace ? "workspace" : "main"} queued callback snapshots cannot overwrite the outgoing live camera`, async () => {
    const a = deferred(), enteredA = deferred(), c = deferred(), enteredC = deferred();
    const started = [];
    const f = callbackFixture({ put: async (record) => {
      if (!record.id.startsWith(workspace ? "workspace-camera:" : "view:")) return;
      const spacing = record.value.camera.barSpace;
      started.push(spacing);
      if (spacing === 5) { enteredA.resolve(); await a.promise; }
      if (spacing === 20) { enteredC.resolve(); await c.promise; }
    } }, workspace);
    f.callbacks.onCameraChange(f.view(5));
    await enteredA.promise;
    f.callbacks.onCameraChange(f.view(10));
    f.callbacks.onCameraChange(f.view(20));
    const outgoing = f.capture();
    a.resolve();
    await enteredC.promise;
    c.resolve();
    await outgoing;
    f.switch();
    await f.sync.flushCamera(f.controller);
    assert.deepEqual(started, [5, 20]);
    const restored = workspace
      ? await f.workspace.loadWorkspaceView("owner", 2, key("GAZP", "1h"))
      : await f.main.loadChartView("owner", key("GAZP", "1h"));
    assert.equal(restored.camera.barSpace, 20);
  });
}

test("a live capture fences the latest queued callback even before its own settle event", async () => {
  const gate = deferred(), entered = deferred();
  const started = [];
  const f = callbackFixture({ put: async (record) => {
    if (!record.id.startsWith("view:")) return;
    started.push(record.value.camera.barSpace);
    if (record.value.camera.barSpace === 5) { entered.resolve(); await gate.promise; }
  } });
  f.callbacks.onCameraChange(f.view(5));
  await entered.promise;
  f.callbacks.onCameraChange(f.view(10));
  f.view(20);
  const outgoing = f.capture();
  gate.resolve();
  await outgoing;
  await f.sync.flushCamera(f.controller);
  assert.deepEqual(started, [5, 20]);
  assert.equal((await f.main.loadChartView("owner", key("GAZP", "1h"))).camera.barSpace, 20);
});

test("queued settled events coalesce and an old completion keeps a newer pending intent", async () => {
  const gate = deferred(), entered = deferred();
  const started = [];
  const f = callbackFixture({ put: async (record) => {
    if (!record.id.startsWith("view:")) return;
    started.push(record.value.camera.barSpace);
    if (record.value.camera.barSpace === 5) { entered.resolve(); await gate.promise; }
  } });
  f.callbacks.onCameraIntent();
  f.callbacks.onCameraChange(f.view(5));
  await entered.promise;
  f.callbacks.onCameraChange(f.view(10));
  f.callbacks.onCameraChange(f.view(20));
  f.callbacks.onCameraIntent();
  gate.resolve();
  await f.sync.flushCamera(f.controller);
  assert.deepEqual(started, [5, 20]);
  assert.equal(f.sync.cameraPending(f.controller), true);
  await f.capture();
  assert.equal(f.sync.cameraPending(f.controller), false);
});

test("old explicit captures do not clear a newer pending intent", async () => {
  const gate = deferred(), entered = deferred();
  const f = callbackFixture({ put: async (record) => {
    if (record.id.startsWith("view:")) { entered.resolve(); await gate.promise; }
  } });
  f.callbacks.onCameraIntent();
  const outgoing = f.capture();
  await entered.promise;
  f.callbacks.onCameraIntent();
  gate.resolve();
  await outgoing;
  assert.equal(f.sync.cameraPending(f.controller), true);
});

test("legacy timeframe camera remains a fallback until a new shared camera is saved", async () => {
  const f = fixture();
  f.records.set("chart-camera:physical:owner:kline:1d", { value: { symbol: "GAZP", camera: camera(6, 4) } });
  f.records.set("chart-camera:physical:owner:kline:1h", { value: { symbol: "GAZP", camera: camera(3, 8) } });
  assert.deepEqual(clone(await f.main.loadChartView("owner", key("GAZP", "1d", "kline"))), { camera: camera(6, 4) });
  assert.deepEqual(clone(await f.main.loadChartView("owner", key("GAZP", "1h", "kline"))), { camera: camera(3, 8) });
  await f.main.saveChartView("owner", key("GAZP", "1m", "kline"), full());
  assert.deepEqual(clone(await f.main.loadChartView("owner", key("GAZP", "1d", "kline"))), { camera: camera() });
  assert.equal(f.records.size, 4);
});

test("workspace cameras share timeframes while owners, slots, instruments and engines remain independent", async () => {
  let f = fixture();
  for (const engine of ["tradingview", "kline"]) {
    const view = full(camera(engine === "kline" ? 15 : 8, -32));
    await f.workspace.saveWorkspaceView("owner", 2, key("GAZP", "1d", engine), view);
    for (const timeframe of f.native) {
      const restored = await f.workspace.loadWorkspaceView("owner", 2, key("GAZP", timeframe, engine));
      assert.deepEqual(clone(restored), timeframe === "1d" ? view : { camera: view.camera });
    }
    assert.equal(await f.workspace.loadWorkspaceView("owner", 1, key("GAZP", "1h", engine)), undefined);
    assert.equal(await f.workspace.loadWorkspaceView("other", 2, key("GAZP", "1h", engine)), undefined);
    assert.equal(await f.workspace.loadWorkspaceView("owner", 2, key("SBER", "1h", engine)), undefined);
    f = fixture(f.records);
    assert.deepEqual(clone(await f.workspace.loadWorkspaceView("owner", 2, key("GAZP", "1h", engine))), { camera: view.camera });
  }
});

for (const workspace of [false, true]) {
  test(`${workspace ? "workspace" : "main"} async writes and reads preserve the latest camera before persistence and after reload`, async () => {
    const gate = deferred();
    let blocked = true;
    const hooks = { put: async () => { if (blocked) await gate.promise; } };
    let f = fixture(undefined, hooks);
    const save = (timeframe, value) => workspace
      ? f.workspace.saveWorkspaceView("owner", 2, key("GAZP", timeframe), value)
      : f.main.saveChartView("owner", key("GAZP", timeframe), value);
    const read = (timeframe) => workspace
      ? f.workspace.loadWorkspaceView("owner", 2, key("GAZP", timeframe))
      : f.main.loadChartView("owner", key("GAZP", timeframe));
    const first = save("1d", full(camera(5, 4)));
    const latest = full(camera(17, -44));
    const second = save("1h", latest);
    assert.deepEqual(clone(await read("1m")), { camera: latest.camera });
    assert.deepEqual(clone(await read("1h")), latest);
    blocked = false;
    gate.resolve();
    await Promise.all([first, second]);
    const staleRead = deferred();
    hooks.get = async () => staleRead.promise;
    const pending = read("1m");
    await new Promise(setImmediate);
    const newest = full(camera(21, -61));
    await save("1w", newest);
    staleRead.resolve();
    assert.deepEqual(clone(await pending), { camera: newest.camera });
    f = fixture(f.records);
    assert.deepEqual(clone(await read("1w")), newest);
    assert.deepEqual(clone(await read("1m")), { camera: newest.camera });
  });
}

test("main timeframe switch snapshots the actual adapter and rapid requests retain latest intent", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const live = full(camera(19, -15));
  f.controller.chart.getView = () => clone(live);
  const gate = deferred();
  const entered = deferred();
  f.hooks.saveView = async () => { entered.resolve(); await gate.promise; };
  const first = f.controller.setTimeframe("1h");
  await entered.promise;
  const latest = f.controller.setTimeframe("1w");
  gate.resolve();
  await Promise.all([first, latest]);
  assert.equal(f.controller.getSnapshot().preferences.timeframe, "1w");
  const restored = await f.load("services/chart-camera.ts").loadChartView("owner-A", key("GAZP", "1w"));
  assert.deepEqual(clone(restored), { camera: live.camera });
  assert.equal(f.requests.length, 1);
});

test("auxiliary timeframe intent captures its current camera before the route changes", async (t) => {
  const f = await routingFixture();
  t.after(() => f.close());
  const parent = f.controller.getSnapshot();
  Object.assign(f.client, {
    addEventListener() {}, removeEventListener() {}, serverNow: () => Date.now(),
    watchCandles: () => () => {},
    loadCandles: async () => ({ candles: parent.candles, cached: true, requests: 0 })
  });
  const { WorkspacePanelController } = f.load("screens/terminal/workspace-panel-controller.ts");
  const panel = new WorkspacePanelController(f.controller, 2, () => {});
  t.after(() => { panel.stop(); panel.dispose(); });
  panel.configure(parent.rows[0], parent);
  await until(() => panel.getSnapshot().annotationReady && !panel.getSnapshot().loading, "auxiliary ready");
  const view = full(camera(22, -66));
  const initial = panel.getSnapshot().preferences;
  panel.chart = {
    source: { owner: parent.owner, viewKey: key(initial.symbol, initial.timeframe, initial.engine), uid: parent.rows[0].uid },
    getView: () => clone(view)
  };
  await panel.setTimeframe("1h");
  const restored = await f.load("services/workspace-camera.ts").loadWorkspaceView(parent.owner, 2, key(initial.symbol, "1h", initial.engine));
  assert.deepEqual(clone(restored), { camera: view.camera });
  assert.equal(f.controller.getSnapshot().preferences.timeframe, "1d");
});
