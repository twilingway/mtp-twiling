import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

function fixture() {
  const calls = [], patches = [];
  const fail = () => assert.fail("empty legacy inventory must not start account/proof/storage writes");
  const load = sourceLoader({
    "services/storage-db.ts": {},
    "services/drive/device-slot-http.ts": { DeviceSlotHttp: class {} },
    "services/drive/device-slot-store.ts": { DeviceSlotStore: class {} },
    "services/drive/device-slot-identity.ts": { loadDriveDeviceId: fail },
    "services/drive/write-capability-identity.ts": { capabilityAccountKey: fail },
    "services/drive/legacy-compaction-storage.ts": {
      hasPendingLegacyCompaction: async () => { calls.push("pending-read"); return false; }
    },
    "services/drive/legacy-raw-archive-io.ts": { LegacyCompactionHttp: class {
      async listLegacy() { calls.push("list-legacy"); return []; }
      async listRetention(kind) { calls.push(`list-${kind}`); return []; }
      readVerified = fail;
    } },
    "services/drive/device-slot-link.ts": {
      loadGoogleSlotTarget: async () => ({ enabled: true,
        record: { scope: { workspaceId: "workspace-1", legacyArchive: null }, mode: "normal" } }),
      matchesGoogleSlotCredential: () => true,
      googleSlotFence: () => ({ check: async () => {},
        guardFetch: (fetcher) => fetcher, effect: (action) => action() })
    }
  });
  const module = load("services/drive/legacy-compaction-google.ts");
  let current = true, finished = 0;
  const job = { authorization: {}, scope: {}, dependencies: { fetch: fail },
    signal: new AbortController().signal, current: () => current,
    reset: fail, update: (patch) => patches.push(patch), finish: () => { finished++; } };
  return { module, job, calls, patches, finished: () => finished, stale: () => { current = false; } };
}

test("empty cloud cleanup only lists and reads local pending metadata", async () => {
  const f = fixture();
  await f.module.compactGoogleLegacy(f.job);
  assert.deepEqual(f.calls, ["list-legacy", "pending-read"]);
  assert.deepEqual(f.patches, [{ compaction: { phase: "complete", fileCount: 0, bytes: 0,
    archivedFiles: 0, deletedFiles: 0, changedFiles: 0, pendingFiles: 0 } }]);
});

test("archive inspection reads small immutable records without raw download or writes", async () => {
  const f = fixture();
  await f.module.inspectGoogleLegacyArchives(f.job);
  assert.deepEqual(f.calls, ["list-compaction"]);
  assert.deepEqual(f.patches, [{ legacyArchives: [] }]);
});

test("cleanup failure releases own job and publishes a separate paused status", async () => {
  const f = fixture();
  const result = await f.module.runGoogleLegacyAction(() => f.job, async () => {
    throw new Error("network after successful sync");
  });
  assert.equal(result, undefined);
  assert.equal(f.finished(), 1);
  assert.deepEqual(f.patches, [{ compaction: { phase: "paused", error: "local-save" } }]);
  assert.ok(!f.patches.some((patch) => Object.hasOwn(patch, "phase")));
});

test("a stale account callback releases only its own job and never publishes paused state", async () => {
  const f = fixture();
  await f.module.runGoogleLegacyAction(() => f.job, async () => {
    f.stale(); throw new DOMException("account changed", "AbortError");
  });
  assert.equal(f.finished(), 1);
  assert.deepEqual(f.patches, []);
});

test("paused cleanup preserves the last confirmed counters", async () => {
  const f = fixture();
  f.job.status = () => ({ compaction: { phase: "delete", fileCount: 5, archivedFiles: 5,
    deletedFiles: 2, pendingFiles: 3 } });
  await f.module.runGoogleLegacyAction(() => f.job, async () => { throw new Error("paused"); });
  assert.equal(f.patches[0].compaction.deletedFiles, 2);
  assert.equal(f.patches[0].compaction.pendingFiles, 3);
});

