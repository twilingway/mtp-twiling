import test from "node:test";
import assert from "node:assert/strict";
import { flowModules } from "./helpers/workspace-identity-flow.mjs";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";
const backup = () => ({
  application: "personal-terminal",
  schemaVersion: 2,
  layout: { engine: "kline" },
  watchlist: [],
  drawings: [],
  images: [],
  views: []
});
function fixture() {
  const originalDocument = globalThis.document;
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    baseURI: "http://localhost:5290/__dev/app/index.html"
  });
  globalThis.document = document;
  const factoryCalls = [],
    providers = new Map(),
    listeners = new Set(),
    market = {},
    cloud = {};
  const actualSignature = flowModules({ "services/storage-db.ts": {} })(
    "screens/terminal/controller-drive.ts"
  ).portableStateSignature;
  class Provider {
    listeners = new Set();
    calls = { prepare: 0, resume: 0, intent: 0, changed: 0, sync: 0, dispose: 0 };
    constructor(id) {
      this.id = id;
      this.status = {
        provider: id,
        enabled: false,
        automatic: true,
        configured: true,
        prepared: false,
        phase: "disabled",
        connected: false,
        pendingChanges: false,
        authorizationStored: false,
        credentialSaveError: false
      };
    }
    getSnapshot = () => this.status;
    subscribe = (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    prepare = async () => {
      this.calls.prepare++;
    };
    resume = () => {
      this.calls.resume++;
    };
    profileChanged = () => {};
    localIntent = () => {
      this.calls.intent++;
    };
    localChanged = () => {
      this.calls.changed++;
      this.status = { ...this.status, pendingChanges: true };
      this.listeners.forEach((listener) => listener());
    };
    setEnabled = async (enabled) => {
      this.status = { ...this.status, enabled, phase: enabled ? "idle" : "disabled" };
      this.listeners.forEach((listener) => listener());
    };
    setAutomatic = async (automatic) => {
      this.status = { ...this.status, automatic };
    };
    connectFromUserGesture = async () => {};
    disconnect = async () => this.setEnabled(false);
    sync = async () => {
      this.calls.sync++;
    };
    choose = async () => {};
    dispose = () => {
      this.calls.dispose++;
    };
  }
  const make = (id) => {
    factoryCalls.push(id);
    const provider = new Provider(id);
    providers.set(id, provider);
    return provider;
  };
  const load = flowModules({
    "screens/terminal/controller-drive.ts": {
      createTerminalGoogleSync: () => make("google-drive"),
      installTerminalGoogleSync() {},
      uninstallTerminalGoogleSync() {},
      portableStateSignature: actualSignature
    },
    "screens/terminal/controller-yandex-sync.ts": {
      createTerminalYandexSync: () => make("yandex-disk")
    },
    "services/cloud-public-config.ts": { yandexPublicConfig: () => undefined }
  });
  let state = {
    owner: "device",
    ready: true,
    preferences: {
      symbol: "SBER",
      instrumentUid: "one",
      timeframe: "1d",
      engine: "kline",
      rangeDays: 365
    },
    rows: [
      {
        symbol: "SBER",
        uid: "one",
        ticker: "SBER",
        name: "Bank",
        color: "#ffffff",
        mark: "S",
        figi: null,
        currency: "rub",
        step: 0.01,
        price: 100
      }
    ],
    drawings: [],
    images: []
  };
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => market,
    cloudSessionKey: () => cloud,
    workspaceBinding: () => ({ owner: "device", cloudOwner: "legacy-google", conflicts: [] }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    exportBackup: async () => backup(),
    importBackup: async (_backup, options) => {
      assert.equal(options.valid(), true);
      options.onCommitted();
    }
  };
  const api = load("screens/terminal/controller-cloud-sync.ts"),
    hostApi = load("screens/terminal/controller-cloud-host.ts");
  const host = hostApi.createCloudSyncHost(controller);
  return {
    ...api,
    host,
    controller,
    providers,
    factoryCalls,
    document,
    update(patch) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    restore() {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    }
  };
}

test("one shared lifecycle creates exactly one provider instance each and disabled wake creates no provider traffic", async () => {
  const f = fixture(),
    first = f.startTerminalCloudSync(f.controller),
    second = f.startTerminalCloudSync(f.controller);
  try {
    assert.deepEqual(f.factoryCalls, ["google-drive", "yandex-disk"]);
    assert.equal(
      f.terminalCloudSync(f.controller, "google-drive"),
      f.providers.get("google-drive")
    );
    f.document.dispatchEvent(new Event("visibilitychange"));
    for (const provider of f.providers.values()) {
      assert.equal(provider.calls.sync, 0);
      assert.equal(provider.calls.prepare, 0);
    }
    first();
    assert.equal(f.providers.get("google-drive").calls.dispose, 0);
    await f.providers.get("yandex-disk").setEnabled(true);
    f.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.providers.get("google-drive").calls.sync, 0);
    assert.equal(f.providers.get("yandex-disk").calls.sync, 1);
  } finally {
    second();
    f.restore();
  }
  assert.equal(f.providers.get("google-drive").calls.dispose, 1);
  assert.equal(f.providers.get("yandex-disk").calls.dispose, 1);
});

