import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const day = 86_400_000;
const now = Date.UTC(2026, 10, 28);
const immediate = () => new Promise((resolve) => setImmediate(resolve));
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
test.afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
};
const body = (timestamp, close = 50) => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1
});
const instrument = (symbol) => ({
  uid: symbol,
  symbol,
  ticker: symbol,
  name: symbol,
  availability: "available"
});

function fixtures(annotations = async () => ({ drawings: [], images: [] })) {
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    configurable: true
  });
  class TerminalController {
    state = {
      chartRevision: 0,
      owner: "guest",
      rows: [],
      preferences: {},
      candles: [],
      drawings: [],
      images: []
    };
    drawingSettings = { setDialog: (dialog) => this.update({ dialog }) };
    editing = { reset() {} };
    constructor(slot) {
      this.workspaceSlot = slot;
    }
    getSnapshot() {
      return this.state;
    }
    update(patch) {
      this.state = { ...this.state, ...patch };
    }
  }
  const load = sourceLoader({
    "screens/terminal/controller.ts": { TerminalController },
    "screens/terminal/workspace-annotations.ts": { readWorkspaceAnnotations: annotations }
  });
  const market = new EventTarget();
  const requests = [];
  const watches = [];
  market.serverNow = () => now;
  market.loadCandles = (symbol, timeframe, range, options) => {
    const gate = deferred();
    requests.push({ symbol, timeframe, range, options, ...gate });
    return gate.promise;
  };
  market.watchCandles = (uid, timeframe, listener, signal) => {
    const watch = { uid, timeframe, listener, signal, released: false };
    watches.push(watch);
    return () => {
      watch.released = true;
    };
  };
  const first = instrument("FIRST");
  const second = instrument("SECOND");
  const state = {
    owner: "owner-one",
    ready: true,
    status: "connected",
    marketReady: true,
    authenticated: true,
    rows: [first, second],
    preferences: {
      timeframe: "1h",
      engine: "tradingview",
      rangeDays: 1,
      indicators: { ma: true },
      chartSettings: { theme: "dark" }
    }
  };
  const root = {
    getSnapshot: () => state,
    sessionKey: () => market,
    marketNow: () => now,
    async setPreferences() {
      assert.fail("secondary chart wrote primary preferences");
    }
  };
  const { WorkspacePanelController, loadWorkspaceInstrument, saveWorkspaceInstrument } = load(
    "screens/terminal/workspace-panel-controller.js"
  );
  const selection = [];
  const create = (slot) => new WorkspacePanelController(root, slot, (uid) => selection.push(uid));
  return {
    create,
    first,
    second,
    selection,
    state,
    market,
    requests,
    watches,
    loadWorkspaceInstrument,
    saveWorkspaceInstrument,
    load
  };
}

test("timeframe, depth, engine and price style belong to one slot across reopen and owner changes", async () => {
  const f = fixtures();
  const panel = f.create(6);
  panel.configure(f.first, f.state);
  await immediate();
  await panel.setPreferences({
    timeframe: "4h",
    rangeDays: 90,
    engine: "kline",
    chartSettings: { theme: "dark", lastPriceColor: "#7b3fb9" }
  });
  await immediate();
  assert.equal(f.watches[0].released, true);
  assert.equal(f.watches[1].timeframe, "4h");
  f.state.preferences = {
    ...f.state.preferences,
    timeframe: "1d",
    rangeDays: 5,
    engine: "tradingview"
  };
  panel.configure(f.first, f.state);
  assert.equal(f.watches.length, 2);
  assert.equal(panel.getSnapshot().preferences.rangeDays, 90);
  assert.equal(panel.getSnapshot().preferences.engine, "kline");
  assert.equal(panel.getSnapshot().preferences.chartSettings.lastPriceColor, "#7b3fb9");
  await immediate();
  await panel.setPreferences({ chartSettings: { theme: "dark" } });
  assert.equal(panel.getSnapshot().preferences.chartSettings.lastPriceColor, undefined);
  panel.stop();
  const reopened = f.create(6);
  reopened.configure(f.first, f.state);
  assert.equal(reopened.getSnapshot().preferences.timeframe, "4h");
  assert.equal(reopened.getSnapshot().preferences.rangeDays, 90);
  assert.equal(reopened.getSnapshot().preferences.engine, "kline");
  reopened.stop();
  f.state.owner = "owner-two";
  const other = f.create(6);
  other.configure(f.first, f.state);
  assert.equal(other.getSnapshot().preferences.timeframe, "1d");
  assert.equal(other.getSnapshot().preferences.rangeDays, 5);
  assert.equal(other.getSnapshot().preferences.indicators.ma, false);
  other.stop();
  f.saveWorkspaceInstrument("owner-one", 6, "");
  f.saveWorkspaceInstrument("owner-two", 6, "SECOND");
  assert.equal(f.loadWorkspaceInstrument("owner-one", 6), "");
  assert.equal(f.loadWorkspaceInstrument("owner-two", 6), "SECOND");
  assert.equal(f.loadWorkspaceInstrument("owner-one", 7), undefined);
  f.requests.forEach((request) => request.resolve({ candles: [] }));
});

