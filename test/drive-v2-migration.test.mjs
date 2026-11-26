import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
const load = sourceLoader();
const { LegacyDriveMigration } = load("services/drive/legacy.ts");
function fixture() {
  const legacyHead = crypto.randomUUID(),
    state = {
      revision: 0,
      epoch: 1,
      busy: false,
      imports: [],
      dirty: 0,
      applying: null,
      status: {}
    };
  let modernHeads = [],
    legacyHeads = [legacyHead];
  const authorization = {
    connectionId: crypto.randomUUID(),
    signal: new AbortController().signal,
    getAccessToken: () => "fake",
    invalidate() {}
  };
  const remote = { inspect: async () => ({ heads: modernHeads, snapshots: [], conflict: false }) };
  const incoming = {
    application: "personal-terminal",
    schemaVersion: 1,
    drawings: [],
    images: [],
    layout: { symbol: "SBER" },
    watchlist: [],
    views: []
  };
  const bridge = {
    profile: () => ({ owner: "A", session: "same", authenticated: true, blocked: false }),
    exportBackup: async () => incoming,
    importBackup: async (backup, options) => {
      assert.equal(options.valid(), true);
      state.imports.push({ backup, options });
    }
  };
  const reader = {
    inspect: async () => ({ heads: legacyHeads, snapshots: [], conflict: false }),
    download: async () => incoming
  };
  const migration = new LegacyDriveMigration(bridge, {
    capture: () => ({ epoch: state.epoch, revision: state.revision, authorization, remote }),
    valid: (context) => context.epoch === state.epoch && context.revision === state.revision,
    reader: () => reader,
    busy: () => state.busy,
    setBusy: (value) => (state.busy = value),
    reporter: () => () => {},
    applying: (value) => (state.applying = value),
    update: (patch) => Object.assign(state.status, patch),
    dirty: () => state.dirty++
  });
  return {
    migration,
    state,
    legacyHead,
    modern: (heads) => (modernHeads = heads),
    legacy: (heads) => (legacyHeads = heads)
  };
}
test("legacy cloud is only offered when v2 empty; detection never overwrites local data", async () => {
  const f = fixture();
  assert.equal(await f.migration.detect({ heads: [], snapshots: [], conflict: false }), true);
  assert.equal(f.state.status.legacyAvailable, true);
  assert.equal(f.state.imports.length, 0);
  assert.equal(f.state.dirty, 0);
  assert.equal(
    await f.migration.detect({ heads: [crypto.randomUUID()], snapshots: [], conflict: false }),
    false
  );
  const choices = await f.migration.inspect();
  assert.equal(choices[0].nodeId, f.legacyHead);
  assert.equal(f.state.imports.length, 0);
  await f.migration.choose("local");
  assert.equal(f.state.imports.length, 0);
  assert.equal(f.state.dirty, 1);
  assert.equal(f.state.status.legacyAvailable, false);
});
test("explicit legacy choice performs one guarded full import and marks only v2 dirty", async () => {
  const f = fixture();
  await f.migration.inspect();
  await f.migration.choose(f.legacyHead);
  assert.equal(f.state.imports.length, 1);
  assert.equal(f.state.imports[0].backup.schemaVersion, 2);
  assert.equal(f.state.imports[0].options.replacePortable, true);
  assert.equal(f.state.dirty, 1);
  assert.equal(f.state.applying, null);
  assert.equal(f.state.busy, false);
});
for (const change of ["local", "owner", "v2 appeared", "legacy changed"])
  test(`legacy preview rejects stale ${change} without importing`, async () => {
    const f = fixture();
    await f.migration.inspect();
    if (change === "local") f.state.revision++;
    if (change === "owner") f.state.epoch++;
    if (change === "v2 appeared") f.modern([crypto.randomUUID()]);
    if (change === "legacy changed") f.legacy([crypto.randomUUID()]);
    await assert.rejects(f.migration.choose(f.legacyHead));
    assert.equal(f.state.imports.length, 0);
    assert.equal(f.state.dirty, 0);
  });
test("legacy transport and sync reject writes before any network or store mutation", async () => {
  const { DriveTransport } = load("services/drive/transport.ts"),
    { DriveSync } = load("services/drive/sync.ts");
  const auth = {
    connectionId: crypto.randomUUID(),
    signal: new AbortController().signal,
    getAccessToken: () => "fake",
    invalidate() {}
  };
  const transport = new DriveTransport(auth, {
    namespace: "mtp-drive-v1",
    fetch: () => assert.fail("network write")
  });
  await assert.rejects(
    transport.create("blob", "x", "0".repeat(64), new Blob()),
    (error) => error.code === "permission"
  );
  const sync = new DriveSync(
    {
      list: () => assert.fail("list during write"),
      read: () => assert.fail("read during write"),
      create: () => assert.fail("legacy create")
    },
    "mtp-drive-v1"
  );
  await assert.rejects(sync.publish({}, { parents: [] }), (error) => error.code === "permission");
  await assert.rejects(sync.resolve({}, { parents: [] }), (error) => error.code === "permission");
});
test("Drive v2 allowlist preserves provider identity, strips local owner/history, leaves auth constants unchanged", () => {
  const { sanitizeDriveBackup } = load("services/drive/backup.ts"),
    constants = load("services/drive/types.ts");
  const id = "bybit:linear:BTCUSDT",
    ref = { provider: "bybit", category: "linear", symbol: "BTCUSDT" };
  const clean = sanitizeDriveBackup({
    application: "personal-terminal",
    schemaVersion: 2,
    drawings: [],
    images: [],
    views: [],
    history: [],
    layout: {
      symbol: id,
      instrumentUid: id,
      providerRef: ref,
      watchlistFlags: { [`uid:${id}`]: "red" }
    },
    watchlist: [
      {
        uid: id,
        symbol: id,
        ticker: "BTCUSDT",
        name: "Bitcoin",
        providerRef: ref,
        nativePriceStep: 1e-12,
        assetClass: "crypto",
        productKind: "perpetual",
        owner: "secret-local-owner"
      }
    ]
  });
  assert.deepEqual(clean.watchlist[0].providerRef, ref);
  assert.equal(clean.watchlist[0].nativePriceStep, 1e-12);
  assert.equal(clean.layout.providerRef.category, "linear");
  assert.equal(clean.watchlist[0].owner, undefined);
  assert.equal(clean.history, undefined);
  assert.equal(constants.DRIVE_NAMESPACE, "mtp-drive-v2");
  assert.equal(constants.DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.appdata");
  assert.equal(
    constants.DRIVE_CLIENT_ID,
    "570894753392-14e7houtg7kc4cdeq6ndpjo7e7sbvnc1.apps.googleusercontent.com"
  );
});
