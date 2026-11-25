import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";
const target = "profile-v2:public",
  layout = {
    engine: "kline",
    rangeDays: 180,
    chartSettings: { theme: "light", grid: false, scaleFontSize: 13 }
  };
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function sessionFixture(wrapper = true) {
  const f = await createGuestFixture();
  await f.storage.savePreferences("guest", layout);
  f.database.stores.preferences.set("v2-profile-ready:public", {
    id: "v2-profile-ready:public",
    owner: target,
    value: true
  });
  f.storage.restoreSession = async () => undefined;
  f.storage.migrateLegacy = async () => {};
  f.storage.saveSession = async () => {};
  if (!wrapper)
    f.load("services/storage-guest-cache.ts").publicGuestRecoveryCache = (cache) => cache;
  const { TerminalSession } = f.load("screens/terminal/controller-session.ts"),
    { defaultPreferences } = f.load("screens/terminal/controller-bridge.ts"),
    notices = [],
    listeners = new Set();
  let state = {
      owner: "guest",
      preferences: defaultPreferences(),
      rows: [],
      candles: [],
      pricesDirection: new Map()
    },
    session;
  const bridge = {
    getState: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    resetHistory: () => {},
    notify: (message) => notices.push(message),
    loadHistory: async () => {},
    flush: async () => {
      await session.client?.flush();
      await f.storageDB.flush();
    },
    isClearingHistory: () => false,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  session = new TerminalSession(bridge);
  return { ...f, session, notices, bridge, state: () => state };
}

test("regression: caught guest quota blocks ordinary empty public bootstrap; the narrow wrapper keeps it usable and permits later bank activation when bank persistence works", async () => {
  const unwrapped = await sessionFixture(false);
  unwrapped.database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => {
    if (record?.owner === target) throw new DOMException("full", "QuotaExceededError");
  };
  await assert.rejects(unwrapped.session.start(), { name: "QuotaExceededError" });
  unwrapped.session.dispose();
  const f = await sessionFixture();
  f.database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => {
    if (record?.owner === target) throw new DOMException("full", "QuotaExceededError");
  };
  await f.session.start();
  assert.equal(f.state().owner, "public");
  assert.equal(f.state().marketReady, true);
  assert.equal(f.state().authenticated, false);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /не сохранён/);
  assert.equal(f.database.stores.preferences.has("guest-public-adoption:v1"), false);
  assert.equal(f.database.stores.preferences.has(`layout:${target}`), false);
  assert.deepEqual(f.database.stores.preferences.get("layout:guest").value, layout);
  await f.session.client.flush();
  const backup = await f
    .load("services/storage-guest-recovery.ts")
    .createLegacyGuestBackup({ includeHistory: false });
  assert.deepEqual(backup.layout, layout);
  class Bank extends EventTarget {
    rows = [];
    authenticated = true;
    snapshot() {
      return { rows: this.rows, status: "connected" };
    }
    async start() {
      return this.snapshot();
    }
    async flush() {}
    async close() {}
  }
  f.load("services/tbank-client.ts").TBankClient = Bank;
  f.load("services/profile-key.ts").profileKey = async () => "bank-A";
  try {
    await f.session.login(`t.${"x".repeat(40)}`, "Test", false);
    assert.equal(f.state().owner, "bank-A");
    assert.equal(f.state().authenticated, true);
    assert.equal(f.state().preferences.engine, "tradingview");
    assert.equal(f.state().preferences.rangeDays, 365);
  } finally {
    f.session.dispose();
  }
});

test("quota wrapper never hides ordinary public, bank, nonempty user data or non-quota failures", async () => {
  const f = await createGuestFixture(),
    { publicGuestRecoveryCache } = f.load("services/storage-guest-cache.ts");
  let failure = new DOMException("full", "QuotaExceededError"),
    caught = false;
  const port = publicGuestRecoveryCache(
    {
      saveWatchlistSnapshot: async () => {
        throw failure;
      },
      saveMarket: async () => {
        throw failure;
      }
    },
    () => caught
  );
  await assert.rejects(port.saveWatchlistSnapshot("public", []), { name: "QuotaExceededError" });
  caught = true;
  await port.saveWatchlistSnapshot("public", []);
  await port.saveMarket("public", { rows: [], at: 1 });
  for (const owner of ["bank-A", "public"]) {
    await assert.rejects(port.saveWatchlistSnapshot(owner, [{}]));
    await assert.rejects(port.saveMarket(owner, { rows: [{}], at: 1 }));
  }
  await assert.rejects(port.saveWatchlistSnapshot("bank-A", []));
  failure = new Error("other storage failure");
  await assert.rejects(port.saveWatchlistSnapshot("public", []), /other storage failure/);
  await assert.rejects(port.saveMarket("public", { rows: [], at: 1 }), /other storage failure/);
});

