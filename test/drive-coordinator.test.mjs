import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts"), key = path.relative(root, file).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(specifier => load(path.relative(root, path.resolve(path.dirname(file), specifier))), module, module.exports);
    return module.exports;
  }
  return load;
}
const load = sources(), { DriveCoordinator } = load("services/drive/coordinator.ts"), { DriveSync } = load("services/drive/sync.ts"),
  { sanitizeDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
class Store {
  files = []; bodies = new Map(); hooks = {};
  async list(kind) { await this.hooks.list?.(kind); return this.files.filter(file => file.appProperties.mtpKind === kind).map(file => structuredClone(file)); }
  async read(file, max) { await this.hooks.read?.(file); const body = this.bodies.get(file.id); assert.ok(body.size <= max); return body; }
  async create(kind, key, hash, body) {
    const file = { id: crypto.randomUUID(), name: kind, size: body.size, appProperties: { mtpNamespace: "mtp-drive-v2", mtpKind: kind, mtpKey: key, mtpHash: hash } };
    await this.hooks.create?.(kind); this.files.push(file); this.bodies.set(file.id, body); return structuredClone(file);
  }
  count() { return this.files.filter(file => file.appProperties.mtpKind === "snapshot").length; }
}
function backup(theme = "dark") {
  return { application: "personal-terminal", schemaVersion: 1, exportedAt: new Date().toISOString(),
    layout: { locale: "en", timeZone: "America/New_York", favoriteIntervals: ["1m", "1d"], rightPanelCollapsed: true, rightPanelTab: "objects", sidebarWidth: 320,
      indicatorPaneLayout: { volume: { heightRatio: 0.3 } }, chartSettings: { theme, legendCollapsed: true, drawingTools: { magnet: "strong", favorites: ["segment"], lastTools: { lines: "segment" } } } },
    watchlist: [{ uid: "uid-test", symbol: "SBER", name: "Test", price: 123, change: 10 }],
    drawings: [{ symbol: "SBER", items: [{ id: "same", name: "horizontalStraightLine", points: [{ timestamp: 1700000000, value: 5 }] }] }],
    images: [{ id: "image", symbol: "SBER", type: "image/png", width: 100, point: { timestamp: 1700000000, value: 5 }, data: btoa("png fixture bytes") }], views: [], history: [{ uid: "uid-test", timeframe: "1d", day: "2026-01-01", data: btoa("LOCAL-HISTORY") }], token: "PRIVATE-BANK-TOKEN", owner: "PRIVATE-OWNER" };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise(setImmediate);
function fixture(store = new Store(), options = {}) {
  let local = backup(), profile = { owner: "A", session: {}, authenticated: true, blocked: options.blocked ?? false }, online = options.online ?? true, authorization, record = { schemaVersion: 1, deviceId: crypto.randomUUID(), markerId: crypto.randomUUID(), baseHeads: [], automatic: options.automatic ?? true }, disconnects = 0;
  const hooks = { ...options.hooks }, imports = [], writes = [], events = [];
  const auth = { async prepare() { events.push("prepare"); }, connectFromUserGesture() {
    events.push("click"); const abort = new AbortController();
    authorization = { connectionId: crypto.randomUUID(), signal: abort.signal, getAccessToken: () => "fake-token", invalidate: () => abort.abort() };
    return Promise.resolve(authorization);
  }, async restore(owner) { authorization = await hooks.restore?.(owner); return authorization; }, suspend() { authorization?.invalidate(); }, async disconnect() { disconnects++; authorization?.invalidate(); await hooks.disconnect?.(); } };
  const bridge = { profile: () => profile, async exportBackup() { events.push("export"); await hooks.export?.(); return structuredClone(local); }, async importBackup(incoming, options) {
    assert.equal(options.replacePortable, true); await hooks.beforeCommit?.();
    if (!options.valid()) throw new DOMException("changed", "AbortError");
    local = structuredClone(incoming); imports.push(local); options.onCommitted();
    coordinator.localChanged(); // Own profile restoration must not create an echo.
    local.layout.rangeDays ??= 365; // prepareProfile fills defaults.
    await hooks.postcommit?.();
  } };
  const coordinator = new DriveCoordinator(bridge, { auth, online: () => online, sync: () => new DriveSync(store), load: async () => structuredClone(record), save: async (owner, value) => { writes.push({ owner, value: structuredClone(value) }); record = structuredClone(value); } });
  coordinator.profileChanged();
  return { coordinator, store, hooks, imports, writes, events, local: () => local, record: () => record, authorization: () => authorization, disconnects: () => disconnects,
    edit(patch) { local = { ...local, ...patch }; coordinator.localChanged(); },
    setStore(next) { store = next; },
    setOnline(value) { online = value; }, setRecord(patch) { record = { ...record, ...patch }; }, changeProfile(patch) { profile = { ...profile, ...patch }; coordinator.profileChanged(); },
    async connect() { await coordinator.prepare(); await coordinator.connect(); },
    async remote(incoming) { const sync = new DriveSync(store), inspection = await sync.inspect(); return sync.publish(incoming, { deviceId: crypto.randomUUID(), parents: inspection.heads }); }
  };
}

test("initial upload preserves complete portable preferences and strips bank/history/prices; repeated sync has no echo", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  assert.deepEqual(f.events.slice(0, 2), ["prepare", "click"]);
  assert.equal(f.store.count(), 1); assert.equal(f.coordinator.getSnapshot().phase, "idle");
  const sync = new DriveSync(f.store), downloaded = await sync.download((await sync.inspect()).heads[0]);
  assert.deepEqual(downloaded.layout, f.local().layout);
  for (const secret of ["PRIVATE-BANK-TOKEN", "PRIVATE-OWNER", "LOCAL-HISTORY", '"price"']) assert.ok(!JSON.stringify(downloaded).includes(secret));
  await f.coordinator.sync(); assert.equal(f.store.count(), 1); assert.ok(f.coordinator.getSnapshot().lastSyncedAt);
});

test("clean device pulls remote changes through guarded portable import and normalized restore produces no echo", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  const incoming = backup("light"); incoming.drawings = []; incoming.images = [];
  await f.remote(incoming); await f.coordinator.sync();
  assert.equal(f.imports.length, 1); assert.equal(f.local().layout.chartSettings.theme, "light");
  assert.deepEqual(f.local().drawings, []); assert.deepEqual(f.local().images, []);
  assert.equal(f.local().layout.favoriteIntervals[1], "1d"); assert.equal(f.local().layout.indicatorPaneLayout.volume.heightRatio, 0.3);
  assert.equal(f.local().layout.rangeDays, 365); assert.equal(f.store.count(), 2);
  await f.coordinator.sync(); assert.equal(f.store.count(), 2);
});