test("readonly receive and migration preparation never schedule compaction; local send does", async () => {
  const load = sourceLoader({
    "services/drive/device-slot-inspection.ts": {
      receiveGoogleSlotSelection: () => async () => ({ state: "received" })
    },
    "services/drive/device-slot-sync.ts": { chooseDeviceSlotVersion: async () => ({ state: "idle" }) }
  });
  const { createGoogleSlotProviderActions } = load("services/drive/device-slot-provider-actions.ts");
  const calls = [], preview = {};
  const options = {
    previews: { comparison: preview },
    migration: { current: undefined, prepare: async () => { calls.push("prepare"); return new Blob(); } },
    fetcher: fetch, state: () => ({ enabled: true, migrationRequired: false }),
    authorization: () => ({}), run: async (operation) => { await operation({}, {}); return true; },
    inspect: async () => calls.push("inspect"), compact: async () => calls.push("compact"),
    update: () => {}, omit: () => {}
  };
  const actions = createGoogleSlotProviderActions(options);
  await actions.receive("remote-id");
  await actions.prepareLegacyArchive();
  assert.deepEqual(calls, []);
  await actions.choose({ kind: "local" });
  assert.deepEqual(calls, ["compact"]);
});

test("readonly maintenance and auto compaction schedule only a prior or newly deferred intent", async () => {
  const calls = [], queued = new Map();
  let sequence = 0, duringRead, duringSync;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const load = sourceLoader({
    "services/storage-db.ts": {},
    "services/drive/legacy-compaction-google.ts": {
      runGoogleLegacyAction: async (take, action) => {
        const job = take(); if (!job) return;
        try { return await action(job); } finally { job.finish(); }
      },
      compactGoogleLegacy: async () => { calls.push("compact"); },
      inspectGoogleLegacyArchives: async () => { calls.push("inspect"); await duringRead?.(); },
      downloadGoogleLegacyArchive: async () => new Blob(["raw"])
    },
    "services/drive/device-slot-operation.ts": {
      sameGoogleSlotScope: () => true,
      guardedGoogleCapability: () => () => {},
      runGoogleSlotJob: async (options) => {
        calls.push("sync");
        options.target(provider.target);
        options.outcome({ state: "idle", record: { baseHeads: [] } }, {}, false);
        duringSync?.();
        const { beginDriveProgress } = load("services/drive/progress.ts");
        options.finish(beginDriveProgress());
      }
    }
  });
  const { GoogleSlotProvider } = load("services/drive/device-slot-provider.ts");
  const scope = { ready: true, blocked: false, cloudOwner: "owner", session: {} };
  const provider = new GoogleSlotProvider({ scope: () => scope }, {
    online: () => true, fetch: async () => assert.fail("readonly maintenance cannot write"),
    auth: { suspend: () => {} }
  });
  provider.scope = scope;
  provider.target = { owner: "owner", record: {} };
  provider.authorization = { signal: new AbortController().signal };
  provider.state = { ...provider.state, enabled: true, automatic: true, phase: "idle" };
  globalThis.setTimeout = (callback) => { const id = ++sequence; queued.set(id, callback); return id; };
  globalThis.clearTimeout = (id) => { queued.delete(id); };
  try {
    await provider.inspectLegacyArchives();
    await provider.downloadLegacyRawArchive("id");
    assert.equal(queued.size, 0, "readonly jobs cannot create a sync timer");
    await provider.sync();
    assert.deepEqual(calls, ["inspect", "sync", "compact"]);
    assert.equal(queued.size, 0, "auto sync plus compaction terminates after one pass");
    duringSync = () => {
      provider.reset(true); provider.scope = scope;
      provider.authorization = { signal: new AbortController().signal };
      provider.target = { owner: "other-owner", record: {} };
      provider.state = { ...provider.state, enabled: true, automatic: true, phase: "idle" };
    };
    await provider.sync();
    assert.deepEqual(calls, ["inspect", "sync", "compact", "sync"],
      "an old successful sync cannot start compaction for a newly attached account");
    duringSync = undefined;
    provider.localChanged();
    assert.equal(queued.size, 1);
    await provider.inspectLegacyArchives();
    assert.equal(queued.size, 1, "a prior automatic intent survives readonly maintenance");
    queued.clear(); provider.timer = undefined;
    duringRead = () => provider.localChanged();
    await provider.inspectLegacyArchives();
    assert.equal(queued.size, 1, "a new local intent during maintenance is deferred");
  } finally {
    provider.dispose(); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
});

test("automatic delta cleanup preserves late physical files and publishes review without v3 adoption", async () => {
  const patches = [], writes = [], baseline = {
    fileId: "baseline", namespace: "mtp-drive-v2", kind: "snapshot", key: "baseline-node",
    version: "1", size: 10, appProperties: { mtpKey: "baseline-node" }
  };
  const late = { ...baseline, fileId: "late", key: "late-node", appProperties: { mtpKey: "late-node" } };
  const prior = { archive: { index: { files: [baseline] } },
    record: { archive: { fileId: "archive" }, createdAt: "date" }, recordReceipt: { fileId: "record" } };
  const load = sourceLoader({
    "services/storage-db.ts": {},
    "services/drive/device-slot-http.ts": { DeviceSlotHttp: class {} },
    "services/drive/device-slot-store.ts": { DeviceSlotStore: class {} },
    "services/drive/device-slot-identity.ts": { loadDriveDeviceId: async () => "client" },
    "services/drive/write-capability-identity.ts": { capabilityAccountKey: async () => "a".repeat(64) },
    "services/drive/legacy-compaction-storage.ts": { listPendingLegacyCompactions: async () => [] },
    "services/drive/legacy-compaction.ts": { LegacyCompaction: class {
      constructor() { writes.push("plan"); }
      async preview() { return {}; }
      async execute() { writes.push("archive-explicitly"); }
    } },
    "services/drive/legacy-raw-archive-io.ts": { LegacyCompactionHttp: class {
      async listLegacy() { return [late]; }
      readVerified() { assert.fail("unexpected direct archive read"); }
    } },
    "services/drive/legacy-compaction-discovery.ts": {
      discoverVerifiedLegacyArchives: async () => [prior],
      discoverVerifiedLegacyCompactionRecords: async () => [prior]
    },
    "services/drive/device-slot-link.ts": {
      loadGoogleSlotTarget: async () => ({ enabled: true,
        record: { scope: { workspaceId: "workspace", legacyArchive: null }, mode: "normal" } }),
      matchesGoogleSlotCredential: () => true,
      googleSlotFence: () => ({ check: async () => {}, guardFetch: (fetcher) => fetcher,
        effect: (action) => action() })
    },
    "services/drive/legacy-archive-overlay.ts": {
      createLegacyArchiveOverlay: async (_base, namespace) => ({
        listLateLegacySnapshots: async () => namespace === "mtp-drive-v2" ? [{ appProperties: { mtpKey: "late-node" } }] : []
      })
    },
    "services/drive/transport.ts": { DriveTransport: class {} },
    "services/drive/sync.ts": { DriveSync: class {
      async inspect() { return { heads: ["late-node"] }; }
      async validateHeads() {}
    } }
  });
  const { compactGoogleLegacy } = load("services/drive/legacy-compaction-google.ts");
  const job = { authorization: {}, scope: {}, dependencies: { fetch },
    signal: new AbortController().signal, current: () => true, reset: () => {},
    update: (patch) => patches.push(patch), finish: () => {} };
  await compactGoogleLegacy(job, false);
  assert.deepEqual(writes, []);
  assert.equal(patches.at(-2).compaction.phase, "paused");
  assert.equal(patches.at(-2).compaction.pendingFiles, 1);
  assert.deepEqual(patches.at(-1).legacyLateChanges[0].snapshotIds, ["late-node"]);
  await compactGoogleLegacy(job, true);
  assert.deepEqual(writes, ["plan", "archive-explicitly"]);
});
