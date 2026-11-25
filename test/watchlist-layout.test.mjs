import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const json = (value) => JSON.parse(JSON.stringify(value));
const symbols = (rows) => Array.from(rows, (row) => row.symbol);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Execute production TypeScript unchanged; only the DB and bank transport are fake.
function sources(overrides = {}, globals = {}) {
  const context = vm.createContext({
    ...globals,
    console,
    crypto,
    structuredClone,
    Blob,
    Date,
    EventTarget,
    Event,
    CustomEvent,
    AbortController,
    AbortSignal,
    DOMException,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    fetch: () => assert.fail("unit tests must never access the network"),
    WebSocket: class {
      constructor() {
        assert.fail("unit tests must never open WebSocket");
      }
    }
  });
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const key = path.relative(sourceRoot, filename).replaceAll(path.sep, "/");
    assert.ok(!key.startsWith("../") && !path.isAbsolute(key));
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInContext(
      context
    )(
      (specifier) => {
        assert.ok(specifier.startsWith("."), "source dependency stays local");
        return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)));
      },
      module,
      module.exports
    );
    return module.exports;
  }
  return { load };
}

function row(symbol, uid = `uid-${symbol}`) {
  return {
    symbol,
    ticker: symbol,
    uid,
    figi: null,
    name: `Instrument ${symbol}`,
    color: "#5476bc",
    mark: symbol[0],
    currency: "rub",
    step: 1,
    price: null,
    previousClose: null,
    availability: "pending"
  };
}
function instrument(symbol) {
  return {
    ticker: symbol,
    uid: `uid-${symbol}`,
    name: `Instrument ${symbol}`,
    currency: "rub",
    minPriceIncrement: { units: "1", nano: 0 }
  };
}

function memoryDatabase() {
  const records = new Map();
  const calls = [];
  let failSnapshot = false;
  let snapshotGate;
  let writeTail = Promise.resolve();
  const key = (store, id) => `${store}/${id}`;
  const boundary = {
    flush: async () => {},
    get: async (store, id) => {
      calls.push({ operation: "get", store, id });
      return structuredClone(records.get(key(store, id)));
    },
    all: async (store) => {
      calls.push({ operation: "all", store });
      return structuredClone(
        [...records.entries()]
          .filter(([id]) => id.startsWith(`${store}/`))
          .map(([, value]) => value)
      );
    },
    transaction: async (stores, action) => {
      const writes = [];
      action({
        objectStore: (store) => {
          assert.ok(stores.includes(store), "writes use declared transaction stores");
          return { put: (value) => writes.push({ store, value: structuredClone(value) }) };
        }
      });
      calls.push({ operation: "transaction", stores: Array.from(stores), writes });
      const snapshot =
        writes.some(({ value }) => value.id.startsWith("watchlist:")) &&
        writes.some(({ value }) => value.id.startsWith("market:"));
      // IndexedDB commits overlapping readwrite transactions in creation order.
      const operation = writeTail.then(async () => {
        if (snapshot && snapshotGate) {
          const gate = snapshotGate;
          snapshotGate = undefined;
          gate.entered.resolve();
          await gate.release.promise;
        }
        if (snapshot && failSnapshot) {
          failSnapshot = false;
          throw new Error("simulated transaction abort");
        }
        for (const { store, value } of writes) records.set(key(store, value.id), value);
      });
      writeTail = operation.catch(() => undefined);
      return operation;
    }
  };
  boundary.put = (store, value) =>
    boundary.transaction([store], (tx) => {
      tx.objectStore(store).put(value);
    });
  return {
    boundary,
    records,
    calls,
    failNextSnapshot: () => {
      failSnapshot = true;
    },
    holdNextSnapshot: () => {
      snapshotGate = { entered: deferred(), release: deferred() };
      return snapshotGate;
    }
  };
}