test("first link to populated Drive previews exact counts/date and never overwrites without choice", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.remote(backup("light")); await f.connect();
  const status = f.coordinator.getSnapshot(); assert.equal(status.phase, "conflict"); assert.equal(f.imports.length, 0); assert.equal(f.store.count(), 1);
  assert.deepEqual({ ...status.conflict.remotes[0], nodeId: undefined, date: undefined }, { instruments: 1, drawings: 1, images: 1, nodeId: undefined, date: undefined });
  assert.ok(Number.isFinite(Date.parse(status.conflict.remotes[0].date)));
  await f.coordinator.choose(status.conflict.remotes[0].nodeId);
  assert.equal(f.imports.length, 1); assert.equal(f.local().layout.chartSettings.theme, "light");
  assert.equal(f.local().images[0].data, btoa("png fixture bytes"));
});

test("reconnecting an associated profile to an empty Drive requires a choice before uploading", async t => {
  const f = fixture(undefined, { automatic: false });
  t.after(() => f.coordinator.disconnect());
  await f.connect();
  const previous = structuredClone(f.record());
  const otherStore = new Store();
  f.coordinator.disconnect();
  f.setStore(otherStore);

  await f.connect();
  const status = f.coordinator.getSnapshot();
  assert.equal(status.phase, "conflict");
  assert.equal(status.automatic, false);
  assert.deepEqual(status.conflict.remotes, []);
  assert.equal(otherStore.files.length, 0);
  assert.equal(f.imports.length, 0);
  assert.deepEqual(f.record(), previous);

  await f.coordinator.choose("local");
  const inspection = await new DriveSync(otherStore).inspect();
  assert.equal(f.coordinator.getSnapshot().phase, "idle");
  assert.equal(inspection.snapshots.length, 1);
  assert.deepEqual(inspection.snapshots[0].manifest.parents, []);
  assert.deepEqual(f.record().baseHeads, inspection.heads);
  assert.equal(f.store.count(), 1);
});

