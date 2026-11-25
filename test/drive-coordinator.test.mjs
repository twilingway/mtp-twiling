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
  async list(kind) { return this.files.filter(file => file.appProperties.mtpKind === kind).map(file => structuredClone(file)); }
  async read(file, max) { await this.hooks.read?.(file); const body = this.bodies.get(file.id); assert.ok(body.size <= max); return body; }
  async create(kind, key, hash, body) {
    const file = { id: crypto.randomUUID(), name: kind, size: body.size, appProperties: { mtpNamespace: "mtp-drive-v1", mtpKind: kind, mtpKey: key, mtpHash: hash } };
    this.files.push(file); this.bodies.set(file.id, body); return structuredClone(file);
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
function fixture(store = new Store()) {
  let local = backup(), profile = { owner: "A", session: {}, authenticated: true, blocked: false }, authorization, record = { schemaVersion: 1, deviceId: crypto.randomUUID(), markerId: crypto.randomUUID(), baseHeads: [], automatic: true }, disconnects = 0;
  const hooks = {}, imports = [], writes = [], events = [];
  const auth = { async prepare() { events.push("prepare"); }, connectFromUserGesture() {
    events.push("click"); const abort = new AbortController();
    authorization = { connectionId: crypto.randomUUID(), signal: abort.signal, getAccessToken: () => "fake-token", invalidate: () => abort.abort() };
    return Promise.resolve(authorization);
  }, async disconnect() { disconnects++; authorization?.invalidate(); } };
  const bridge = { profile: () => profile, async exportBackup() { await hooks.export?.(); return structuredClone(local); }, async importBackup(incoming, options) {
    assert.equal(options.replacePortable, true); await hooks.beforeCommit?.();
    if (!options.valid()) throw new DOMException("changed", "AbortError");
    local = structuredClone(incoming); imports.push(local); options.onCommitted();
    coordinator.localChanged(); // Own profile restoration must not create an echo.
    local.layout.rangeDays ??= 365; // prepareProfile fills defaults.
    await hooks.postcommit?.();
  } };
  const coordinator = new DriveCoordinator(bridge, { auth, sync: () => new DriveSync(store), load: async () => structuredClone(record), save: async (owner, value) => { writes.push({ owner, value: structuredClone(value) }); record = structuredClone(value); } });
  coordinator.profileChanged();
  return { coordinator, store, hooks, imports, writes, events, local: () => local, record: () => record, authorization: () => authorization, disconnects: () => disconnects,
    edit(patch) { local = { ...local, ...patch }; coordinator.localChanged(); },
    changeProfile(patch) { profile = { ...profile, ...patch }; coordinator.profileChanged(); },
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
  f.edit({ layout: { ...f.local().layout, locale: "ru" } }); f.edit({ layout: { ...f.local().layout, timeZone: "Europe/Moscow" } });
  await new Promise(resolve => setTimeout(resolve, 1700));
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
