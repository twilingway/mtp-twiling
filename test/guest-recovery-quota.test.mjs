import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";
const target = "profile-v2:device",
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
const legacyRecords = (f) =>
  structuredClone(
    Object.fromEntries(
      Object.entries(f.database.stores).map(([name, records]) => [name, [...records]])
    )
  );
function assertLegacyRecords(f, before) {
  for (const [name, records] of Object.entries(before))
    for (const [id, value] of records)
      assert.deepEqual(f.database.stores[name].get(id), value, `${name}/${id}`);
}
async function sessionFixture() {
  const f = await createGuestFixture();
  await f.storage.savePreferences("guest", layout);
  f.database.stores.preferences.set("v2-profile-ready:public", {
    id: "v2-profile-ready:public",
    owner: "profile-v2:public",
    value: true
  });
  f.storage.restoreSession = async () => undefined;
  f.storage.saveSession = async () => {};
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

test("canonical migration quota preserves guest rows, drawings and preferences, blocks empty startup and permits a durable retry before bank activation", async () => {
  const f = await sessionFixture();
  const rows = [{ uid: "saved", symbol: "ONE", name: "Saved", price: null, previousClose: null }],
    drawings = [
      { id: "line", name: "horizontalStraightLine", points: [{ timestamp: 1, value: 10 }] }
    ];
  await f.storage.saveWatchlistSnapshot("guest", rows);
  await f.storage.saveDrawings("guest", "ONE", drawings);
  const before = legacyRecords(f);
  f.database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => {
    if (record?.owner === target) throw new DOMException("full", "QuotaExceededError");
  };
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
  try {
    await assert.rejects(f.session.start(), {
      name: "WorkspaceMigrationError",
      code: "storage-failed"
    });
    assert.equal(f.session.client, null);
    assert.equal(f.state().ready, false);
    assert.equal(f.state().workspaceMigrationIncomplete, true);
    assert.equal(f.state().watchlistStartup, "error");
    assert.equal(f.database.stores.preferences.has("device-workspace-migration:v1"), false);
    assert.equal(f.database.stores.preferences.has(`layout:${target}`), false);
    assertLegacyRecords(f, before);
    delete f.database.hooks.beforeWriteComplete;
    await f.session.start();
    assert.equal(f.state().owner, "device");
    assert.equal(f.state().ready, true);
    assert.equal(f.state().workspaceMigrationIncomplete, false);
    assert.equal(f.state().marketReady, true);
    assert.equal(f.state().authenticated, false);
    assert.deepEqual(
      f.state().rows.map((row) => row.uid),
      ["saved"]
    );
    assert.equal(f.state().preferences.engine, "kline");
    assert.equal(f.state().preferences.rangeDays, 180);
    assert.deepEqual(await f.storage.loadDrawings(target, "ONE"), drawings);
    assertLegacyRecords(f, before);
    await f.session.login(`t.${"x".repeat(40)}`, "Test", false);
    assert.equal(f.state().owner, "device");
    assert.equal(f.state().authenticated, true);
    assert.equal(f.state().preferences.engine, "kline");
    assert.equal(f.state().preferences.rangeDays, 180);
    assert.deepEqual(
      f.state().rows.map((row) => row.uid),
      ["saved"]
    );
    assert.deepEqual(await f.storage.loadDrawings(target, "ONE"), drawings);
    assertLegacyRecords(f, before);
    assert.deepEqual(f.notices, []);
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

test("corrupt guest blocks empty canonical startup with intact recovery data; corrected source can retry, and cancellation never commits staged migration", async () => {
  const f = await sessionFixture();
  f.database.stores.preferences.get("layout:guest").value = { rangeDays: -1 };
  const corrupt = legacyRecords(f);
  try {
    await assert.rejects(f.session.start(), {
      name: "WorkspaceMigrationError",
      code: "source-invalid"
    });
    assert.equal(f.session.client, null);
    assert.equal(f.state().ready, false);
    assert.equal(f.state().workspaceMigrationIncomplete, true);
    assert.equal(f.database.stores.preferences.has("device-workspace-migration:v1"), false);
    assertLegacyRecords(f, corrupt);
    // Explicit recovery repairs the source; startup itself must never overwrite it.
    await f.storage.savePreferences("guest", layout);
    await f.session.start();
    assert.equal(f.state().owner, "device");
    assert.equal(f.state().ready, true);
    assert.equal(f.state().workspaceMigrationIncomplete, false);
    assert.equal(f.state().preferences.rangeDays, 180);
    assert.deepEqual(f.notices, []);
  } finally {
    f.session.dispose();
  }
  const other = await sessionFixture(),
    entered = deferred(),
    release = deferred(),
    before = legacyRecords(other);
  other.database.hooks.beforeWriteComplete = async (_tx, _store, _kind, record) => {
    if (record?.id === "device-workspace-migration:v1") {
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
  assert.equal(other.database.stores.preferences.has("device-workspace-migration:v1"), false);
  assertLegacyRecords(other, before);
});

test("migration blocks portable mutations, cancellation aborts staged writes and history-stage import flags never emit a stale recovery warning", async () => {
  for (const phase of ["adoption", "history"]) {
    const f = await sessionFixture(),
      entered = deferred(),
      release = deferred();
    if (phase === "adoption")
      f.database.hooks.beforeWriteComplete = async (_tx, _store, _kind, record) => {
        if (record?.id === "device-workspace-migration:v1") {
          entered.resolve();
          await release.promise;
        }
      };
    else {
      f.bridge.loadHistory = async () => {
        entered.resolve();
        await release.promise;
      };
    }
    const starting = f.session.start();
    await entered.promise;
    if (phase === "adoption") {
      const { importWritable } = f.load("screens/terminal/controller-transfer-guard.ts");
      assert.equal(f.state().profileTransition, true);
      assert.equal(importWritable(f.state()), false);
      f.session.dispose();
    } else {
      f.bridge.update({ importingBackup: true });
      f.bridge.update({ importingBackup: false });
    }
    release.resolve();
    if (phase === "adoption") await assert.rejects(starting, { name: "AbortError" });
    else {
      await starting;
      assert.equal(f.state().owner, "device");
      assert.equal(f.session.client.closed, false);
    }
    assert.equal(f.notices.length, 0, phase);
    assert.equal(f.database.stores.preferences.has("guest-public-adoption:v1"), false);
    f.session.dispose();
  }
});

test("canonical owner/revision commit and ordinary instrument choice during history await keep the valid client installed", async () => {
  const own = await sessionFixture();
  own.bridge.resetHistory = () =>
    own.bridge.update({ chartRevision: (own.state().chartRevision ?? 0) + 1 });
  try {
    await own.session.start();
    assert.equal(own.state().owner, "device");
    assert.equal(own.state().preferences.engine, "kline");
    assert.ok(own.state().chartRevision > 0);
    assert.equal(own.session.client.closed, false);
  } finally {
    own.session.dispose();
  }
  const f = await sessionFixture(),
    entered = deferred(),
    release = deferred();
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