test("reconnecting a clean profile to an unrelated populated Drive previews both choices", async t => {
  for (const choice of ["local", "cloud"]) {
    await t.test(choice, async t => {
      const f = fixture(undefined, { automatic: false });
      t.after(() => f.coordinator.disconnect());
      await f.connect();
      const previous = structuredClone(f.record());
      const otherStore = new Store();
      const remote = new DriveSync(otherStore);
      const { nodeId } = await remote.publish(backup("light"), {
        deviceId: crypto.randomUUID(),
        parents: []
      });
      const initialFiles = otherStore.files.length;
      f.coordinator.disconnect();
      f.setStore(otherStore);

      await f.connect();
      const status = f.coordinator.getSnapshot();
      assert.equal(status.phase, "conflict");
      assert.deepEqual(status.conflict.remotes.map(item => item.nodeId), [nodeId]);
      assert.equal(otherStore.files.length, initialFiles);
      assert.equal(f.imports.length, 0);
      assert.deepEqual(f.record(), previous);

      await f.coordinator.choose(choice === "local" ? "local" : nodeId);
      const inspection = await remote.inspect();
      assert.equal(f.coordinator.getSnapshot().phase, "idle");
      assert.deepEqual(f.record().baseHeads, inspection.heads);
      assert.equal(f.store.count(), 1);
      if (choice === "local") {
        const current = inspection.snapshots.find(
          item => item.manifest.nodeId === inspection.heads[0]
        );
        assert.deepEqual(current.manifest.parents, [nodeId]);
        assert.equal(f.imports.length, 0);
      } else {
        assert.equal(otherStore.files.length, initialFiles);
        assert.equal(f.imports.length, 1);
        assert.equal(f.local().layout.chartSettings.theme, "light");
      }
    });
  }
});

test("divergent local and remote edits require choice; choosing local creates a preserved child", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  await f.remote(backup("light")); f.edit({ layout: { ...f.local().layout, locale: "ru" } }); await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "conflict"); assert.equal(f.imports.length, 0);
  await f.coordinator.choose("local"); assert.equal(f.local().layout.locale, "ru"); assert.equal(f.store.count(), 3);
  assert.equal(f.coordinator.getSnapshot().phase, "idle"); assert.equal((await new DriveSync(f.store).inspect()).heads.length, 1);
});

test("stale conflict preview cannot erase edits made after the preview", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.remote(backup("light")); await f.connect();
  const node = f.coordinator.getSnapshot().conflict.remotes[0].nodeId;
  f.edit({ layout: { ...f.local().layout, locale: "ru" } }); await f.coordinator.choose(node);
  assert.equal(f.imports.length, 0); assert.equal(f.local().layout.locale, "ru"); assert.equal(f.coordinator.getSnapshot().phase, "conflict");
});

