import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { advanceDriveProgress, beginDriveProgress, finishDriveProgress } = load(
  "services/drive/progress.ts"
);
const { DriveSync } = load("services/drive/sync.ts");
const { DriveCoordinator } = load("services/drive/coordinator.ts");
const { synchronizeDrive } = load("services/drive/coordinator-sync-action.ts");
const { driveBackupDigest } = load("services/drive/backup.ts");
const namespace = "mtp-drive-v2";

function backup() {
  return {
    application: "personal-terminal",
    schemaVersion: 2,
    layout: { symbol: "SBER", timeframe: "1d" },
    watchlist: [{ uid: "test-uid", symbol: "SBER", name: "Test" }],
    drawings: [],
    views: [],
    images: [
      {
        id: "image",
        symbol: "SBER",
        type: "image/png",
        width: 100,
        point: { timestamp: 1700000000000, value: 5 },
        data: btoa("sample image")
      }
    ]
  };
}

function createStore() {
  const files = [];
  const contents = new Map();
  const uploaded = [];
  return {
    uploaded,
    list: async (kind) => files.filter((file) => file.appProperties.mtpKind === kind),
    read: async (file) => contents.get(file.id),
    async create(kind, key, hash, body) {
      const file = {
        id: crypto.randomUUID(),
        name: kind,
        size: body.size,
        version: "1",
        appProperties: {
          mtpNamespace: namespace,
          mtpKind: kind,
          mtpKey: key,
          mtpHash: hash
        }
      };
      uploaded.push(body.size);
      files.push(file);
      contents.set(file.id, body);
      return file;
    }
  };
}

test("same-stage file updates do not restart elapsed time, repeated checks get one duration", () => {
  const first = beginDriveProgress("read-versions", 100);
  const upload = advanceDriveProgress(first, "upload", undefined, 150);
  const one = advanceDriveProgress(
    upload,
    "upload",
    { transfer: { completedFiles: 1, totalFiles: 2, transferredBytes: 200 } },
    500
  );
  const check = advanceDriveProgress(one, "read-versions", undefined, 1000);
  assert.deepEqual(finishDriveProgress(check, 1125), {
    elapsedMs: 1025,
    stages: [
      { stage: "read-versions", elapsedMs: 175 },
      { stage: "upload", elapsedMs: 850 }
    ]
  });
});

test("Drive reports transferred bytes only after each real successful component", async () => {
  const store = createStore();
  const sync = new DriveSync(store);
  const reports = [];
  const report = (stage, details) => reports.push({ stage, amount: details?.transfer });
  const deviceId = crypto.randomUUID();
  const input = backup();
  const first = await sync.publish(input, { deviceId, parents: [] }, report);
  const sent = reports.filter((value) => value.stage === "upload" && value.amount);
  assert.deepEqual([...new Set(sent.map(({ amount }) => amount.completedFiles))], [0, 1, 2, 3]);
  assert.equal(sent.at(-1).amount.totalFiles, 3);
  assert.equal(
    sent.at(-1).amount.transferredBytes,
    store.uploaded.reduce((a, b) => a + b, 0)
  );

  reports.length = 0;
  const expected = store.uploaded[0] + store.uploaded[1];
  await sync.download(first.nodeId, first.inspection, report);
  const downloaded = reports.filter((value) => value.stage === "download");
  assert.deepEqual(
    downloaded.map(({ amount }) => amount.completedFiles),
    [0, 1, 2]
  );
  assert.equal(downloaded.at(-1).amount.transferredBytes, expected);

  reports.length = 0;
  store.uploaded.length = 0;
  await sync.publish(input, { deviceId, parents: [first.nodeId] }, report);
  const reused = reports.filter((value) => value.stage === "upload" && value.amount);
  assert.deepEqual(reused[1].amount, { completedFiles: 1, totalFiles: 3, transferredBytes: 0 });
  assert.equal(store.uploaded.length, 1);
  assert.equal(reused.at(-1).amount.transferredBytes, store.uploaded[0]);
});

test("empty head verification skips blob listing and still rejects a newly listed version", async () => {
  const store = createStore();
  const reader = new DriveSync(store);
  const writer = new DriveSync(store);
  const empty = await reader.inspect();
  const lists = [];
  const list = store.list;
  store.list = async (kind) => {
    lists.push(kind);
    return list(kind);
  };
  await reader.validateHeads(empty);
  assert.deepEqual(lists, ["snapshot"]);
  await writer.publish(backup(), { deviceId: crypto.randomUUID(), parents: [] });
  lists.length = 0;
  await assert.rejects(reader.validateHeads(empty), (error) => error.code === "conflict");
  assert.deepEqual(lists, ["snapshot"]);
});