test("quotes never advance portable revision; enabled providers alone receive actual portable edits", async () => {
  const f = fixture(),
    stop = f.startTerminalCloudSync(f.controller);
  try {
    const original = f.controller.getSnapshot(),
      revision = f.host.scope("google-drive").revision;
    f.update({ rows: original.rows.map((row) => ({ ...row, price: 101 })) });
    assert.equal(f.host.scope("google-drive").revision, revision);
    await f.providers.get("yandex-disk").setEnabled(true);
    f.update({ preferences: { ...original.preferences, chartSettings: { grid: false } } });
    assert.equal(f.host.scope("google-drive").revision, revision + 1);
    assert.equal(f.providers.get("google-drive").calls.changed, 0);
    assert.equal(f.providers.get("yandex-disk").calls.changed, 1);
    f.update({ profileTransition: true });
    assert.equal(f.host.scope("google-drive").revision, revision + 2);
    assert.equal(f.providers.get("yandex-disk").calls.changed, 1);
    assert.equal(f.providers.get("yandex-disk").calls.intent, 1);
  } finally {
    stop();
    f.restore();
  }
});

test("accepted pull advances the shared revision and marks only the other provider pending", async () => {
  const f = fixture(),
    stop = f.startTerminalCloudSync(f.controller);
  try {
    await f.providers.get("google-drive").setEnabled(true);
    await f.providers.get("yandex-disk").setEnabled(true);
    const abort = new AbortController(),
      receipt = [];
    await f.host.apply(
      "google-drive",
      backup(),
      0,
      { signal: abort.signal, isCurrent: () => true },
      (revision) => receipt.push(revision)
    );
    assert.deepEqual(receipt, [1]);
    assert.equal(f.providers.get("google-drive").calls.changed, 0);
    assert.equal(f.providers.get("yandex-disk").calls.changed, 1);
    assert.equal(f.providers.get("yandex-disk").getSnapshot().pendingChanges, true);
  } finally {
    stop();
    f.restore();
  }
});

test("real Google binding is uninstalled after disposal and lifecycle remount installs one fresh instance", () => {
  const previousDocument = globalThis.document;
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const snapshot = {
    provider: "yandex-disk",
    enabled: false,
    configured: false,
    prepared: false,
    preparing: false,
    connected: false,
    automatic: false,
    phase: "disabled",
    pendingChanges: false,
    authorizationStored: false,
    credentialSaveError: false
  };
  const fakeYandex = {
    id: "yandex-disk",
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    resume() {},
    profileChanged() {},
    localIntent() {},
    localChanged() {},
    dispose() {},
    sync: async () => {}
  };
  let reads = 0;
  const load = flowModules({
    "services/storage-db.ts": {
      get: async () => {
        reads++;
        return undefined;
      }
    },
    "screens/terminal/controller-yandex-sync.ts": { createTerminalYandexSync: () => fakeYandex },
    "services/cloud-public-config.ts": { yandexPublicConfig: () => undefined }
  });
  const state = {
      owner: "guest",
      ready: false,
      rows: [],
      preferences: {},
      drawings: [],
      images: []
    },
    session = {};
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => null,
    cloudSessionKey: () => session,
    workspaceBinding: () => undefined,
    subscribe: () => () => {}
  };
  const registry = load("screens/terminal/controller-cloud-sync.ts"),
    google = load("screens/terminal/controller-drive.ts");
  let stop;
  try {
    stop = registry.startTerminalCloudSync(controller);
    const first = registry.terminalCloudSync(controller, "google-drive");
    assert.equal(google.terminalGoogleRetention(controller), first);
    assert.throws(() => google.terminalDrive(controller), /retention provider is active/);
    stop();
    assert.equal(google.terminalGoogleRetention(controller), undefined);
    stop = registry.startTerminalCloudSync(controller);
    const second = registry.terminalCloudSync(controller, "google-drive");
    assert.notEqual(second, first);
    assert.equal(google.terminalGoogleRetention(controller), second);
    assert.equal(reads, 0);
  } finally {
    stop?.();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("actual Google and Yandex factories stay disabled without network or popup through canonical startup and edits", async () => {
  const previousDocument = globalThis.document,
    previousFetch = globalThis.fetch;
  globalThis.document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    baseURI: "http://localhost:5290/__dev/app/index.html"
  });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    assert.fail("disabled provider attempted network");
  };
  const f = await createGuestFixture();
  f.storage.restoreSession = async () => null;
  const { TerminalController } = f.load("screens/terminal/controller.ts"),
    registry = f.load("screens/terminal/controller-cloud-sync.ts");
  const controller = new TerminalController();
  let stop;
  try {
    stop = registry.startTerminalCloudSync(controller);
    await controller.start();
    const google = registry.terminalCloudSync(controller, "google-drive"),
      yandex = registry.terminalCloudSync(controller, "yandex-disk");
    await Promise.all([google.prepare(), yandex.prepare()]);
    for (const provider of [google, yandex]) {
      const status = provider.getSnapshot();
      assert.equal(status.enabled, false);
      assert.equal(status.phase, "disabled");
      assert.equal(status.connected, false);
      assert.equal(status.pendingChanges, false);
      assert.equal(status.error, undefined);
    }
    controller.update({
      preferences: { ...controller.getSnapshot().preferences, chartSettings: { grid: false } }
    });
    globalThis.document.dispatchEvent(new Event("visibilitychange"));
    await Promise.all([google.sync(), yandex.sync()]);
    assert.equal(requests, 0);
    assert.equal(google.getSnapshot().pendingChanges, false);
    assert.equal(yandex.getSnapshot().pendingChanges, false);
  } finally {
    stop?.();
    controller.dispose();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
