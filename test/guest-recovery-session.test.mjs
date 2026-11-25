import test from "node:test";
import assert from "node:assert/strict";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const oldLayout = {
  engine: "kline",
  rangeDays: 180,
  chartSettings: { theme: "light", grid: false, scaleFontSize: 13 }
};

test("actual TerminalSession public bootstrap adopts legacy settings before client snapshot and reads no vault/bank values", async () => {
  const f = await createGuestFixture();
  await f.storage.savePreferences("guest", oldLayout);
  f.storage.restoreSession = async () => undefined;
  f.storage.migrateLegacy = async () => {};
  f.database.stores.preferences.set("session", {
    id: "session",
    owner: "bank-A",
    value: "sentinel"
  });
  f.database.stores.preferences.set("layout:bank-A", {
    id: "layout:bank-A",
    owner: "bank-A",
    value: { symbol: "PRIVATE" }
  });
  f.database.reads.length = 0;
  const { TerminalSession } = f.load("screens/terminal/controller-session.ts"),
    { defaultPreferences } = f.load("screens/terminal/controller-bridge.ts");
  let state = {
    owner: "guest",
    preferences: defaultPreferences(),
    rows: [],
    candles: [],
    pricesDirection: new Map()
  };
  const session = new TerminalSession({
    getState: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    resetHistory: () => {},
    notify: () => {},
    loadHistory: async () => {},
    flush: async () => {},
    isClearingHistory: () => false
  });
  try {
    await session.start();
    assert.equal(state.owner, "public");
    assert.equal(state.preferences.engine, "kline");
    assert.equal(state.preferences.rangeDays, 180);
    assert.equal(state.preferences.chartSettings.grid, false);
    assert.equal(state.preferences.chartSettings.theme, "light");
    assert.equal(state.preferences.chartSettings.scaleFontSize, 13);
    assert.equal(state.authenticated, false);
    assert.ok(f.database.transactions.every((tx) => !tx.names.includes("vault")));
    assert.ok(f.database.reads.every((read) => read.key !== "session" && read.owner !== "bank-A"));
  } finally {
    session.dispose();
  }
});

test("download guard survives owner/import/profile/session bounces and never invokes stale download after async DB reads", async () => {
  for (const boundary of [
    "none",
    "owner",
    "import",
    "profile",
    "session",
    "authenticated",
    "revision"
  ]) {
    const f = await createGuestFixture();
    await f.storage.savePreferences("guest", oldLayout);
    const { downloadLegacyGuestWorkspace } = f.load("screens/terminal/legacy-guest-recovery.ts"),
      entered = deferred(),
      release = deferred(),
      listeners = new Set();
    let identity = {},
      state = {
        owner: "public",
        authenticated: false,
        chartRevision: 0,
        preferences: {},
        rows: []
      };
    const controller = {
      getSnapshot: () => state,
      sessionKey: () => identity,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
    const update = (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    };
    f.database.hooks.beforeReadComplete = async () => {
      entered.resolve();
      await release.promise;
    };
    const downloads = [];
    const exporting = downloadLegacyGuestWorkspace(controller, false, (backup) =>
      downloads.push(backup)
    );
    await entered.promise;
    if (boundary === "owner") {
      update({ owner: "bank-A" });
      update({ owner: "public" });
    }
    if (boundary === "import") {
      update({ importingBackup: true });
      update({ importingBackup: false });
    }
    if (boundary === "profile") {
      update({ profileTransition: true });
      update({ profileTransition: false });
    }
    if (boundary === "authenticated") {
      update({ authenticated: true });
      update({ authenticated: false });
    }
    if (boundary === "revision") {
      update({ chartRevision: 1 });
      update({ chartRevision: 0 });
    }
    if (boundary === "session") {
      const previous = identity;
      identity = {};
      update({});
      identity = previous;
      update({});
    }
    release.resolve();
    if (boundary === "none") {
      await exporting;
      assert.equal(downloads.length, 1);
      assert.deepEqual(downloads[0].layout, oldLayout);
    } else {
      await assert.rejects(exporting, { name: "AbortError" });
      assert.equal(downloads.length, 0, boundary);
    }
    assert.equal(listeners.size, 0);
    assert.equal(f.database.stores.preferences.has("v2-profile-ready:guest"), false);
    assert.ok(
      f.database.transactions.every((tx) => tx.mode === "readonly" || tx.names.length === 1)
    );
  }
});

test("legacy raw-public v1 migration remains compatible while the recovery source stays raw guest", async () => {
  const f = await createGuestFixture(),
    v2 = f.load("services/storage-v2.ts");
  await f.storage.savePreferences("public", { engine: "tradingview", rangeDays: 90 });
  await f.storage.savePreferences("guest", oldLayout);
  await v2.prepareProfileV2("public");
  assert.equal((await v2.loadPreferences("public")).rangeDays, 90);
  assert.equal(await v2.adoptLegacyGuestWorkspace(() => true), "target-occupied");
  assert.deepEqual((await v2.createLegacyGuestBackup()).layout, oldLayout);
});

test("download is revalidated after the final asynchronous image Blob read", async () => {
  const f = await createGuestFixture();
  await f.storage.savePreferences("guest", oldLayout);
  await f.storage.saveImage({
    id: "image",
    owner: "guest",
    symbol: "SBER",
    name: "",
    blob: new Blob(["x"], { type: "image/png" }),
    point: { timestamp: 1, value: 1 },
    width: 10
  });
  const { downloadLegacyGuestWorkspace } = f.load("screens/terminal/legacy-guest-recovery.ts"),
    entered = deferred(),
    release = deferred(),
    original = Blob.prototype.arrayBuffer,
    listeners = new Set();
  let state = { owner: "public", authenticated: false, chartRevision: 0 },
    downloads = 0;
  const identity = {},
    controller = {
      getSnapshot: () => state,
      sessionKey: () => identity,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
  Blob.prototype.arrayBuffer = async function () {
    entered.resolve();
    await release.promise;
    return original.call(this);
  };
  try {
    const exporting = downloadLegacyGuestWorkspace(controller, false, () => {
      downloads++;
    });
    await entered.promise;
    state = { ...state, importingBackup: true };
    for (const listener of listeners) listener();
    state = { ...state, importingBackup: false };
    for (const listener of listeners) listener();
    release.resolve();
    await assert.rejects(exporting, { name: "AbortError" });
    assert.equal(downloads, 0);
  } finally {
    release.resolve();
    Blob.prototype.arrayBuffer = original;
  }
});
