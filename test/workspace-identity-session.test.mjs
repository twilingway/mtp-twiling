import test from "node:test";
import assert from "node:assert/strict";
import { flowModules, deferred, tick } from "./helpers/workspace-identity-flow.mjs";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const token = "t." + "a".repeat(45);
function fixture(restored = null) {
  const events = [],
    clients = [],
    preparations = [],
    saved = [];
  const binding = {
    owner: "device",
    primaryOwner: "public",
    cloudOwner: "legacy-google",
    legacyOwners: ["public"],
    conflicts: []
  };
  const rows = [{ uid: "bank-uid", symbol: "SBER", ticker: "SBER", name: "Bank row" }];
  const preferences = {
    engine: "kline",
    rangeDays: 180,
    symbol: "SBER",
    instrumentUid: "bank-uid",
    chartSettings: { grid: false, theme: "light" },
    indicators: { ma: true }
  };
  const hooks = {};
  class MarketClient extends EventTarget {
    constructor(value, name, _cache, options) {
      super();
      this.token = value;
      this.name = name;
      this.owner = options.owner;
      this.rows = rows;
      this.cachePaused = false;
      this.closed = false;
      clients.push(this);
    }
    async start() {
      await hooks.start?.(this);
      if (this.token?.includes("b")) throw new Error("Invalid key");
      return this.snapshot();
    }
    snapshot() {
      return {
        rows: this.rows,
        marketReady: true,
        authenticated: !!this.token,
        status: "offline",
        error: null
      };
    }
    async settleMutations() {
      events.push("mutations");
    }
    async close() {
      this.closed = true;
      events.push("close");
    }
  }
  const storage = {
    restoreSession: async () => restored,
    prepareProfileV2: async () => {},
    migrateLegacy: async () => {},
    loadPreferences: async () => preferences,
    copyPublicProfile: async () => {
      throw new Error("Legacy copy must not run");
    },
    saveSession: async (value) => saved.push(value),
    clearSession: async () => events.push("clear-bank")
  };
  const load = flowModules({
    "services/storage-v2.ts": storage,
    "services/market-client.ts": { MarketClient },
    "services/workspace-identity.ts": {
      DEVICE_OWNER: "device",
      prepareDeviceWorkspace: async (options) => {
        events.push("migration");
        preparations.push(options.preferredOwner);
        await hooks.prepare?.(options);
        if (!options.valid()) throw new DOMException("Aborted", "AbortError");
        return binding;
      }
    }
  });
  const { TerminalSession } = load("screens/terminal/controller-session.ts");
  const { defaultPreferences } = load("screens/terminal/controller-bridge.ts");
  let state = {
    owner: "guest",
    preferences: defaultPreferences(),
    rows: [],
    candles: [],
    drawings: [{ id: "drawing" }],
    images: [],
    pricesDirection: new Map(),
    watchlistStartup: "loading"
  };
  const session = new TerminalSession({
    getState: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    resetHistory: () => {},
    notify: (message) => events.push(message),
    loadHistory: async () => {},
    flush: async () => events.push("flush"),
    isClearingHistory: () => false
  });
  return {
    session,
    hooks,
    clients,
    events,
    preparations,
    saved,
    binding,
    rows,
    storage,
    state: () => state
  };
}

test("cold start selects restored legacy owner before bootstrap and keeps the same canonical/cloud identity through API changes", async () => {
  const f = fixture({ token, owner: "old-token-owner", name: "Account" });
  try {
    const cloudSession = f.session.cloudSession;
    await f.session.start();
    assert.deepEqual(f.preparations, ["old-token-owner", "device"]);
    assert.equal(f.state().owner, "device");
    assert.equal(f.state().preferences.engine, "kline");
    assert.equal(f.state().preferences.chartSettings.grid, false);
    assert.ok(f.events.indexOf("flush") < f.events.indexOf("migration"));
    const before = structuredClone({
      preferences: f.state().preferences,
      drawings: f.state().drawings,
      rows: f.state().rows
    });
    await f.session.logout();
    assert.equal(f.state().authenticated, false);
    assert.deepEqual(
      { preferences: f.state().preferences, drawings: f.state().drawings, rows: f.state().rows },
      before
    );
    assert.equal(f.session.cloudSession, cloudSession);
    assert.equal(f.session.workspaceBinding.cloudOwner, "legacy-google");
    await f.session.login(token, "Again", true);
    assert.equal(f.saved.at(-1).owner, "device");
    assert.equal(f.session.cloudSession, cloudSession);
    assert.deepEqual(f.state().preferences, before.preferences);
  } finally {
    f.session.dispose();
  }
});