test("a local edit during remote pull or waiting for commit prevents replacement", async t => {
  for (const phase of ["download", "commit"]) {
    const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect(); await f.remote(backup("light"));
    const gate = deferred(); let entered = false;
    if (phase === "download") f.store.hooks.read = async file => { if (file.appProperties.mtpKind === "blob") { entered = true; await gate.promise; } };
    else f.hooks.beforeCommit = async () => { entered = true; await gate.promise; };
    const syncing = f.coordinator.sync(); while (!entered) await tick();
    f.edit({ layout: { ...f.local().layout, locale: "ru" } }); gate.resolve(); await syncing;
    assert.equal(f.imports.length, 0); assert.equal(f.local().layout.locale, "ru"); assert.equal(f.coordinator.getSnapshot().error, "local-changed");
  }
});

test("owner/session changes abort Google authorization and pending imports", async t => {
  for (const patch of [{ owner: "B" }, { session: {} }, { authenticated: false }]) {
    const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect(); await f.remote(backup("light"));
    const gate = deferred(); let entered = false;
    f.hooks.beforeCommit = async () => { entered = true; await gate.promise; };
    const syncing = f.coordinator.sync(); while (!entered) await tick();
    const authorization = f.authorization(); f.changeProfile(patch); assert.equal(authorization.signal.aborted, true);
    gate.resolve(); await syncing;
    assert.equal(f.imports.length, 0); assert.equal(f.coordinator.getSnapshot().phase, "disconnected");
    assert.equal(f.writes.some(item => item.owner === "B"), false);
  }
});

test("expired memory authorization exposes reauthentication and never writes a new cloud snapshot", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  f.authorization().invalidate(); await f.coordinator.sync();
  assert.equal(f.coordinator.getSnapshot().phase, "auth-required"); assert.equal(f.coordinator.getSnapshot().connected, false); assert.equal(f.store.count(), 1);
  assert.ok(!JSON.stringify(f.writes).includes("fake-token"));
});

test("automatic debounce coalesces edits and disabled automatic sync retains explicit sync", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  const synchronized = new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Second automatic snapshot did not complete within 5 seconds"));
    }, 5000);
    unsubscribe = f.coordinator.subscribe(() => {
      if (f.store.count() === 2 && f.coordinator.getSnapshot().phase === "idle") {
        clearTimeout(timer); unsubscribe(); resolve();
      }
    });
    t.after(() => { clearTimeout(timer); unsubscribe(); });
  });
  f.edit({ layout: { ...f.local().layout, locale: "ru" } }); f.edit({ layout: { ...f.local().layout, timeZone: "Europe/Moscow" } });
  await synchronized;
  assert.equal(f.store.count(), 2);
  await f.coordinator.setAutomatic(false); f.edit({ layout: { ...f.local().layout, locale: "en" } });
  await new Promise(resolve => setTimeout(resolve, 1600)); assert.equal(f.store.count(), 2);
  await f.coordinator.sync(); assert.equal(f.store.count(), 3);
});

test("quote changes do not dirty portable signatures; pixel replacements and UI settings do", () => {
  const signature = sources({ "services/drive/local.ts": {} })("screens/terminal/controller-drive.ts").portableStateSignature;
  const state = { preferences: backup().layout, rows: backup().watchlist, drawings: [], images: [] }, before = signature(state);
  assert.equal(signature({ ...state, rows: state.rows.map(row => ({ ...row, price: 99999, change: -5 })) }), before);
  assert.notEqual(signature({ ...state, preferences: { ...state.preferences, locale: "ru" } }), before);
});

test("portable allowlist preserves all current preferences and validates future flag payloads", async () => {
  const source = backup(); source.layout.watchlistFlags = { "uid:uid-test": "purple", "legacy:SBER": "red" };
  source.layout.watchlistFlagFilter = "purple";
  assert.deepEqual(sanitizeDriveBackup(source).layout.watchlistFlags, source.layout.watchlistFlags);
  assert.equal(sanitizeDriveBackup(source).layout.watchlistFlagFilter, "purple");
  assert.equal(await driveBackupDigest(source), await driveBackupDigest({ ...source, exportedAt: "different timestamp" }));
  for (const flags of [{ "uid:test": "orange" }, { "uid:test": { token: "x" } }, { arbitrary: "red" }]) {
    assert.throws(() => sanitizeDriveBackup({ ...source, layout: { ...source.layout, watchlistFlags: flags } }), error => error.code === "remote-invalid");
  }
  assert.throws(() => sanitizeDriveBackup({ ...source, layout: { ...source.layout, watchlistFlagFilter: "orange" } }), error => error.code === "remote-invalid");
});