test("progressively loads the selected depth and preserves older bars through the same live lease", async () => {
  const f = fixtures();
  f.state.preferences = { ...f.state.preferences, rangeDays: 35 };
  const panel = f.create(2);
  panel.configure(f.second, f.state);
  await immediate();
  const recent = f.requests[0];
  assert.ok(recent.range.from > now - 35 * day);
  recent.resolve({ candles: [body(now - day)] });
  await immediate();
  assert.equal(panel.getSnapshot().candles.length, 1);
  const older = f.requests[1];
  assert.equal(older.range.to, recent.range.from);
  older.resolve({ candles: [body(older.range.from)] });
  await immediate();
  const oldest = f.requests[2];
  assert.equal(oldest.range.from, now - 35 * day);
  oldest.resolve({ candles: [body(oldest.range.from)] });
  await immediate();
  assert.equal(f.watches.length, 1);
  const { TIMEFRAMES } = f.load("model/history-codec.js");
  f.watches[0].listener({ uid: "SECOND", interval: TIMEFRAMES["1h"].stream, bar: body(now, 74) });
  assert.deepEqual(
    panel.getSnapshot().candles.map(({ timestamp }) => timestamp),
    [oldest.range.from, older.range.from, now - day, now]
  );
  panel.stop();
});

test("late history and annotations cannot cross an instrument change", async () => {
  const firstDocument = deferred();
  const f = fixtures((_, symbol) =>
    symbol === "FIRST"
      ? firstDocument.promise
      : Promise.resolve({ drawings: [{ id: "second" }], images: [] })
  );
  const panel = f.create(9);
  panel.configure(f.first, f.state);
  assert.equal(panel.getSnapshot().annotationReady, false);
  await immediate();
  const firstRequest = f.requests[0];
  panel.configure(f.second, f.state);
  await immediate();
  assert.equal(firstRequest.options.signal.aborted, true);
  assert.equal(f.watches[0].released, true);
  firstDocument.resolve({ drawings: [{ id: "first" }], images: [] });
  firstRequest.resolve({ candles: [body(now - day, 100)] });
  f.requests[1].resolve({ candles: [body(now - day, 200)] });
  await immediate();
  assert.equal(panel.getSnapshot().annotationReady, true);
  assert.deepEqual(panel.getSnapshot().drawings, [{ id: "second" }]);
  assert.equal(panel.getSnapshot().candles[0].close, 200);
  await panel.setPreferences({ symbol: "FIRST", instrumentUid: "FIRST" });
  assert.deepEqual(f.selection, ["FIRST"]);
  panel.stop();
});

test("history admissions are limited to four per session and queued aborts never call the provider", async () => {
  const f = fixtures();
  const { loadPanelCandles } = f.load("screens/terminal/workspace-panel-candle-queue.js");
  const abort = new AbortController();
  const ask = (symbol, signal) =>
    loadPanelCandles(f.market, symbol, "1h", { from: 1, to: 2 }, { signal });
  const firstFour = Array.from({ length: 4 }, (_, i) => ask(String(i)));
  const cancelled = ask("cancelled", abort.signal);
  const last = ask("last");
  const check = assert.rejects(cancelled, { name: "AbortError" });
  await immediate();
  assert.equal(f.requests.length, 4);
  abort.abort();
  await check;
  f.requests[0].resolve({ candles: [] });
  await immediate();
  assert.deepEqual(
    f.requests.map(({ symbol }) => symbol),
    ["0", "1", "2", "3", "last"]
  );
  f.requests.slice(1).forEach((request) => request.resolve({ candles: [] }));
  await Promise.all([...firstFour, last]);
});