async function fixture(initialRows = [row("ONE"), row("TWO")]) {
  const database = memoryDatabase();
  const requests = [],
    sent = [],
    transports = [],
    historyCalls = [];
  let instrumentGate;
  class BankError extends Error {}
  class FakeBankTransport {
    closed = false;
    constructor(_safeTestToken, callbacks) {
      this.callbacks = callbacks;
      transports.push(this);
    }
    async request(service, method, body = {}) {
      requests.push({ service, method, body: json(body) });
      if (method === "GetLastPrices") return { lastPrices: [] };
      if (method === "GetClosePrices") return { closePrices: [] };
      if (method === "GetInstrumentBy") {
        if (instrumentGate) {
          const gate = instrumentGate;
          instrumentGate = undefined;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return { instrument: instrument(body.id.replace("uid-", "")) };
      }
      assert.fail(`unexpected bank request ${service}/${method}`);
    }
    send(message) {
      sent.push(json(message));
    }
    connect() {
      this.callbacks.open();
    }
    close() {
      this.closed = true;
    }
    serverNow() {
      return Date.now();
    }
  }
  const modules = sources({
    "services/storage-db.ts": database.boundary,
    "services/storage-history.ts": Object.fromEntries(
      ["loadCoverage", "loadHistory", "historyStats", "clearHistory", "saveHistory"].map(
        (method) => [
          method,
          async (...args) => {
            historyCalls.push({ method, args });
            assert.fail(`watchlist removal must not call ${method} without buffered candles`);
          }
        ]
      )
    ),
    "services/tbank-transport.ts": { BankError, BankTransport: FakeBankTransport }
  });
  const storage = modules.load("services/storage.ts");
  const { TBankClient } = modules.load("services/tbank-client.ts");
  const token = "unit-test-only-not-a-real-token";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const owner = [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
  await storage.saveCatalog({
    at: Date.now(),
    shares: [instrument("ONE"), instrument("TWO"), instrument("THREE")],
    futures: [],
    indicatives: []
  });
  await storage.saveWatchlistSnapshot(owner, initialRows);
  const createClient = () => new TBankClient(token, "Unit test", storage);
  const client = createClient();
  await client.start();
  requests.length = sent.length = database.calls.length = 0;
  return {
    client,
    storage,
    database,
    requests,
    sent,
    transports,
    historyCalls,
    owner,
    createClient,
    holdInstrumentLookup: () => {
      instrumentGate = { entered: deferred(), release: deferred() };
      return instrumentGate;
    }
  };
}

function subscriptionMessages(sent, type, action) {
  return sent.flatMap((message) =>
    message[type]?.subscriptionAction === action ? [message[type]] : []
  );
}
const unsubscribe = "SUBSCRIPTION_ACTION_UNSUBSCRIBE";
const subscribe = "SUBSCRIPTION_ACTION_SUBSCRIBE";

test("UID removal persists just its target, unsubscribes prices/candles and preserves annotations/history", async () => {
  const f = await fixture();
  const untouched = [
    ["drawings", { id: `${f.owner}:ONE`, owner: f.owner, items: [{ id: "drawing" }] }],
    ["images", { id: "image", owner: f.owner, symbol: "ONE", blob: new Blob(["fixture"]) }],
    ["history", { id: "history", owner: f.owner, uid: "uid-ONE", data: new Uint8Array([1, 2]) }]
  ];
  for (const [store, value] of untouched) await f.database.boundary.put(store, value);
  f.database.calls.length = 0;
  f.client.subscribeCandles("uid-ONE", "1m");
  f.sent.length = 0;
  let states = 0;
  f.client.addEventListener("state", () => states++);
  await f.client.removeInstrument({ uid: "uid-ONE", symbol: "stale-symbol" });
  assert.deepEqual(symbols(f.client.snapshot().rows), ["TWO"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["TWO"]);
  assert.deepEqual(symbols((await f.storage.loadMarket(f.owner)).rows), ["TWO"]);
  assert.equal(states, 1);
  for (const type of ["subscribeLastPriceRequest", "subscribeCandlesRequest"]) {
    const messages = subscriptionMessages(f.sent, type, unsubscribe);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].instruments.length, 1);
    assert.equal(messages[0].instruments[0].instrumentId, "uid-ONE");
  }
  f.sent.length = 0;
  f.client.connect();
  assert.equal(subscriptionMessages(f.sent, "subscribeCandlesRequest", subscribe).length, 0);
  assert.deepEqual(
    subscriptionMessages(f.sent, "subscribeLastPriceRequest", subscribe).flatMap((message) =>
      message.instruments.map((item) => item.instrumentId)
    ),
    ["uid-TWO"]
  );
  assert.deepEqual(f.historyCalls, []);
  assert.ok(
    f.database.calls.every((call) => call.store === undefined || call.store === "preferences")
  );
  assert.ok(
    f.database.calls
      .filter((call) => call.stores)
      .every((call) => call.stores.every((store) => store === "preferences"))
  );
  for (const [store, value] of untouched)
    assert.deepEqual(await f.database.boundary.get(store, value.id), value);
  await f.client.close();
});

test("unresolved symbols with null UIDs are removed individually and repeated deletion is inert", async () => {
  const f = await fixture([row("MISSING", null), row("OTHER", null), row("ONE")]);
  await f.client.removeInstrument({ uid: null, symbol: "MISSING" });
  assert.deepEqual(symbols(f.client.rows), ["OTHER", "ONE"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["OTHER", "ONE"]);
  assert.equal(f.sent.length, 0);
  const writes = f.database.calls.filter((call) => call.operation === "transaction").length;
  await f.client.removeInstrument({ uid: null, symbol: "MISSING" });
  await f.client.removeInstrument({ uid: "unknown", symbol: "ONE" });
  assert.equal(f.database.calls.filter((call) => call.operation === "transaction").length, writes);
  assert.deepEqual(symbols(f.client.rows), ["OTHER", "ONE"]);
  await f.client.close();
});

test("aborted snapshot keeps visible and persisted rows/subscriptions and permits retry", async () => {
  const f = await fixture();
  f.client.subscribeCandles("uid-ONE", "5m");
  f.sent.length = 0;
  let states = 0;
  f.client.addEventListener("state", () => states++);
  f.database.failNextSnapshot();
  await assert.rejects(f.client.removeInstrument(row("ONE")), /simulated transaction abort/);
  assert.deepEqual(symbols(f.client.rows), ["ONE", "TWO"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["ONE", "TWO"]);
  assert.deepEqual(symbols((await f.storage.loadMarket(f.owner)).rows), ["ONE", "TWO"]);
  assert.equal(states, 0);
  assert.deepEqual(f.sent, []);
  f.client.connect();
  assert.equal(
    subscriptionMessages(f.sent, "subscribeCandlesRequest", subscribe)[0].instruments[0]
      .instrumentId,
    "uid-ONE"
  );
  await f.client.removeInstrument(row("ONE"));
  assert.deepEqual(symbols(f.client.rows), ["TWO"]);
  await f.client.close();
});

test("deleting the final row survives restart without default rows or empty bank subscriptions", async () => {
  const f = await fixture([row("ONE")]);
  await f.client.removeInstrument(row("ONE"));
  assert.deepEqual(symbols(f.client.rows), []);
  assert.deepEqual(symbols((await f.storage.loadMarket(f.owner)).rows), []);
  await f.client.close();
  f.requests.length = f.sent.length = 0;
  const restarted = f.createClient();
  const snapshot = await restarted.start();
  assert.deepEqual(symbols(snapshot.rows), []);
  assert.equal(snapshot.status, "connected");
  assert.equal(snapshot.authenticated, true);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), []);
  assert.deepEqual(f.requests, [
    {
      service: "MarketDataService",
      method: "GetLastPrices",
      body: { instrumentId: ["SBER_TQBR"] }
    }
  ]);
  assert.equal(
    f.sent.some((message) => message.subscribeLastPriceRequest || message.subscribeCandlesRequest),
    false
  );
  await restarted.close();
});

test("snapshot becomes visible only after commit and concurrent addition is retained after removal", async () => {
  const f = await fixture();
  const gate = f.database.holdNextSnapshot();
  const removing = f.client.removeInstrument(row("ONE"));
  await gate.entered.promise;
  const adding = f.client.addInstrument(instrument("THREE"));
  await Promise.resolve();
  assert.deepEqual(symbols(f.client.rows), ["ONE", "TWO"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["ONE", "TWO"]);
  assert.deepEqual(f.sent, []);
  gate.release.resolve();
  await Promise.all([removing, adding]);
  assert.deepEqual(symbols(f.client.rows), ["TWO", "THREE"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["TWO", "THREE"]);
  await f.client.close();
  const restarted = f.createClient();
  await restarted.start();
  assert.deepEqual(symbols(restarted.rows), ["TWO", "THREE"]);
  await restarted.close();
});

test("removal queued behind delayed instrument lookup retains the newly added instrument", async () => {
  const f = await fixture();
  const gate = f.holdInstrumentLookup();
  const detailNeeded = instrument("THREE");
  delete detailNeeded.minPriceIncrement;
  const adding = f.client.addInstrument(detailNeeded);
  await gate.entered.promise;
  const removing = f.client.removeInstrument(row("ONE"));
  await Promise.resolve();
  assert.deepEqual(symbols(f.client.rows), ["ONE", "TWO"]);
  gate.release.resolve();
  await Promise.all([adding, removing]);
  assert.deepEqual(symbols(f.client.rows), ["TWO", "THREE"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["TWO", "THREE"]);
  assert.deepEqual(symbols((await f.storage.loadMarket(f.owner)).rows), ["TWO", "THREE"]);
  await f.client.close();
});

test("panel width clamps preferences and leaves chart and left toolbar space", () => {
  const { panelWidth } = sources().load("model/panel-layout.ts");
  for (const [preferred, viewport, expected] of [
    [0, 1920, 240],
    [239, 1920, 240],
    [240, 1920, 240],
    [720, 1920, 720],
    [721, 1920, 720],
    [2000, 1920, 720],
    [720, 1000, 672],
    [720, 800, 472],
    [720, 568, 240],
    [415.4, 1920, 415],
    [415.6, 1920, 416]
  ]) {
    assert.equal(panelWidth(preferred, viewport), expected);
    assert.ok(viewport - 48 - panelWidth(preferred, viewport) >= 280);
  }
});

test("panel width restores responsive defaults for absent or non-finite preferences", () => {
  const { panelWidth } = sources().load("model/panel-layout.ts");
  for (const preferred of [undefined, NaN, Infinity, -Infinity]) {
    for (const [viewport, expected] of [
      [1920, 420],
      [1700, 420],
      [1699, 380],
      [1201, 380],
      [1200, 340],
      [800, 340],
      [600, 272],
      [400, 240]
    ])
      assert.equal(panelWidth(preferred, viewport), expected);
  }
});

test("sidebar width round-trips through preferences, backup export and import", async () => {
  const f = await fixture([]);
  for (const width of [240, 419.5, 720]) {
    await f.storage.savePreferences(f.owner, { symbol: "ONE", sidebarWidth: width });
    const backup = await f.storage.createBackup(f.owner);
    assert.equal(backup.layout.sidebarWidth, width);
    await f.storage.importBackup("another-profile", json(backup));
    assert.equal((await f.storage.loadPreferences("another-profile")).sidebarWidth, width);
    assert.equal((await f.storage.createBackup("another-profile")).layout.sidebarWidth, width);
  }
  await f.client.close();
});

test("selected UID round-trips through profile storage and backup without replacing legacy layouts", async () => {
  const f = await fixture([]);
  for (const instrumentUid of ["uid-ONE", null]) {
    await f.storage.savePreferences(f.owner, { symbol: "ONE", instrumentUid });
    const backup = await f.storage.createBackup(f.owner);
    assert.equal(backup.layout.instrumentUid, instrumentUid);
    await f.storage.importBackup("another-profile", json(backup));
    assert.equal((await f.storage.loadPreferences("another-profile")).instrumentUid, instrumentUid);
  }
  await f.storage.savePreferences(f.owner, { symbol: "ONE" });
  const legacy = await f.storage.createBackup(f.owner);
  assert.equal(Object.hasOwn(legacy.layout, "instrumentUid"), false);
  await f.storage.importBackup("another-profile", json(legacy));
  assert.equal(
    Object.hasOwn(await f.storage.loadPreferences("another-profile"), "instrumentUid"),
    false
  );
  await f.client.close();
});

test("global pane ratio and collapsed legend round-trip through owner preferences and backup without another owner's state leaking", async () => {
  const f = await fixture([]);
  for (const ratio of [0.05, 0.37, 0.8]) {
    const layout = {
      symbol: "ONE",
      indicatorPaneLayout: { volume: { heightRatio: ratio } },
      chartSettings: { legendCollapsed: true },
      indicators: { volume: true, ma: true }
    };
    await f.storage.savePreferences(f.owner, layout);
    const backup = await f.storage.createBackup(f.owner);
    assert.deepEqual(json(backup.layout), layout);
    await f.storage.importBackup("another-profile", json(backup));
    assert.deepEqual(json(await f.storage.loadPreferences("another-profile")), layout);
    await f.storage.savePreferences("another-profile", {
      ...layout,
      symbol: "TWO",
      chartSettings: { legendCollapsed: false }
    });
    assert.equal((await f.storage.loadPreferences(f.owner)).chartSettings.legendCollapsed, true);
    assert.equal(
      (await f.storage.loadPreferences("another-profile")).indicatorPaneLayout.volume.heightRatio,
      ratio
    );
  }
  const backup = await f.storage.createBackup(f.owner);
  await f.storage.importBackup("another-profile", { ...json(backup), layout: { symbol: "ONE" } });
  const legacy = await f.storage.loadPreferences("another-profile");
  assert.equal(legacy.indicatorPaneLayout, undefined);
  assert.equal(legacy.chartSettings, undefined);
  await f.client.close();
});
test("invalid pane layouts and collapse flags are rejected before backup writes", async () => {
  const f = await fixture([]),
    backup = await f.storage.createBackup(f.owner);
  await f.storage.savePreferences("another-profile", {
    indicatorPaneLayout: { volume: { heightRatio: 0.3 } },
    chartSettings: { legendCollapsed: true }
  });
  for (const layout of [
    ...[0, 0.049, 0.801, -1, ".3", null, NaN, Infinity].map((heightRatio) => ({
      indicatorPaneLayout: { volume: { heightRatio } }
    })),
    ...["false", 0, null].map((legendCollapsed) => ({ chartSettings: { legendCollapsed } }))
  ]) {
    const writes = f.database.calls.filter((call) => call.operation === "transaction").length;
    await assert.rejects(f.storage.importBackup("another-profile", { ...backup, layout }));
    assert.equal(
      f.database.calls.filter((call) => call.operation === "transaction").length,
      writes
    );
    assert.equal(
      (await f.storage.loadPreferences("another-profile")).indicatorPaneLayout.volume.heightRatio,
      0.3
    );
  }
  await f.client.close();
});

test("invalid sidebar widths are rejected before import writes and older backups remain valid", async () => {
  const f = await fixture([]);
  const backup = await f.storage.createBackup(f.owner);
  await f.storage.savePreferences("another-profile", { sidebarWidth: 360 });
  for (const width of [239, 721, -1, "420", null, NaN, Infinity, -Infinity]) {
    const writes = f.database.calls.filter((call) => call.operation === "transaction").length;
    await assert.rejects(
      f.storage.importBackup("another-profile", {
        ...backup,
        layout: { sidebarWidth: width }
      })
    );
    assert.equal(
      f.database.calls.filter((call) => call.operation === "transaction").length,
      writes
    );
    assert.equal((await f.storage.loadPreferences("another-profile")).sidebarWidth, 360);
  }
  await f.storage.importBackup("another-profile", { ...backup, layout: { symbol: "ONE" } });
  assert.equal((await f.storage.loadPreferences("another-profile")).sidebarWidth, undefined);
  await f.client.close();
});

test("removing one duplicate UID row keeps the surviving UID price and candle subscriptions", async () => {
  const f = await fixture([row("ONE"), row("ALIAS", "uid-ONE"), row("TWO")]);
  f.client.subscribeCandles("uid-ONE", "1m");
  f.sent.length = 0;
  await f.client.removeInstrument(row("ONE"));
  assert.deepEqual(symbols(f.client.rows), ["ALIAS", "TWO"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["ALIAS", "TWO"]);
  assert.equal(subscriptionMessages(f.sent, "subscribeLastPriceRequest", unsubscribe).length, 0);
  assert.equal(subscriptionMessages(f.sent, "subscribeCandlesRequest", unsubscribe).length, 0);
  f.sent.length = 0;
  f.client.connect();
  assert.equal(
    subscriptionMessages(f.sent, "subscribeCandlesRequest", subscribe)[0].instruments[0]
      .instrumentId,
    "uid-ONE"
  );
  await f.client.close();
});

test("starting the same client after importing an empty list drops its old candle subscription", async () => {
  const f = await fixture();
  f.client.subscribeCandles("uid-ONE", "1m");
  const backup = await f.storage.createBackup(f.owner);
  await f.storage.importBackup(f.owner, { ...backup, watchlist: [] });
  f.sent.length = f.requests.length = 0;
  await f.client.start();
  assert.deepEqual(symbols(f.client.rows), []);
  assert.equal(subscriptionMessages(f.sent, "subscribeCandlesRequest", subscribe).length, 0);
  assert.equal(subscriptionMessages(f.sent, "subscribeLastPriceRequest", subscribe).length, 0);
  assert.deepEqual(f.requests, [
    {
      service: "MarketDataService",
      method: "GetLastPrices",
      body: { instrumentId: ["SBER_TQBR"] }
    }
  ]);
  await f.client.close();
});

test("a flush during pending removal cannot overwrite the committed market snapshot with deleted rows", async () => {
  const f = await fixture();
  const gate = f.database.holdNextSnapshot();
  const removing = f.client.removeInstrument(row("ONE"));
  await gate.entered.promise;
  const flushing = f.client.flush();
  await Promise.resolve();
  gate.release.resolve();
  await Promise.all([removing, flushing]);
  assert.deepEqual(symbols(f.client.rows), ["TWO"]);
  assert.deepEqual(symbols(await f.storage.loadWatchlist(f.owner)), ["TWO"]);
  assert.deepEqual(symbols((await f.storage.loadMarket(f.owner)).rows), ["TWO"]);
  await f.client.close();
});

test("offline session restoration accepts an explicitly cached empty watchlist", async () => {
  const notices = [];
  const owner = "unit-test-profile";
  let historyLoads = 0;
  let state = { owner: "guest", rows: [], candles: [], pricesDirection: new Map() };
  class OfflineBankClient extends EventTarget {
    async start() {
      throw new Error("simulated offline transport");
    }
    async close() {}
  }
  const { load } = sources(
    {
      "services/storage.ts": {
        migrateLegacy: async () => {},
        lastProfile: async () => undefined,
        restoreSession: async () => ({ owner, name: "Offline", token: "unit-test-only-not-real" }),
        loadMarket: async (requestedOwner) => {
          assert.equal(requestedOwner, owner);
          return { rows: [], at: Date.now() };
        },
        loadPreferences: async () => ({ symbol: "ONE" })
      },
      "services/tbank-client.ts": { TBankClient: OfflineBankClient }
    },
    { window: new EventTarget() }
  );
  const { TerminalSession } = load("screens/terminal/controller-session.ts");
  const session = new TerminalSession({
    getState: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    resetHistory: () => {},
    notify: (message) => notices.push(message),
    loadHistory: async () => {
      historyLoads++;
    },
    flush: async () => {},
    isClearingHistory: () => false
  });
  try {
    await session.start();
    assert.equal(state.ready, true);
    assert.equal(state.owner, owner);
    assert.equal(state.authenticated, true);
    assert.equal(state.status, "offline");
    assert.equal(state.error, null);
    assert.deepEqual(symbols(state.rows), []);
    assert.equal(session.client.authenticated, true);
    assert.equal(session.client.owner, owner);
    assert.equal(historyLoads, 1);
    assert.deepEqual(notices, []);
  } finally {
    session.dispose();
  }
});