async function concurrentRemoteBranches(f) {
  const parents = (await new DriveSync(f.store).inspect()).heads;
  const create = f.store.create.bind(f.store), gate = deferred();
  let waiting = 0;
  f.store.create = async (...args) => {
    if (args[0] === "snapshot") {
      if (++waiting === 2) gate.resolve();
      await gate.promise;
    }
    return create(...args);
  };
  const first = backup("light"); first.layout.sidebarWidth = 330;
  const second = backup("dark"); second.layout.sidebarWidth = 340;
  try {
    return await Promise.all([first, second].map(value => new DriveSync(f.store).publish(value, {
      deviceId: crypto.randomUUID(), parents
    })));
  } finally {
    f.store.create = create;
  }
}

for (const choice of ["local", "remote"]) {
  for (const edit of ["none", "after-choice", "during-write"]) {
    test(`${choice} resolution accepts only its own node when a newer descendant arrives (${edit})`, async t => {
      const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
      const branches = await concurrentRemoteBranches(f);
      f.edit({ layout: { ...f.local().layout, locale: "ru" } });
      await f.coordinator.sync();
      assert.equal(f.coordinator.getSnapshot().phase, "conflict");
      const previousHeads = [...f.record().baseHeads];
      const create = f.store.create.bind(f.store);
      let inject = true, descendant, resolution;
      f.store.create = async (...args) => {
        const result = await create(...args);
        if (args[0] === "snapshot" && inject) {
          inject = false;
          resolution = result.appProperties.mtpKey;
          const newer = backup("light"); newer.layout.sidebarWidth = 499;
          descendant = (await f.remote(newer)).nodeId;
          if (edit === "during-write")
            f.edit({ layout: { ...f.local().layout, sidebarWidth: 450 } });
        }
        return result;
      };
      await f.coordinator.choose(choice === "local" ? "local" : branches[0].nodeId);
      assert.ok(descendant); assert.ok(resolution);
      assert.deepEqual((await new DriveSync(f.store).inspect()).heads, [descendant]);
      assert.deepEqual(f.record().baseHeads, edit === "during-write" ? previousHeads : [resolution]);
      assert.equal(f.imports.length, choice === "remote" && edit !== "during-write" ? 1 : 0);
      if (edit === "after-choice")
        f.edit({ layout: { ...f.local().layout, sidebarWidth: 450 } });
      const importsBefore = f.imports.length;
      await f.coordinator.sync();
      assert.equal(f.store.count(), 5, "both branches, resolution and descendant are retained without an echo");
      if (edit === "none") {
        assert.equal(f.imports.length, importsBefore + 1);
        assert.equal(f.local().layout.sidebarWidth, 499);
        assert.deepEqual(f.record().baseHeads, [descendant]);
        assert.equal(f.coordinator.getSnapshot().phase, "idle");
      } else {
        assert.equal(f.imports.length, importsBefore, "new local edits must not be overwritten");
        assert.equal(f.local().layout.sidebarWidth, 450);
        assert.equal(f.coordinator.getSnapshot().phase, "conflict");
      }
      assert.equal((await new DriveSync(f.store).download(descendant)).layout.sidebarWidth, 499);
    });
  }
}

function restoredAuthorization() {
  const abort = new AbortController();
  return { connectionId: crypto.randomUUID(), signal: abort.signal, stored: true,
    getAccessToken() { if (abort.signal.aborted) throw Object.assign(new Error("expired"), { code: "auth-required" }); return "unit-restored-access"; },
    invalidate: () => abort.abort() };
}
async function until(condition) {
  const deadline = performance.now() + 5000;
  while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), "condition completed");
}