test("API validation failure retains the live canonical client, rows and settings", async () => {
  const f = fixture();
  try {
    await f.session.start();
    const client = f.session.client,
      before = f.state().preferences;
    await assert.rejects(f.session.login("t." + "b".repeat(45), "Bad", false), /Invalid key/);
    assert.equal(f.session.client, client);
    assert.equal(client.closed, false);
    assert.equal(client.cachePaused, false);
    assert.equal(f.state().profileTransition, false);
    assert.equal(f.state().owner, "device");
    assert.equal(f.state().preferences, before);
    assert.equal(f.state().rows[0].uid, "bank-uid");
  } finally {
    f.session.dispose();
  }
});

test("candidate preparation keeps the old client alive and fences late callbacks under the transition", async () => {
  const f = fixture(),
    gate = deferred();
  try {
    await f.session.start();
    const old = f.session.client;
    f.hooks.start = async (candidate) => {
      if (candidate.token) await gate.promise;
    };
    const login = f.session.login(token, "Bank", false);
    while (f.clients.length < 2) await tick();
    assert.equal(old.closed, false);
    assert.equal(f.session.matches(old), false);
    old.dispatchEvent(new CustomEvent("state", { detail: { ...old.snapshot(), rows: [] } }));
    assert.equal(f.state().rows.length, 1);
    gate.resolve();
    await login;
    assert.equal(old.closed, true);
    assert.equal(f.session.matches(old), false);
  } finally {
    gate.resolve();
    f.session.dispose();
  }
});