test("quota classifier accepts DOMException independently of Error inheritance", () => {
  const source = readFileSync(
      new URL("../src/services/storage-guest-cache.ts", import.meta.url),
      "utf8"
    ),
    compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    context = vm.createContext({ DOMException, Error: class RealmError {}, exports: {} });
  vm.runInContext(compiled, context);
  const quota = new DOMException("full", "QuotaExceededError");
  assert.equal(vm.runInContext("Error", context)[Symbol.hasInstance](quota), false);
  assert.equal(context.exports.isGuestQuotaError(quota), true);
  assert.equal(context.exports.isGuestQuotaError(new DOMException("abort", "AbortError")), false);
});

test("corrupt guest does not block public startup; abort during adoption neither continues activation nor emits a late recovery warning", async () => {
  const f = await sessionFixture();
  f.database.stores.preferences.get("layout:guest").value = { rangeDays: -1 };
  try {
    await f.session.start();
    assert.equal(f.state().owner, "public");
    assert.equal(f.notices.length, 1);
  } finally {
    f.session.dispose();
  }
  const other = await sessionFixture(),
    entered = deferred(),
    release = deferred();
  other.database.hooks.beforeWriteComplete = async (tx) => {
    if (tx.names.length === 5) {
      entered.resolve();
      await release.promise;
    }
  };
  const starting = other.session.start();
  await entered.promise;
  other.session.dispose();
  release.resolve();
  await assert.rejects(starting, { name: "AbortError" });
  assert.equal(other.notices.length, 0);
  assert.equal(other.state().owner, "guest");
  assert.equal(other.database.stores.preferences.has("guest-public-adoption:v1"), false);
  assert.equal(other.database.stores.preferences.has(`layout:${target}`), false);
  assert.equal(other.database.stores.preferences.has(`market:${target}`), false);
});

test("public activation observes import bounces during adoption or history await and emits no stale recovery warning", async () => {
  for (const phase of ["adoption", "history"]) {
    const f = await sessionFixture(),
      entered = deferred(),
      release = deferred();
    if (phase === "adoption")
      f.database.hooks.beforeWriteComplete = async (tx) => {
        if (tx.names.length === 5) {
          entered.resolve();
          await release.promise;
        }
      };
    else {
      f.database.stores.preferences.get("layout:guest").value = { rangeDays: -1 };
      f.bridge.loadHistory = async () => {
        entered.resolve();
        await release.promise;
      };
    }
    const starting = f.session.start();
    await entered.promise;
    f.bridge.update({ importingBackup: true });
    f.bridge.update({ importingBackup: false });
    release.resolve();
    if (phase === "adoption") await assert.rejects(starting, { name: "AbortError" });
    else {
      await starting;
      assert.equal(f.state().owner, "public");
      assert.equal(f.session.client.closed, false);
    }
    assert.equal(f.notices.length, 0, phase);
    assert.equal(f.database.stores.preferences.has("guest-public-adoption:v1"), false);
    f.session.dispose();
  }
});

test("own owner/revision commit and ordinary instrument choice during public history await keep the valid client installed", async () => {
  const own = await sessionFixture();
  own.bridge.resetHistory = () =>
    own.bridge.update({ chartRevision: (own.state().chartRevision ?? 0) + 1 });
  try {
    await own.session.start();
    assert.equal(own.state().owner, "public");
    assert.equal(own.state().preferences.engine, "kline");
    assert.ok(own.state().chartRevision > 0);
    assert.equal(own.session.client.closed, false);
  } finally {
    own.session.dispose();
  }
  const f = await sessionFixture(),
    entered = deferred(),
    release = deferred();
  f.database.stores.preferences.get("layout:guest").value = { rangeDays: -1 };
  f.bridge.loadHistory = async () => {
    entered.resolve();
    await release.promise;
  };
  const starting = f.session.start();
  await entered.promise;
  const client = f.session.client,
    preferences = { ...f.state().preferences, symbol: "CHOSEN", instrumentUid: "chosen" };
  f.bridge.update({ preferences, chartRevision: (f.state().chartRevision ?? 0) + 1 });
  release.resolve();
  try {
    await starting;
    assert.equal(f.session.client, client);
    assert.equal(client.closed, false);
    assert.equal(f.state().preferences, preferences);
    assert.equal(f.notices.length, 0);
  } finally {
    f.session.dispose();
  }
});