test("startup restores valid authorization without account settings/GIS and honors saved automatic=false", async t => {
  for (const automatic of [true, false]) {
    const f = fixture(undefined, { automatic, hooks: { restore: async () => restoredAuthorization() } }); t.after(() => f.coordinator.disconnect());
    await until(() => f.coordinator.getSnapshot().connected && f.coordinator.getSnapshot().phase === "idle");
    assert.equal(f.coordinator.getSnapshot().authorizationStored, true);
    assert.equal(f.coordinator.getSnapshot().automatic, automatic);
    assert.equal(f.store.count(), automatic ? 1 : 0); assert.ok(!f.events.includes("prepare")); assert.ok(!f.events.includes("click"));
    if (!automatic) { assert.equal(f.events.includes("export"), false); await f.coordinator.sync(); assert.equal(f.store.count(), 1); }
  }
});

test("offline pauses before export/API and preserves dirty changes until a successful wake", async t => {
  const f = fixture(undefined, { online: false }); t.after(() => f.coordinator.disconnect());
  f.edit({ layout: { ...f.local().layout, locale: "ru" } }); await f.connect();
  assert.equal(f.events.includes("export"), false); assert.equal(f.store.count(), 0);
  assert.equal(f.coordinator.getSnapshot().pauseReason, "offline"); assert.equal(f.coordinator.getSnapshot().pendingChanges, true);
  assert.equal(f.coordinator.getSnapshot().lastSyncedAt, undefined);
  f.setOnline(true); await f.coordinator.sync();
  assert.equal(f.store.count(), 1); assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
  assert.equal(f.coordinator.getSnapshot().pauseReason, undefined);
});

test("expired credential is detected before local export and does not masquerade as network failure", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  f.edit({ layout: { ...f.local().layout, locale: "ru" } });
  const exports = f.events.filter(x => x === "export").length;
  f.authorization().getAccessToken = () => { throw new Error("expired fixture"); };
  await f.coordinator.sync();
  assert.equal(f.events.filter(x => x === "export").length, exports); assert.equal(f.store.count(), 1);
  assert.equal(f.coordinator.getSnapshot().phase, "auth-required"); assert.equal(f.coordinator.getSnapshot().pauseReason, "auth-required");
  assert.equal(f.coordinator.getSnapshot().pendingChanges, true);
});

test("failed Google network request keeps the accepted base/digest/time and pending changes", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  const before = structuredClone(f.record()), last = f.coordinator.getSnapshot().lastSyncedAt;
  f.edit({ layout: { ...f.local().layout, locale: "ru" } });
  f.store.hooks.list = () => { throw new Error("unit network outage"); }; await f.coordinator.sync();
  assert.deepEqual(f.record().baseHeads, before.baseHeads); assert.equal(f.record().lastSyncedDigest, before.lastSyncedDigest);
  assert.equal(f.coordinator.getSnapshot().lastSyncedAt, last); assert.equal(f.store.count(), 1);
  assert.equal(f.coordinator.getSnapshot().pendingChanges, true); assert.equal(f.coordinator.getSnapshot().pauseReason, "network");
  delete f.store.hooks.list; await f.coordinator.sync();
  assert.equal(f.store.count(), 2); assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
});

test("local edit during publication stays dirty although the completed older snapshot is acknowledged", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  f.edit({ layout: { ...f.local().layout, locale: "ru" } }); let changed = false;
  f.store.hooks.create = kind => { if (kind === "snapshot" && !changed) { changed = true; f.edit({ layout: { ...f.local().layout, sidebarWidth: 499 } }); } };
  await f.coordinator.sync(); assert.equal(f.store.count(), 2); assert.equal(f.coordinator.getSnapshot().pendingChanges, true);
  assert.equal(f.record().pendingChanges, true);
  assert.notEqual(f.record().lastSyncedDigest, await driveBackupDigest(f.local()));
  await f.coordinator.sync(); assert.equal(f.store.count(), 3); assert.equal(f.coordinator.getSnapshot().pendingChanges, false);
});

