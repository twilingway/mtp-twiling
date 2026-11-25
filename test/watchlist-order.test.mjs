import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const modules = new Map();
const preferenceWrites = [];
let viewReads = 0;
const storageBoundary = {
  savePreferences: async (owner, preferences) =>
    preferenceWrites.push({ owner, preferences: structuredClone(preferences) }),
  loadDrawings: async () => [],
  loadImages: async () => []
};
function load(relative) {
  const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
  assert.ok(filename.startsWith(sourceRoot));
  if (/services[\\/]storage(?:-v2)?\.ts$/.test(filename)) return storageBoundary;
  if (/services[\\/]chart-camera\.ts$/.test(filename))
    return new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "loadChartView"
            ? async () => {
                viewReads++;
                return undefined;
              }
            : () => assert.fail("reorder must not access chart/profile storage")
      }
    );
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInThisContext()(
    (specifier) => {
      assert.ok(specifier.startsWith("."));
      return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)));
    },
    module,
    module.exports
  );
  return module.exports;
}
const { moveWatchlistRow } = load("services/watchlist-order.ts");
const { TBankClient } = load("services/tbank-client.ts");
const { TerminalController } = load("screens/terminal/controller.ts");
const { selectedMarketRow, pinSelectedInstrument } = load("model/selected-instrument.ts");
const { validateBackup, isProfilePreferences } = load("model/backup-format.ts");
const row = (symbol, uid = `uid-${symbol}`) => ({
  symbol,
  ticker: symbol,
  uid,
  figi: null,
  name: symbol,
  color: "#5476bc",
  mark: symbol[0],
  currency: "rub",
  step: 1,
  price: null,
  previousClose: null,
  availability: "pending"
});
const symbols = (rows) => rows.map((item) => item.symbol);
const position = (rows, index) => ({ index, uid: rows[index].uid, symbol: rows[index].symbol });
const move = (rows, source, target, placement = "before") => ({
  source: position(rows, source),
  target: position(rows, target),
  placement
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
function fixture(initial = [row("ONE"), row("TWO"), row("THREE"), row("FOUR")]) {
  let saved = structuredClone(initial);
  const writes = [],
    sent = [],
    requests = [];
  const cache = {
    saveWatchlistSnapshot: async (owner, rows) => {
      writes.push({ owner, rows: [...rows] });
      saved = structuredClone(rows);
    },
    saveMarket: async () => {}
  };
  const client = new TBankClient("unit-test-only-not-real", "Test", cache);
  client.rows = initial;
  client.owner = "profile-one";
  client.send = (message) => sent.push(message);
  client.request = async (service, method, body) => {
    requests.push({ service, method, body });
    return {};
  };
  return { client, cache, writes, sent, requests, saved: () => saved };
}

test("every insertion preserves the complete permutation and moves before/after the target", () => {
  const rows = [row("ONE"), row("HIDDEN"), row("THREE"), row("FOUR"), row("FIVE")];
  for (let source = 0; source < rows.length; source++) {
    for (let target = 0; target < rows.length; target++) {
      for (const placement of ["before", "after"]) {
        const result = moveWatchlistRow(rows, move(rows, source, target, placement));
        if (source === target) {
          assert.equal(result, null);
          continue;
        }
        assert.equal(result.length, rows.length);
        assert.equal(new Set(result).size, rows.length);
        assert.deepEqual(
          result.filter((item) => item !== rows[source]),
          rows.filter((item) => item !== rows[source])
        );
        assert.equal(
          result.indexOf(rows[source]),
          result.indexOf(rows[target]) + (placement === "after" ? 1 : -1)
        );
      }
    }
  }
  assert.deepEqual(symbols(rows), ["ONE", "HIDDEN", "THREE", "FOUR", "FIVE"]);
});

test("nullable and duplicate UIDs address one indexed row without coalescing records", () => {
  const rows = [
    row("MISSING", null),
    row("OTHER", null),
    row("FIRST", "same"),
    row("SECOND", "same"),
    row("FIRST", "same")
  ];
  const result = moveWatchlistRow(rows, move(rows, 4, 0));
  assert.equal(result[0], rows[4]);
  assert.equal(result[3], rows[2]);
  assert.deepEqual(result.slice(1), rows.slice(0, 4));
  assert.deepEqual(symbols(moveWatchlistRow(rows, move(rows, 0, 1, "after"))), [
    "OTHER",
    "MISSING",
    "FIRST",
    "SECOND",
    "FIRST"
  ]);
  assert.equal(
    moveWatchlistRow(rows, {
      ...move(rows, 3, 0),
      source: { ...position(rows, 3), symbol: "FIRST" }
    }),
    null
  );
  assert.equal(
    moveWatchlistRow(rows, {
      ...move(rows, 0, 1),
      source: { ...position(rows, 0), uid: "different" }
    }),
    null
  );
});

test("reorder persists before publication and changes neither API subscriptions nor selection/camera", async () => {
  const f = fixture();
  const controller = new TerminalController();
  controller.session.client = f.client;
  controller.update({ owner: f.client.owner, rows: f.client.rows });
  controller.chart = { getView: () => assert.fail("reorder must not read or save camera") };
  const preferences = controller.getSnapshot().preferences;
  const candles = controller.getSnapshot().candles;
  const drawings = controller.getSnapshot().drawings;
  let states = 0;
  f.client.addEventListener("state", () => states++);
  assert.equal(await controller.reorderWatchlist(move(f.client.rows, 3, 0), f.client.owner), true);
  assert.deepEqual(symbols(f.saved()), ["FOUR", "ONE", "TWO", "THREE"]);
  assert.deepEqual(symbols(controller.getSnapshot().rows), symbols(f.saved()));
  assert.equal(controller.getSnapshot().preferences, preferences);
  assert.equal(controller.getSnapshot().candles, candles);
  assert.equal(controller.getSnapshot().drawings, drawings);
  assert.equal(states, 1);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.requests, []);
  assert.equal(f.writes[0].owner, "profile-one");
});

test("failed persistence leaves visible/persisted order intact and queue remains usable", async () => {
  const f = fixture();
  const original = f.client.rows;
  const save = f.cache.saveWatchlistSnapshot;
  f.cache.saveWatchlistSnapshot = async () => {
    throw new Error("simulated storage failure");
  };
  let states = 0;
  f.client.addEventListener("state", () => states++);
  await assert.rejects(
    f.client.reorderWatchlist(move(original, 3, 0)),
    /simulated storage failure/
  );
  assert.equal(f.client.rows, original);
  assert.deepEqual(symbols(f.saved()), symbols(original));
  assert.equal(states, 0);
  f.cache.saveWatchlistSnapshot = save;
  assert.equal(await f.client.reorderWatchlist(move(original, 3, 0)), true);
  assert.deepEqual(symbols(f.client.rows), ["FOUR", "ONE", "TWO", "THREE"]);
});

test("delayed commit retains live quote objects and serializes addition/removal without row loss", async () => {
  const f = fixture();
  const save = f.cache.saveWatchlistSnapshot;
  const entered = deferred(),
    release = deferred();
  f.cache.saveWatchlistSnapshot = async (owner, rows) => {
    entered.resolve();
    await release.promise;
    await save(owner, rows);
  };
  const changing = f.client.reorderWatchlist(move(f.client.rows, 3, 0));
  await entered.promise;
  assert.deepEqual(symbols(f.client.rows), ["ONE", "TWO", "THREE", "FOUR"]);
  f.client.applyPrice({
    instrumentUid: "uid-ONE",
    price: { units: "42", nano: 0 },
    time: "2026-11-25T10:00:00Z"
  });
  const adding = f.client.addInstrument({
    uid: "uid-FIVE",
    ticker: "FIVE",
    name: "Five",
    currency: "rub",
    minPriceIncrement: { units: "1", nano: 0 }
  });
  const removing = f.client.removeInstrument({ uid: "uid-TWO", symbol: "TWO" });
  release.resolve();
  await Promise.all([changing, adding, removing]);
  assert.deepEqual(symbols(f.client.rows), ["FOUR", "ONE", "THREE", "FIVE"]);
  assert.deepEqual(symbols(f.saved()), symbols(f.client.rows));
  assert.equal(f.client.rows.find((item) => item.symbol === "ONE").price, 42);
  await f.client.close();
});

test("self/stale positions and old profile cannot write; profile switch during commit cannot overwrite new state", async () => {
  const f = fixture();
  assert.equal(await f.client.reorderWatchlist(move(f.client.rows, 0, 0)), false);
  assert.equal(
    await f.client.reorderWatchlist({
      ...move(f.client.rows, 0, 1),
      target: { ...position(f.client.rows, 1), index: 9 }
    }),
    false
  );
  assert.equal(f.writes.length, 0);
  const controller = new TerminalController();
  controller.session.client = f.client;
  controller.update({ owner: f.client.owner, rows: f.client.rows });
  assert.equal(
    await controller.reorderWatchlist(move(f.client.rows, 3, 0), "profile-other"),
    false
  );
  assert.equal(f.writes.length, 0);
  const entered = deferred(),
    release = deferred();
  f.cache.saveWatchlistSnapshot = async () => {
    entered.resolve();
    await release.promise;
  };
  const pending = controller.reorderWatchlist(move(f.client.rows, 3, 0), f.client.owner);
  await entered.promise;
  const newRows = [row("NEW")];
  controller.update({ owner: "profile-new", rows: newRows });
  controller.session.client = null;
  release.resolve();
  assert.equal(await pending, false);
  assert.equal(controller.getSnapshot().owner, "profile-new");
  assert.equal(controller.getSnapshot().rows, newRows);
});

test("selection supports legacy symbol/null UID and refuses a missing explicit UID without fallback", () => {
  const rows = [
    row("SAME", "first"),
    row("SAME", "second"),
    row("MISSING", null),
    row("ALIAS", "first")
  ];
  assert.equal(selectedMarketRow(rows, { symbol: "SAME" }), rows[0]);
  assert.equal(selectedMarketRow(rows, { symbol: "SAME", instrumentUid: "second" }), rows[1]);
  assert.equal(selectedMarketRow(rows, { symbol: "SAME", instrumentUid: "unknown" }), undefined);
  assert.equal(selectedMarketRow(rows, { symbol: "SAME", instrumentUid: null }), undefined);
  assert.equal(selectedMarketRow(rows, { symbol: "MISSING", instrumentUid: null }), rows[2]);
  assert.equal(selectedMarketRow(rows, { symbol: "ALIAS", instrumentUid: "first" }), rows[3]);
  assert.deepEqual(pinSelectedInstrument(rows, { symbol: "SAME" }), {
    symbol: "SAME",
    instrumentUid: "first"
  });
});

test("legacy duplicate-symbol selection is pinned before reorder; in-flight history completes without changing adapter/camera", async () => {
  const f = fixture([row("SAME", "uid-one"), row("SAME", "uid-two")]);
  const controller = new TerminalController();
  controller.session.client = f.client;
  controller.update({
    owner: f.client.owner,
    authenticated: true, marketReady: true,
    rows: f.client.rows,
    preferences: { ...controller.getSnapshot().preferences, symbol: "SAME", engine: "kline" }
  });
  const entered = deferred(),
    result = deferred();
  f.client.candles = (_symbol, _timeframe, _range, options) => {
    assert.equal(options.uid, "uid-one");
    entered.resolve();
    return result.promise;
  };
  const adapter = {
    source: { owner: f.client.owner, uid: "uid-one", viewKey: "SAME:1d:kline:365" },
    getView: () => assert.fail("reorder must preserve existing camera")
  };
  controller.chart = adapter;
  const loading = controller.loadHistory();
  await entered.promise;
  assert.equal(controller.getSnapshot().loading, true);
  const readsBeforeReorder = viewReads;
  assert.equal(await controller.reorderWatchlist(move(f.client.rows, 1, 0), f.client.owner), true);
  assert.equal(viewReads, readsBeforeReorder, "reorder must not reload the saved camera");
  const reordered = controller.getSnapshot();
  assert.equal(reordered.preferences.instrumentUid, "uid-one");
  assert.equal(reordered.preferences.engine, "kline");
  assert.equal(selectedMarketRow(reordered.rows, reordered.preferences).uid, "uid-one");
  assert.equal(controller.chart, adapter);
  assert.equal(preferenceWrites.at(-1).preferences.instrumentUid, "uid-one");
  const bars = [{ timestamp: 1700000000000, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
  result.resolve({ candles: bars, cached: true, requests: 0 });
  await loading;
  assert.equal(controller.getSnapshot().loading, false);
  assert.deepEqual(controller.getSnapshot().candles, bars);
  assert.equal(controller.chart, adapter);
});

test("duplicate UID aliases keep the exact selected symbol metadata after reorder", async () => {
  const f = fixture([row("FIRST", "shared"), row("SECOND", "shared")]);
  const controller = new TerminalController();
  controller.session.client = f.client;
  controller.update({
    owner: f.client.owner,
    rows: f.client.rows,
    preferences: {
      ...controller.getSnapshot().preferences,
      symbol: "SECOND",
      instrumentUid: "shared"
    }
  });
  await controller.reorderWatchlist(move(f.client.rows, 1, 0), f.client.owner);
  assert.equal(
    selectedMarketRow(controller.getSnapshot().rows, controller.getSnapshot().preferences).symbol,
    "SECOND"
  );
});

test("candles uses explicit UID for cache/REST/subscription; missing UID rejects and legacy callers still work", async () => {
  const f = fixture([row("SAME", "uid-one"), row("SAME", "uid-two")]);
  const calls = [];
  f.cache.loadHistory = async (_owner, uid) => {
    calls.push(["cache", uid]);
    return [];
  };
  f.cache.loadCoverage = async (_owner, uid) => {
    calls.push(["coverage", uid]);
    return [];
  };
  f.cache.saveHistory = async (_owner, uid) => calls.push(["save", uid]);
  f.client.request = async (_service, _method, body) => {
    calls.push(["request", body.instrumentId]);
    return { candles: [] };
  };
  f.client.subscribeCandles = (uid) => calls.push(["subscription", uid]);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  try {
    const range = { from: Date.now() - 60000, to: Date.now() };
    await f.client.candles("SAME", "1m", range, { uid: "uid-two" });
    assert.ok(calls.length >= 5);
    assert.ok(calls.every(([, uid]) => uid === "uid-two"));
    calls.length = 0;
    await assert.rejects(f.client.candles("SAME", "1m", range, { uid: "missing" }), /недоступен/);
    assert.deepEqual(calls, []);
    await f.client.candles("SAME", "1m", range);
    assert.ok(calls.every(([, uid]) => uid === "uid-one"));
    calls.length = 0;
    const abort = new AbortController();
    f.cache.loadCoverage = async () => {
      abort.abort();
      return [{ from: range.from, to: range.to, fetchedAt: Date.now() }];
    };
    await assert.rejects(
      f.client.candles("SAME", "1m", range, { uid: "uid-two", signal: abort.signal }),
      { name: "AbortError" }
    );
    assert.equal(
      calls.some(([type]) => type === "subscription"),
      false
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});

test("selected UID accepts nullable/legacy backup layout and rejects invalid values", () => {
  for (const instrumentUid of ["uid-one", null]) {
    const layout = { symbol: "SAME", instrumentUid };
    assert.equal(isProfilePreferences(layout), true);
    assert.deepEqual(
      validateBackup({
        application: "personal-terminal",
        schemaVersion: 1,
        layout,
        drawings: [],
        images: []
      }).layout,
      layout
    );
  }
  assert.equal(isProfilePreferences({ symbol: "SAME" }), true);
  for (const instrumentUid of ["", 42, {}, [], "x".repeat(201)])
    assert.equal(isProfilePreferences({ symbol: "SAME", instrumentUid }), false);
});

test("switching UIDs with the same symbol resets history and rejects late old candles without a loading hang", async () => {
  const f = fixture([row("SAME", "uid-one"), row("SAME", "uid-two")]);
  const controller = new TerminalController();
  controller.session.client = f.client;
  controller.update({
    owner: f.client.owner,
    authenticated: true, marketReady: true,
    rows: f.client.rows,
    preferences: {
      ...controller.getSnapshot().preferences,
      symbol: "SAME",
      instrumentUid: "uid-one"
    }
  });
  const enteredOne = deferred(),
    enteredTwo = deferred(),
    first = deferred(),
    second = deferred();
  const signals = [];
  f.client.candles = (_symbol, _timeframe, _range, options) => {
    signals.push(options.signal);
    (options.uid === "uid-one" ? enteredOne : enteredTwo).resolve();
    return options.uid === "uid-one" ? first.promise : second.promise;
  };
  const originalLoading = controller.loadHistory();
  await enteredOne.promise;
  const selecting = controller.setPreferences({ symbol: "SAME", instrumentUid: "uid-two" });
  await enteredTwo.promise;
  assert.equal(signals[0].aborted, true);
  first.resolve({ candles: [{ timestamp: 1, close: 999 }], cached: true, requests: 0 });
  await originalLoading;
  assert.equal(controller.getSnapshot().loading, true);
  assert.deepEqual(controller.getSnapshot().candles, []);
  const bars = [{ timestamp: 2, close: 42 }];
  second.resolve({ candles: bars, cached: true, requests: 0 });
  await selecting;
  assert.equal(controller.getSnapshot().preferences.instrumentUid, "uid-two");
  assert.equal(controller.getSnapshot().loading, false);
  assert.deepEqual(controller.getSnapshot().candles, bars);
});

test("snapshot pinning retains selection across repeated live snapshots and explicit missing UID stays missing", () => {
  const f = fixture([row("SAME", "uid-one"), row("SAME", "uid-two")]);
  const controller = new TerminalController();
  controller.update({
    owner: f.client.owner,
    preferences: { ...controller.getSnapshot().preferences, symbol: "SAME" }
  });
  controller.session.applyBankState(f.client.snapshot());
  assert.equal(controller.getSnapshot().preferences.instrumentUid, "uid-one");
  f.client.rows.reverse();
  controller.session.applyBankState(f.client.snapshot());
  assert.equal(controller.getSnapshot().preferences.instrumentUid, "uid-one");
  assert.equal(
    selectedMarketRow(controller.getSnapshot().rows, controller.getSnapshot().preferences).uid,
    "uid-one"
  );
  controller.update({
    preferences: { ...controller.getSnapshot().preferences, instrumentUid: "missing" }
  });
  controller.session.applyBankState(f.client.snapshot());
  assert.equal(
    selectedMarketRow(controller.getSnapshot().rows, controller.getSnapshot().preferences),
    undefined
  );
});

test("an asynchronous addDrawing cannot select a stale drawing after a same-symbol UID switch", async () => {
  const f = fixture([row("SAME", "uid-one"), row("SAME", "uid-two")]);
  const controller = new TerminalController();
  controller.update({
    owner: f.client.owner,
    rows: f.client.rows,
    preferences: {
      ...controller.getSnapshot().preferences,
      symbol: "SAME",
      instrumentUid: "uid-one"
    }
  });
  const write = deferred();
  controller.setDrawings = () => write.promise;
  const adding = controller.addDrawing({ id: "old-drawing" });
  controller.update({
    preferences: { ...controller.getSnapshot().preferences, instrumentUid: "uid-two" }
  });
  write.resolve();
  await adding;
  assert.equal(controller.getSnapshot().selectedObject, null);
});