test("a warm publish checks the pinned remote payload before writing any component", async () => {
  const store = createStore();
  const remote = new DriveSync(store);
  const initial = backup();
  const deviceId = crypto.randomUUID();
  const first = await remote.publish(initial, { deviceId, parents: [] });
  const payloadHash = first.inspection.snapshots[0].manifest.payload.sha256;
  const originalRead = store.read;
  store.read = (file) =>
    file.appProperties.mtpHash === payloadHash
      ? Promise.resolve(new Blob([new Uint8Array(file.size)]))
      : originalRead(file);
  const next = { ...initial, layout: { ...initial.layout, timeframe: "4h" } };
  store.uploaded.length = 0;
  let checking = false;
  const validate = remote.validateHeads.bind(remote);
  remote.validateHeads = async (inspection) => {
    checking = true;
    return validate(inspection);
  };
  await assert.rejects(
    synchronizeDrive({
      exportBackup: async () => next,
      remote,
      record: {
        deviceId,
        baseHeads: [first.nodeId],
        lastSyncedDigest: await driveBackupDigest(initial)
      },
      report: () => {},
      check: () => {},
      checkSession: () => {},
      detectLegacy: async () => false,
      conflict: () => assert.fail("unchanged heads cannot need a conflict choice"),
      apply: () => assert.fail("must not apply invalid records"),
      accept: () => assert.fail("must not acknowledge invalid records")
    }),
    (error) => error.code === "remote-invalid"
  );
  assert.equal(checking, true);
  assert.deepEqual(store.uploaded, []);
});

test("publish rechecks the local revision after remote preflight", async () => {
  const store = createStore();
  const remote = new DriveSync(store);
  const previous = await remote.publish(backup(), { deviceId: crypto.randomUUID(), parents: [] });
  store.uploaded.length = 0;
  const check = new DOMException("Local revision changed", "AbortError");
  let preflight = false;
  const before = remote.validateHeads.bind(remote);
  remote.validateHeads = async (inspection) => {
    await before(inspection);
    preflight = true;
  };
  await assert.rejects(
    remote.publish(backup(), {
      deviceId: crypto.randomUUID(),
      parents: [previous.nodeId],
      expectedInspection: previous.inspection,
      checkBeforeWrite: () => {
        assert.equal(preflight, true);
        throw check;
      }
    }),
    (error) => error === check
  );
  assert.deepEqual(store.uploaded, []);
});

test("coordinator presents running stage and retains timings after success", async () => {
  const store = createStore();
  const abort = new AbortController();
  const originalList = store.list;
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  let listStarted;
  const entered = new Promise((resolve) => (listStarted = resolve));
  store.list = async (kind) => {
    listStarted();
    await pending;
    return originalList(kind);
  };
  const profile = { owner: "test", session: {}, authenticated: true, blocked: false };
  const drive = new DriveCoordinator(
    { profile: () => profile, exportBackup: async () => backup(), importBackup: async () => {} },
    {
      auth: {
        prepare: async () => {},
        restore: async () => undefined,
        connectFromUserGesture: async () => ({
          signal: abort.signal,
          getAccessToken: () => "test",
          invalidate: () => abort.abort()
        }),
        disconnect: async () => {},
        suspend: () => {}
      },
      load: async () => ({ deviceId: crypto.randomUUID(), baseHeads: [], automatic: false }),
      save: async () => {},
      sync: () => new DriveSync(store)
    }
  );
  await drive.prepare();
  const sync = drive.connect();
  await entered;
  assert.equal(drive.getSnapshot().progress.stage, "read-versions");
  release();
  await sync;
  const final = drive.getSnapshot();
  assert.equal(final.phase, "idle");
  assert.equal(final.progress, undefined);
  assert.ok(final.lastOperation.elapsedMs >= 0);
  assert.ok(final.lastOperation.stages.some(({ stage }) => stage === "upload"));
  assert.ok(final.lastOperation.stages.some(({ stage }) => stage === "confirm"));
  drive.suspend();
  assert.equal(drive.getSnapshot().lastOperation, undefined);
});