test("late authorization restore from the old bank owner is aborted before any export/API", async t => {
  const gate = deferred(), old = restoredAuthorization(); let entered = false;
  const f = fixture(undefined, { hooks: { restore: async owner => { if (owner === "A") { entered = true; await gate.promise; return old; } return undefined; } } }); t.after(() => f.coordinator.disconnect());
  await until(() => entered); f.changeProfile({ owner: "B", session: {} }); gate.resolve();
  await until(() => old.signal.aborted); assert.equal(f.coordinator.getSnapshot().connected, false);
  assert.equal(f.events.includes("export"), false); assert.equal(f.store.count(), 0);
});

test("restored automatic sync waits for startup transfer barriers and resumes once they settle", async t => {
  const f = fixture(undefined, { blocked: true, hooks: { restore: async () => restoredAuthorization() } }); t.after(() => f.coordinator.disconnect());
  await until(() => f.coordinator.getSnapshot().connected);
  assert.equal(f.events.includes("export"), false); f.changeProfile({ blocked: false });
  await until(() => f.store.count() === 1 && f.coordinator.getSnapshot().phase === "idle");
  f.changeProfile({ blocked: false }); await tick(); assert.equal(f.store.count(), 1);
});

test("lifecycle remount restores after suspend without clearing saved authorization", async t => {
  const f = fixture(); t.after(() => f.coordinator.disconnect()); await f.connect();
  const disconnects = f.disconnects(); f.coordinator.suspend();
  f.hooks.restore = async () => restoredAuthorization(); f.coordinator.resume();
  await until(() => f.coordinator.getSnapshot().connected && f.coordinator.getSnapshot().phase === "idle");
  assert.equal(f.disconnects(), disconnects); assert.equal(f.store.count(), 1); assert.equal(f.events.filter(x => x === "click").length, 1);
});

test("one online event wakes automatic sync once and teardown removes that listener without logout", () => {
  const listeners = new Map(), docListeners = new Map(); let syncs = 0, suspends = 0, resumes = 0;
  class Coordinator {
    resume() { resumes++; } profileChanged() {} localChanged() {} localIntent() {}
    getSnapshot() { return { automatic: true, phase: "idle" }; }
    async sync() { syncs++; } suspend() { suspends++; }
  }
  const start = sources({ "services/drive/coordinator.ts": { DriveCoordinator: Coordinator }, "services/drive/local.ts": {},
    "screens/terminal/controller-camera-sync.ts": { cameraPending: () => false, flushCamera: async () => {}, subscribeCamera: () => () => {} }
  })("screens/terminal/controller-drive.ts").startTerminalDrive;
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  globalThis.document = { visibilityState: "visible", addEventListener: (name, fn) => docListeners.set(name, fn), removeEventListener: name => docListeners.delete(name) };
  const state = { preferences: {}, rows: [], drawings: [], images: [] };
  let dispose;
  try {
    dispose = start({ getSnapshot: () => state, sessionKey: () => "fixture-session", subscribe: () => () => {} });
    assert.equal(resumes, 1); listeners.get("online")(); assert.equal(syncs, 1);
    dispose(); dispose = undefined; assert.equal(listeners.has("online"), false); assert.equal(suspends, 1);
  } finally {
    dispose?.(); if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

test("a failed persisted-credential deletion is visible after disconnect", async () => {
  const f = fixture(); await f.connect(); f.hooks.disconnect = () => { throw new Error("unit storage deletion failure"); };
  f.coordinator.disconnect(); await tick();
  assert.equal(f.coordinator.getSnapshot().connected, false);
  assert.equal(f.coordinator.getSnapshot().credentialSaveError, true);
});
