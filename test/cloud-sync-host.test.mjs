import test from "node:test";
import assert from "node:assert/strict";
import { flowModules, deferred, tick } from "./helpers/workspace-identity-flow.mjs";
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
  const modules = flowModules({
    "screens/terminal/controller-camera-sync.ts": {
      workspaceCameraPending: () => false,
      flushWorkspaceCamera: async () => {}
    }
  });
  const api = modules("screens/terminal/controller-cloud-host.ts");
  const state = {
      owner: "device",
      ready: true,
      preferences: {},
      rows: [],
      drawings: [],
      images: []
    },
    session = {},
    hooks = {},
    imports = [];
  const controller = {
    getSnapshot: () => state,
    sessionKey: () => (hooks.noClient ? null : session),
    cloudSessionKey: () => session,
    workspaceBinding: () => ({ owner: "device", cloudOwner: "legacy-google", conflicts: [] }),
    exportBackup: async () => {
      await hooks.export?.();
      return hooks.backup?.() ?? backup();
    },
    importBackup: async (data, options) => {
      imports.push(data);
      await hooks.before?.();
      assert.equal(options.valid(), true);
      options.onCommitted();
      await hooks.after?.();
      assert.equal(options.valid(), true);
    }
  };
  const host = api.createCloudSyncHost(controller),
    abort = new AbortController();
  const guard = { signal: abort.signal, isCurrent: () => !abort.signal.aborted };
  return { ...api, host, state, hooks, imports, guard, abort, modules };
}

test("cloud host binds independent namespaces and rejects capture after synchronous user intent", async () => {
  const f = fixture(),
    gate = deferred();
  assert.equal(f.host.scope("google-drive").cloudOwner, "legacy-google");
  assert.equal(f.host.scope("yandex-disk").cloudOwner, "device");
  f.hooks.export = () => gate.promise;
  const capture = f.host.capture("google-drive", f.guard);
  const rejected = assert.rejects(capture, { code: "local-changed" });
  await tick();
  f.cloudHostIntent(f.host);
  gate.resolve();
  await rejected;
  assert.equal(f.host.scope("google-drive").revision, 1);
});

test("portable capture excludes secrets/history/quotes and rejects unknown supported fields", async () => {
  const f = fixture();
  const snapshot = await f.host.capture("yandex-disk", f.guard);
  assert.equal(snapshot.revision, 0);
  const payload = JSON.parse(await snapshot.prepared.payload.text());
  assert.equal(Object.hasOwn(payload, "history"), false);
  assert.equal(Object.hasOwn(payload, "owner"), false);
  assert.equal(snapshot.digest.length, 64);
  assert.equal((await f.host.decode(snapshot.prepared, f.guard)).schemaVersion, 2);
  await assert.rejects(
    f.host.apply(
      "yandex-disk",
      { ...backup(), privateCredential: "sentinel" },
      0,
      f.guard,
      () => {}
    )
  );
  assert.equal(f.imports.length, 0);
});

test("one native apply lease delivers exact own receipt and invalidates the other queued provider before its writer", async () => {
  const f = fixture(),
    before = deferred(),
    events = [];
  f.hooks.before = () => before.promise;
  f.subscribeCloudHostCommit(f.host, (provider, revision) =>
    events.push(["other-pending", provider, revision])
  );
  const first = f.host.apply("google-drive", backup(), 0, f.guard, (revision) => {
    events.push(["accepted", revision]);
  });
  const second = f.host.apply("yandex-disk", backup(), 0, f.guard, () =>
    assert.fail("stale operation committed")
  );
  const rejected = assert.rejects(second, { code: "local-changed" });
  await tick();
  assert.equal(f.imports.length, 1);
  before.resolve();
  await first;
  await rejected;
  assert.deepEqual(events, [
    ["other-pending", "google-drive", 1],
    ["accepted", 1]
  ]);
  assert.equal(f.host.scope("yandex-disk").revision, 1);
  assert.equal(f.imports.length, 1);
});