test("bank logout preserves Google ciphertext and device encryption material", async () => {
  const f = await createGuestFixture();
  const { driveCredentialId } = f.load("services/drive/auth-credential-id.ts");
  const vault = f.database.stores.vault;
  vault.set("remembered", { id: "remembered", data: "encrypted-bank" });
  const google = {
    id: driveCredentialId("legacy-google"),
    data: "encrypted-google",
    credentialId: "generation"
  };
  vault.set(google.id, google);
  vault.set("device-key", { id: "device-key", key: "sentinel" });
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { removeItem() {} };
  try {
    await f.storage.clearSession("legacy-google");
    assert.equal(vault.has("remembered"), true); // fixture commits a replacement store
    assert.equal(f.database.stores.vault.has("remembered"), false);
    assert.deepEqual(f.database.stores.vault.get(google.id), google);
    assert.equal(f.database.stores.vault.has("device-key"), true);
  } finally {
    if (previous === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous;
  }
});

test("actual mixed MarketClient and nested TBankClient bind rows/history/coverage to device instead of token hashes", async () => {
  const calls = [],
    hashReads = [];
  class PublicMarket {
    sync() {}
    async snapshot() {}
    async flush() {}
    async close() {}
  }
  class BankTransport {
    closed = false;
    serverNow() {
      return 1_800_000_000_000;
    }
    async request() {
      return {};
    }
    connect() {}
    send() {}
    close() {
      this.closed = true;
    }
  }
  const load = flowModules({
    "services/market-public.ts": { PublicMarket },
    "services/tbank-transport.ts": { BankTransport, BankError: Error },
    "services/tbank-catalog.ts": {
      loadBankCatalog: async () => ({ shares: [], futures: [], indicatives: [] })
    },
    "services/profile-key.ts": {
      profileKey: async (value) => {
        hashReads.push(value);
        return "token-hash";
      }
    }
  });
  const cache = {
    loadWatchlist: async (owner) => {
      calls.push(["rows", owner]);
      return [];
    },
    loadMarket: async (owner) => {
      calls.push(["market", owner]);
      return undefined;
    },
    saveWatchlistSnapshot: async (owner) => calls.push(["save-rows", owner]),
    saveMarket: async (owner) => calls.push(["save-market", owner]),
    loadHistory: async (owner) => {
      calls.push(["history", owner]);
      return [];
    },
    saveHistory: async (owner) => calls.push(["save-history", owner]),
    loadCoverage: async (owner) => {
      calls.push(["coverage", owner]);
      return [];
    }
  };
  const { MarketClient } = load("services/market-client.ts");
  const { bankCacheView } = load("services/market-bank-cache.ts");
  const client = new MarketClient(token, "Bank", cache, { owner: "device" });
  try {
    await client.start();
    assert.equal(client.owner, "device");
    assert.equal(client.bankClient.owner, "device");
    assert.deepEqual(hashReads, []);
    const legacyBankView = bankCacheView(cache, () => client.owner);
    await legacyBankView.loadHistory("legacy-hash", "uid", "1d", 0, 1);
    await legacyBankView.saveHistory("legacy-hash", "uid", "1d", []);
    await legacyBankView.loadCoverage("legacy-hash", "uid", "1d");
    assert.ok(calls.length >= 7);
    assert.ok(calls.every(([, owner]) => owner === "device"));
    assert.deepEqual(client.rows, []);
  } finally {
    await client.close();
  }
});

test("cold migration failure exposes recovery without an empty ready workspace and can retry", async () => {
  const f = fixture();
  const { importWritable } = flowModules()("screens/terminal/controller-transfer-guard.ts");
  try {
    f.hooks.prepare = async () => {
      throw Object.assign(new Error("Source validation failed"), {
        code: "source-invalid",
        fallbackOwner: "public"
      });
    };
    await assert.rejects(f.session.start(), /Source validation failed/);
    assert.equal(f.session.client, null);
    assert.equal(f.session.workspaceBinding, undefined);
    assert.equal(f.state().workspaceMigrationIncomplete, true);
    assert.equal(f.state().ready, false);
    assert.equal(f.state().watchlistStartup, "error");
    assert.equal(f.state().profileTransition, false);
    assert.equal(importWritable(f.state()), false);
    assert.equal(f.clients.length, 0);
    delete f.hooks.prepare;
    await f.session.start();
    assert.equal(f.state().owner, "device");
    assert.equal(f.state().workspaceMigrationIncomplete, false);
    assert.equal(f.state().ready, true);
    assert.equal(importWritable(f.state()), true);
  } finally {
    f.session.dispose();
  }
});

test("migration failure during API transition preserves the previously visible client and binding", async () => {
  const f = fixture();
  try {
    await f.session.start();
    const client = f.session.client,
      binding = f.session.workspaceBinding,
      preferences = f.state().preferences;
    f.hooks.prepare = async () => {
      throw new Error("Storage unavailable");
    };
    await assert.rejects(f.session.login(token, "Bank", false), /Storage unavailable/);
    assert.equal(f.session.client, client);
    assert.equal(client.closed, false);
    assert.equal(client.cachePaused, false);
    assert.equal(f.session.workspaceBinding, binding);
    assert.equal(f.state().preferences, preferences);
    assert.equal(f.state().profileTransition, false);
    assert.equal(f.state().workspaceMigrationIncomplete, false);
  } finally {
    f.session.dispose();
  }
});

test("auxiliary bank panel keeps drawings, panes and cached candles during API logout and still clears a removed instrument", async () => {
  const drawings = [{ id: "saved-drawing" }],
    images = [],
    candles = [{ timestamp: 1_800_000_000_000, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
  const load = flowModules({
    "services/workspace-identity.ts": { DEVICE_OWNER: "device" },
    "services/storage-v2.ts": {},
    "services/storage-db.ts": { get: async () => undefined, put: async () => {} },
    "screens/terminal/workspace-annotations.ts": {
      readWorkspaceAnnotations: async () => ({ drawings, images }),
      subscribeWorkspaceAnnotations: () => () => {}
    }
  });
  const { TerminalController } = load("screens/terminal/controller.ts");
  const { WorkspacePanelController } = load("screens/terminal/workspace-panel-controller.ts");
  const parent = new TerminalController(),
    panel = new WorkspacePanelController(parent, 1, () => {});
  const market = () =>
    Object.assign(new EventTarget(), {
      closed: false,
      serverNow: () => 1_800_000_000_000,
      watchCandles: () => () => {},
      loadCandles: async () => ({ candles, cached: true, requests: 0 })
    });
  let client = market();
  parent.sessionKey = () => client;
  const row = { uid: "bank-uid", symbol: "SBER", ticker: "SBER", name: "Bank row" };
  parent.update({
    owner: "device",
    rows: [row],
    ready: true,
    marketReady: true,
    authenticated: true,
    preferences: {
      ...parent.getSnapshot().preferences,
      symbol: row.symbol,
      instrumentUid: row.uid,
      rangeDays: 4,
      technicalPaneLayout: [{ paneId: "oscillator", heightRatio: 0.4, collapsed: false }]
    }
  });
  const previousLocalStorage = globalThis.localStorage,
    localValues = new Map();
  globalThis.localStorage = {
    getItem: (key) => localValues.get(key) ?? null,
    setItem: (key, value) => localValues.set(key, value)
  };
  const { savePanelPreferences } = load("screens/terminal/workspace-panel-preferences.ts");
  savePanelPreferences("device", 1, parent.getSnapshot().preferences);
  try {
    panel.configure(row, parent.getSnapshot());
    for (let i = 0; i < 5; i++) await tick();
    const before = panel.getSnapshot();
    assert.equal(before.drawings.length, 1);
    assert.equal(before.candles.length, 1);
    assert.deepEqual(before.preferences.technicalPaneLayout, [
      { paneId: "oscillator", heightRatio: 0.4, collapsed: false }
    ]);
    parent.update({ profileTransition: true });
    panel.configure(row, parent.getSnapshot());
    assert.equal(panel.getSnapshot().drawings, before.drawings);
    assert.equal(panel.getSnapshot().candles, before.candles);
    client = market();
    parent.update({ authenticated: false });
    panel.configure(row, parent.getSnapshot());
    parent.update({ profileTransition: false });
    panel.configure(row, parent.getSnapshot());
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(panel.getSnapshot().drawings[0].id, "saved-drawing");
    assert.equal(panel.getSnapshot().candles.length, 1);
    assert.deepEqual(
      panel.getSnapshot().preferences.technicalPaneLayout,
      before.preferences.technicalPaneLayout
    );
    assert.equal(panel.getSnapshot().marketReady, true);
    parent.update({ rows: [] });
    panel.configure(undefined, parent.getSnapshot());
    assert.deepEqual(panel.getSnapshot().drawings, []);
    assert.deepEqual(panel.getSnapshot().candles, []);
    assert.equal(panel.getSnapshot().preferences.instrumentUid, null);
  } finally {
    panel.stop();
    panel.dispose();
    parent.dispose();
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test("camera transition capture includes auxiliary slots and awaits durability before migration", async () => {
  const { captureWorkspaceCameraViews, subscribeCamera } = flowModules()(
    "screens/terminal/controller-camera-sync.ts"
  );
  const identity = {},
    gate = deferred(),
    captured = [];
  const make = (name, session = identity) => ({
    getSnapshot: () => ({ owner: "device" }),
    sessionKey: () => session,
    saveView: () => {
      captured.push(name);
      return name === "panel" ? gate.promise : Promise.resolve();
    }
  });
  const main = make("main"),
    panel = make("panel"),
    foreign = make("foreign", {});
  const stops = [subscribeCamera(panel, () => {}), subscribeCamera(foreign, () => {})];
  try {
    let settled = false;
    const capture = captureWorkspaceCameraViews(main).then(() => {
      settled = true;
    });
    assert.deepEqual(captured.sort(), ["main", "panel"]);
    await tick();
    assert.equal(settled, false);
    gate.resolve();
    await capture;
    assert.equal(settled, true);
  } finally {
    gate.resolve();
    stops.forEach((stop) => stop());
  }
});

test("superseded API activation cannot adopt its client or re-pause the surviving workspace", async () => {
  const f = fixture(),
    gate = deferred();
  try {
    await f.session.start();
    const original = f.session.client;
    f.hooks.start = async (client) => {
      if (client.name === "First") await gate.promise;
    };
    const first = f.session.login(token, "First", false);
    const firstRejected = assert.rejects(first, { name: "AbortError" });
    while (f.clients.length < 2) await tick();
    await assert.rejects(f.session.login("t." + "b".repeat(45), "Second", false), /Invalid key/);
    assert.equal(f.session.client, original);
    assert.equal(original.closed, false);
    assert.equal(original.cachePaused, false);
    gate.resolve();
    await firstRejected;
    assert.equal(f.session.client, original);
    assert.equal(original.cachePaused, false);
    assert.equal(f.clients[1].closed, true);
    assert.equal(f.state().profileTransition, false);
  } finally {
    gate.resolve();
    f.session.dispose();
  }
});

test("bank adoption after a committed cloud import reloads canonical preferences before clearing recovery", async () => {
  const f = fixture();
  try {
    await f.session.start();
    const committed = { ...f.state().preferences, engine: "tradingview", rangeDays: 90, chartSettings: { grid: true } };
    f.session.bridge.settleTransfers = async () => {
      f.storage.loadPreferences = async () => committed;
      f.session.bridge.update({ importRecoveryRequired: true });
    };
    await f.session.login(token, "Bank", false);
    assert.equal(f.state().preferences.engine, "tradingview");
    assert.equal(f.state().preferences.rangeDays, 90);
    assert.equal(f.state().preferences.chartSettings.grid, true);
    assert.equal(f.state().importRecoveryRequired, false);
    assert.equal(f.session.workspaceBinding.cloudOwner, "legacy-google");
  } finally { f.session.dispose(); }
});

test("a recovery flush never writes old visible preferences over a committed import", async () => {
  const writes = [];
  const load = flowModules({
    "services/storage-v2.ts": { savePreferences: async (...args) => writes.push(args), flush: async () => {} },
    "services/storage-db.ts": {},
    "screens/terminal/workspace-annotations.ts": { flushWorkspaceAnnotations: async () => {} }
  });
  const { TerminalController } = load("screens/terminal/controller.ts");
  const controller = new TerminalController();
  controller.session.client = { flush: async () => {}, close: async () => {} };
  controller.update({ owner: "device", importRecoveryRequired: true });
  try { await controller.flush(); assert.deepEqual(writes, []); }
  finally { controller.dispose(); }
});
