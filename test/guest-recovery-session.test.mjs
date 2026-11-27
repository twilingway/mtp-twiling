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

test("actual TerminalSession canonical bootstrap recovers legacy settings before client snapshot without reading the vault", async () => {
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
    assert.equal(state.owner, "device");
    assert.equal(state.preferences.engine, "kline");
    assert.equal(state.preferences.rangeDays, 180);
    assert.equal(state.preferences.chartSettings.grid, false);
    assert.equal(state.preferences.chartSettings.theme, "light");
    assert.equal(state.preferences.chartSettings.scaleFontSize, 13);
    assert.equal(state.authenticated, false);
    assert.ok(f.database.transactions.every((tx) => !tx.names.includes("vault")));
    assert.ok(f.database.reads.every((read) => read.key !== "session"));
    assert.deepEqual(f.database.stores.preferences.get("layout:guest").value, oldLayout);
  } finally {
    session.dispose();
  }
});

test("the canonical controller opens legacy v2 layout without changing its source or empty selection", async () => {
  const f = await createGuestFixture();
  const storage = f.load("services/storage-v2.ts");
  const { TerminalController } = f.load("screens/terminal/controller.ts");
  await storage.prepareProfileV2("public");
  const id = "layout:profile-v2:public";
  const value = { ...oldLayout, symbol: "", instrumentUid: null };
  f.database.stores.preferences.set(id, { id, owner: "profile-v2:public", value });

  const controller = new TerminalController();
  try {
    await controller.start();
    const state = controller.getSnapshot();
    assert.equal(state.marketReady, true);
    assert.equal(state.owner, "device");
    assert.equal(state.preferences.symbol, "");
    assert.equal(state.preferences.chartSettings.theme, "light");
    assert.equal(state.preferences.engine, "kline");
    assert.deepEqual(await storage.loadPreferences("device"), {
      ...oldLayout,
      instrumentUid: null
    });
    assert.deepEqual(f.database.stores.preferences.get(id).value, value);
  } finally {
    controller.dispose();
  }
});

test("guest settings with no selection survive reload and export as a valid portable backup", async () => {
  const f = await createGuestFixture();
  const { TerminalController } = f.load("screens/terminal/controller.ts");
  const { validateBackup } = f.load("model/backup-format.ts");
  const { sanitizeDriveBackup } = f.load("services/drive/backup.ts");
  const first = new TerminalController();
  try {
    await first.start();
    assert.equal(first.getSnapshot().preferences.symbol, "");
    await first.setChartSettings({ theme: "light" });
    await first.setPreferences({ locale: "en", engine: "kline" });
    await first.toggleIndicator("ma");

    const layout = f.database.stores.preferences.get("layout:profile-v2:device").value;
    assert.equal(Object.hasOwn(layout, "symbol"), false);
    assert.equal(layout.instrumentUid, null);
    const backup = validateBackup(await first.exportBackup(false));
    assert.equal(Object.hasOwn(backup.layout, "symbol"), false);
    assert.equal(backup.layout.locale, "en");
    assert.equal(backup.layout.engine, "kline");
    assert.equal(sanitizeDriveBackup(backup).layout.chartSettings.theme, "light");
  } finally {
    first.dispose();
  }

  const reloaded = new TerminalController();
  try {
    await reloaded.start();
    const state = reloaded.getSnapshot();
    assert.equal(state.marketReady, true);
    assert.equal(state.preferences.symbol, "");
    assert.equal(state.preferences.locale, "en");
    assert.equal(state.preferences.engine, "kline");
    assert.equal(state.preferences.chartSettings.theme, "light");
    assert.equal(state.preferences.indicators.ma, true);
  } finally {
    reloaded.dispose();
  }
});

test("raw public migration normalizes only the local empty selection and preserves the source", async () => {
  const f = await createGuestFixture();
  const storage = f.load("services/storage-v2.ts");
  const value = { ...oldLayout, symbol: "" };
  f.database.stores.preferences.set("layout:public", {
    id: "layout:public",
    owner: "public",
    value
  });
  await storage.prepareProfileV2("public");
  assert.deepEqual(await storage.loadPreferences("public"), oldLayout);
  assert.deepEqual(f.database.stores.preferences.get("layout:public").value, value);
});

test("local empty selection normalization preserves strict preferences, file and Drive validation", async () => {
  const f = await createGuestFixture();
  const storage = f.load("services/storage-v2.ts");
  const { validateBackup } = f.load("model/backup-format.ts");
  const { sanitizeDriveBackup } = f.load("services/drive/backup.ts");
  const id = "layout:profile-v2:public";
  await storage.prepareProfileV2("public");

  for (const value of [
    { symbol: "", instrumentUid: "uid" },
    {
      symbol: "",
      instrumentUid: null,
      providerRef: { provider: "bybit", category: "spot", symbol: "BTCUSDT" }
    },
    { symbol: "", instrumentUid: null, locale: "invalid" },
    { symbol: " ", instrumentUid: null }
  ]) {
    await storage.savePreferences("public", value);
    const record = f.database.stores.preferences.get(id);
    await assert.rejects(storage.loadPreferences("public"), /Некорректная структура/);
    assert.equal(record, f.database.stores.preferences.get(id));
  }

  const external = {
    application: "personal-terminal",
    schemaVersion: 2,
    layout: { symbol: "", instrumentUid: null },
    drawings: [],
    images: []
  };
  assert.throws(() => validateBackup(external), /Некорректная структура/);
  assert.throws(() => sanitizeDriveBackup(external));
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