test("a new intent after native commit invalidates restoration while retaining the exact accepted receipt", async () => {
  const f = fixture(),
    receipts = [];
  await assert.rejects(
    f.host.apply("google-drive", backup(), 0, f.guard, (revision) => {
      receipts.push(revision);
      f.cloudHostIntent(f.host);
    }),
    { code: "local-changed" }
  );
  assert.deepEqual(receipts, [1]);
  assert.equal(f.host.scope("google-drive").revision, 2);
  assert.equal(f.imports.length, 1);
});

test("post-commit restore failure retains accepted revision and releases the lease without a rollback claim", async () => {
  const f = fixture(),
    receipts = [];
  f.hooks.after = async () => {
    f.state.importRecoveryRequired = true;
    throw new Error("Restore unavailable");
  };
  await assert.rejects(
    f.host.apply("google-drive", backup(), 0, f.guard, (revision) => receipts.push(revision)),
    /Restore unavailable/
  );
  assert.deepEqual(receipts, [1]);
  assert.equal(f.host.scope("google-drive").revision, 1);
  await assert.rejects(
    f.host.apply("yandex-disk", backup(), 1, f.guard, () => {}),
    { code: "local-changed" }
  );
  assert.equal(f.imports.length, 1);
});

test("provider abort before native commit leaves revision untouched and cannot abort the other provider", async () => {
  const f = fixture(),
    before = deferred();
  f.hooks.before = () => before.promise;
  const first = f.host.apply("google-drive", backup(), 0, f.guard, () =>
    assert.fail("aborted commit")
  );
  const rejected = assert.rejects(first, { name: "AbortError" });
  await tick();
  f.abort.abort();
  before.resolve();
  await rejected;
  assert.equal(f.host.scope("google-drive").revision, 0);
  delete f.hooks.before;
  const other = new AbortController();
  await f.host.apply(
    "yandex-disk",
    backup(),
    0,
    { signal: other.signal, isCurrent: () => true },
    () => {}
  );
  assert.equal(f.host.scope("yandex-disk").revision, 1);
});

test("binary decoder validates indexed bytes and their SHA before import", async () => {
  const f = fixture(),
    payload = new Blob([JSON.stringify(backup())], { type: "application/json" });
  const image = {
    index: 1,
    body: new Blob(["pixels"], { type: "image/png" }),
    reference: { sha256: "0".repeat(64), size: 6 },
    mimeType: "image/png"
  };
  await assert.rejects(f.host.decode({ payload, images: [image] }, f.guard), {
    code: "remote-invalid"
  });
  image.index = 0;
  await assert.rejects(f.host.decode({ payload, images: [image] }, f.guard), {
    code: "remote-invalid"
  });
  assert.equal(f.imports.length, 0);
});

test("external tool or preview admitted during a precommit wait blocks the writer without a revision change", async () => {
  for (const patch of [
    { activeTool: "horizontalStraightLine" },
    { preview: { id: "preview" } },
    { dialog: "instruments" }
  ]) {
    const f = fixture(),
      receipts = [];
    f.hooks.before = async () => Object.assign(f.state, patch);
    await assert.rejects(
      f.host.apply("google-drive", backup(), 0, f.guard, (revision) => receipts.push(revision)),
      { code: "local-changed" }
    );
    assert.deepEqual(receipts, []);
    assert.equal(f.host.scope("google-drive").revision, 0);
  }
});

test("capture rechecks external blocks after each await", async () => {
  const f = fixture();
  f.hooks.export = async () => {
    f.state.preview = { id: "preview" };
  };
  await assert.rejects(f.host.capture("google-drive", f.guard), { code: "local-changed" });
});

test("an auxiliary pan invalidates a pending cloud capture before RAF and old market callbacks stay fenced", async () => {
  const load = flowModules(),
    api = load("screens/terminal/controller-cloud-host.ts"),
    camera = load("screens/terminal/controller-camera-sync.ts");
  let market = {},
    alive = true;
  const cloudSession = {},
    gate = deferred(),
    row = { uid: "one", symbol: "SBER" };
  const state = {
    owner: "device",
    ready: true,
    marketReady: true,
    chartRevision: 0,
    rows: [row],
    preferences: {
      symbol: "SBER",
      instrumentUid: "one",
      timeframe: "1d",
      engine: "kline",
      rangeDays: 365
    }
  };
  const root = {
    getSnapshot: () => state,
    sessionKey: () => market,
    cloudSessionKey: () => cloudSession,
    workspaceBinding: () => ({ owner: "device", cloudOwner: "legacy-google", conflicts: [] }),
    exportBackup: async () => {
      await gate.promise;
      return backup();
    }
  };
  const chart = { source: { owner: "device", uid: "one", viewKey: "SBER:1d:kline:365" } };
  const panel = { ...root, chart, workspaceSlot: 3, notify() {} };
  const host = api.createCloudSyncHost(root),
    abort = new AbortController();
  let localIntents = 0,
    globalIntents = 0;
  const stopLocal = camera.subscribeCamera(panel, (kind) => {
    if (kind === "intent") localIntents++;
  });
  const stopGlobal = camera.subscribeWorkspaceCamera(root, (kind) => {
    if (kind === "intent") {
      globalIntents++;
      api.cloudHostIntent(host);
    }
  });
  const callbacks = camera.cameraCallbacks(
    panel,
    () => chart,
    () => alive,
    async () => {}
  );
  try {
    const capture = host.capture("google-drive", { signal: abort.signal, isCurrent: () => true });
    const rejected = assert.rejects(capture, { code: "local-changed" });
    await tick();
    callbacks.onCameraIntent();
    assert.equal(globalIntents, 1);
    assert.equal(localIntents, 1);
    assert.equal(host.scope("google-drive").revision, 1);
    assert.equal(camera.workspaceCameraPending(root), true);
    gate.resolve();
    await rejected;
    callbacks.onCameraIdle("cancelled");
    assert.equal(camera.workspaceCameraPending(root), false);
    market = {};
    callbacks.onCameraIntent();
    assert.equal(globalIntents, 1);
    assert.equal(localIntents, 1);
    alive = false;
    callbacks.onCameraIntent();
    assert.equal(globalIntents, 1);
  } finally {
    gate.resolve();
    stopLocal();
    stopGlobal();
  }
});

test("only a successful pending camera write from the same transition generation emits a durable global change", () => {
  for (const variant of [
    "saved",
    "no-pending",
    "failed",
    "new-write",
    "new-pending",
    "client",
    "cloud-session",
    "owner",
    "view",
    "document",
    "chart",
    "import",
    "recovery",
    "migration"
  ]) {
    const camera = flowModules()("screens/terminal/controller-camera-sync.ts");
    let market = {},
      cloud = {},
      local = 0,
      global = 0;
    const state = {
      owner: "device",
      ready: true,
      marketReady: true,
      chartRevision: 0,
      rows: [{ uid: "one", symbol: "SBER" }],
      preferences: {
        symbol: "SBER",
        instrumentUid: "one",
        timeframe: "1d",
        engine: "kline",
        rangeDays: 365
      }
    };
    const root = {
      getSnapshot: () => state,
      sessionKey: () => market,
      cloudSessionKey: () => cloud
    };
    const chart = { source: { owner: "device", uid: "one", viewKey: "SBER:1d:kline:365" } };
    const panel = { ...root, chart, notify() {} };
    const stopLocal = camera.subscribeCamera(panel, (kind) => {
      if (kind === "change") local++;
    });
    const stopGlobal = camera.subscribeWorkspaceCamera(root, (kind) => {
      if (kind === "change") global++;
    });
    const callbacks = camera.cameraCallbacks(
      panel,
      () => chart,
      () => true,
      async () => {}
    );
    try {
      if (variant !== "no-pending") callbacks.onCameraIntent();
      const saved = camera.fenceCameraWrites(panel);
      if (variant === "new-write") camera.fenceCameraWrites(panel);
      if (variant === "new-pending") callbacks.onCameraIntent();
      state.profileTransition = true;
      assert.equal(camera.workspaceCameraPending(root), false);
      if (variant === "client") market = {};
      if (variant === "cloud-session") cloud = {};
      if (variant === "owner") state.owner = "other";
      if (variant === "view") state.preferences.timeframe = "1h";
      if (variant === "document") state.rows = [{ uid: "two", symbol: "OTHER" }];
      if (variant === "chart") state.chartRevision++;
      if (variant === "import") state.importingBackup = true;
      if (variant === "recovery") state.importRecoveryRequired = true;
      if (variant === "migration") state.workspaceMigrationIncomplete = true;
      // The storage writer only invokes its receipt after successful I/O.
      if (variant !== "failed") {
        saved();
        saved();
      }
      assert.equal(global, variant === "saved" ? 1 : 0, variant);
      assert.equal(local, 0, variant);
    } finally {
      stopLocal();
      stopGlobal();
    }
  }
});

test("a disposed workspace with a retained binding is not ready until its local client is adopted", async () => {
  const f = fixture();
  f.hooks.noClient = true;
  assert.equal(f.host.scope("google-drive").ready, false);
  await assert.rejects(f.host.capture("google-drive", f.guard), { code: "local-changed" });
});

test("local capture strips only known runtime fields and rejects unknown data before upload", async () => {
  const f = fixture();
  f.hooks.backup = () => ({ ...backup(), owner: "local-only", history: [] });
  const snapshot = await f.host.capture("yandex-disk", f.guard);
  const payload = JSON.parse(await snapshot.prepared.payload.text());
  assert.equal(Object.hasOwn(payload, "owner"), false);
  assert.equal(Object.hasOwn(payload, "history"), false);
  f.hooks.backup = () => ({ ...backup(), futurePortableField: { data: "keep-me" } });
  await assert.rejects(f.host.capture("google-drive", f.guard), { code: "unsupported-format" });
  f.hooks.backup = () => ({ ...backup(), history: [{ data: "must-stay-local" }] });
  await assert.rejects(f.host.capture("google-drive", f.guard), { code: "unsupported-format" });
});

test("real controller import and cached-bank restoration tolerate their own transfer/loading barriers", async () => {
  const f = await createGuestFixture();
  f.storage.restoreSession = async () => null;
  await f.storage.savePreferences("public", {
    engine: "kline",
    rangeDays: 1,
    chartSettings: { grid: false }
  });
  await f.storage.saveWatchlistSnapshot("public", [
    {
      uid: "one",
      symbol: "SBER",
      ticker: "SBER",
      name: "Bank",
      color: "#ffffff",
      mark: "S",
      figi: null,
      currency: "rub",
      step: 0.01
    }
  ]);
  const { TerminalController } = f.load("screens/terminal/controller.ts");
  const { createCloudSyncHost } = f.load("screens/terminal/controller-cloud-host.ts");
  const controller = new TerminalController();
  try {
    await controller.start();
    const host = createCloudSyncHost(controller),
      abort = new AbortController();
    const guard = { signal: abort.signal, isCurrent: () => true };
    const captured = await host.capture("google-drive", guard);
    assert.equal(captured.backup.watchlist[0].uid, "one");
    assert.equal(Object.hasOwn(captured.backup, "history"), false);
    const incoming = {
      ...captured.backup,
      layout: {
        ...captured.backup.layout,
        engine: "tradingview",
        rangeDays: 2,
        chartSettings: { ...captured.backup.layout.chartSettings, grid: true }
      }
    };
    const receipts = [];
    await host.apply("google-drive", incoming, captured.revision, guard, (revision) =>
      receipts.push(revision)
    );
    assert.deepEqual(receipts, [captured.revision + 1]);
    assert.equal(controller.getSnapshot().preferences.engine, "tradingview");
    assert.equal(controller.getSnapshot().preferences.chartSettings.grid, true);
    assert.equal(controller.getSnapshot().importRecoveryRequired, false);
    assert.equal(controller.getSnapshot().loading, false);
    assert.equal(host.scope("google-drive").blocked, false);
    assert.equal(controller.getSnapshot().owner, "device");
    assert.equal(controller.getSnapshot().rows[0].uid, "one");
  } finally {
    controller.dispose();
  }
});
