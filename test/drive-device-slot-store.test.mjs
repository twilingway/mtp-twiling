import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader({
  "services/drive/device-slot-identity.ts": { loadDriveDeviceId: async () => deviceId }
});
const { DeviceSlotStore, replacePackedDeviceSlot } = load("services/drive/device-slot-store.ts");
const { prepareDriveBackup, driveBackupDigest } = load("services/drive/backup.ts");
const { synchronizeDeviceSlots, chooseDeviceSlotVersion } = load(
  "services/drive/device-slot-sync.ts"
);
const { prepareDeviceSlotVersion, restoreDeviceSlotVersion, encodeDeviceSlotPackage } = load(
  "services/drive/device-slot-package.ts"
);
const { planDeviceSlotWrite } = load("services/drive/device-slot-model.ts");
const { runDriveSlotBinaryProbe, verifiedDeviceSlotUploadBytes } = load(
  "services/drive/device-slot-binary-probe.ts"
);
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: uid(50), legacyArchive: null };
const signal = new AbortController().signal;
const deviceId = uid(1);
const backup = (symbol) => ({
  application: "personal-terminal",
  schemaVersion: 2,
  layout: { symbol },
  drawings: [],
  images: [],
  watchlist: [],
  views: []
});
const version = async (symbol) =>
  prepareDeviceSlotVersion(await prepareDriveBackup(backup(symbol)));
const previousSymbol = async (store, snapshot) =>
  (
    await restoreDeviceSlotVersion(
      await store.download(snapshot, snapshot.files[0].envelope.previous.revisionId, signal)
    )
  ).layout.symbol;
const plan = (snapshot, current, id) =>
  planDeviceSlotWrite(snapshot, {
    mode: "publish",
    deviceId,
    revisionId: uid(id),
    payload: current.reference,
    expected: snapshot.checkpoint.observed[0] ?? null,
    basedOn: snapshot.heads
  });

const quiet = async () => {};
const deviceB = uid(2);
async function peerPublish(store, snapshot, symbol, id, owner) {
  const bytes = await version(symbol);
  const planned = planDeviceSlotWrite(snapshot, {
    mode: "publish",
    deviceId: owner,
    revisionId: uid(id),
    payload: bytes.reference,
    expected: snapshot.checkpoint.observed.find(({ deviceId }) => deviceId === owner) ?? null,
    basedOn: snapshot.heads
  });
  return store.write(snapshot, planned, bytes, quiet, signal);
}

async function syncHarness(store, snapshot, localSymbol, acceptedSymbol = localSymbol) {
  let record = {
    scope,
    checkpoint: snapshot?.checkpoint,
    baseHeads: snapshot?.heads.map(({ revisionId }) => revisionId) ?? [],
    digest: await driveBackupDigest(backup(acceptedSymbol)),
    mode: "normal",
    automatic: false,
    generation: 0
  };
  const captureOf = async (symbol, revision) => {
    const input = backup(symbol);
    return {
      backup: input,
      prepared: await prepareDriveBackup(input),
      digest: await driveBackupDigest(input),
      revision
    };
  };
  let applies = 0;
  const accepted = [];
  const context = {
    signal,
    store,
    capture: await captureOf(localSymbol, 7),
    report() {},
    check() {},
    checkIdentity() {},
    legacyAvailable: async () => false,
    noteApplyRevision(revision) {
      accepted.push(revision);
    },
    async apply(input, expectedRevision, onCommitted) {
      assert.equal(expectedRevision, context.capture.revision);
      applies++;
      context.capture = await captureOf(input.layout.symbol, 42);
      onCommitted(42);
    },
    async save(prior, patch) {
      assert.equal(prior.generation, record.generation);
      record = { ...record, ...patch, generation: record.generation + 1 };
      return record;
    }
  };
  return { context, record: () => record, applies: () => applies, accepted };
}

function transport() {
  const files = new Map();
  let count = 0;
  let reads = 0;
  let patches = 0;
  let lost = false;
  const io = {
    async list() {
      return Array.from(files, ([id, { key, body }]) => ({ id, key, size: body.size }));
    },
    async reserve() {
      return `synthetic-${++count}`;
    },
    async read(id, _signal, prefix) {
      ++reads;
      const { seq, body } = files.get(id);
      return {
        body: prefix ? body.slice(0, Math.min(body.size, 256 * 1024 + 12)) : body,
        etag: `"v${seq}"`
      };
    },
    async create(id, key, body) {
      assert.ok(!files.has(id));
      files.set(id, { key, body, seq: 1 });
    },
    async patch(id, etag, body) {
      ++patches;
      const file = files.get(id);
      if (etag !== `"v${file.seq}"`) return new Response(null, { status: 412 });
      files.set(id, { key: file.key, body, seq: file.seq + 1 });
      if (lost) throw new TypeError("Transport response unavailable");
      return new Response(null, { status: 204 });
    }
  };
  return {
    io,
    files,
    lost: () => {
      lost = true;
    },
    reads: () => reads,
    patches: () => patches
  };
}

test("one physical file retains the two latest complete versions, including a lost PATCH response", async () => {
  const mock = transport();
  const store = new DeviceSlotStore(mock.io, () => 1 << 20);
  let captured;
  const journal = async (write) => {
    captured = write;
  };
  const empty = await store.inspect(scope, undefined, signal);
  const a = await version("SBER");
  const first = await store.write(empty, plan(empty, a, 101), a, journal, signal);
  const physicalId = first.files[0].fileId;
  assert.equal(captured.baseEtag, null);
  assert.equal(await store.reconcile(captured, signal), "committed");
  const b = await version("GAZP");
  mock.lost();
  const second = await store.write(first, plan(first, b, 102), b, journal, signal);
  assert.equal(captured.baseEtag, '"v1"');
  const secondJournal = captured;
  assert.equal(await previousSymbol(store, second), "SBER");
  const c = await version("T");
  const third = await store.write(second, plan(second, c, 103), c, journal, signal);
  assert.equal(await previousSymbol(store, third), "GAZP");
  assert.equal(await store.reconcile(secondJournal, signal), "committed");
  assert.equal(third.files[0].fileId, physicalId);
  assert.equal(mock.files.size, 1);
  assert.equal(mock.patches(), 2);
  await assert.rejects(store.download(third, uid(101), signal), { code: "remote-invalid" });
});

test("an unproved writer cannot create or journal a slot, and duplicate locators block before download", async () => {
  const mock = transport();
  const guarded = new DeviceSlotStore(mock.io);
  const empty = await guarded.inspect(scope, undefined, signal);
  const current = await version("SBER");
  await assert.rejects(
    guarded.write(empty, plan(empty, current, 100), current, () => assert.fail(), signal),
    { issue: "probe" }
  );
  assert.equal(mock.files.size, 0);
  const candidate = plan(empty, current, 100);
  const bytes = encodeDeviceSlotPackage(candidate.envelope, current, null);
  await mock.io.create("one", candidate.key, bytes);
  await mock.io.create("two", candidate.key, bytes);
  await assert.rejects(guarded.inspect(undefined, undefined, signal), { code: "conflict" });
  assert.equal(mock.reads(), 0);
});

test("same-base competitor returns a raw 412 and cannot publish", async () => {
  const mock = transport();
  const store = new DeviceSlotStore(mock.io, () => 1 << 20);
  const empty = await store.inspect(scope, undefined, signal);
  const firstVersion = await version("SBER");
  const first = await store.write(
    empty,
    plan(empty, firstVersion, 73),
    firstVersion,
    async () => {},
    signal
  );
  const next = await version("NVTK");
  const rival = await version("VTBR");
  const fileId = first.files[0].fileId;
  const upload = (record, id) => {
    const { key, envelope } = plan(first, record, id);
    return replacePackedDeviceSlot(
      mock.io,
      { key, envelope, fileId, baseEtag: '"v1"' },
      encodeDeviceSlotPackage(envelope, record, firstVersion),
      signal
    );
  };
  const outcomes = await Promise.all([upload(next, 74), upload(rival, 75)]);
  assert.equal(outcomes.filter((item) => item === 412).length, 1);
  assert.equal(outcomes.find((item) => item !== 412).package.envelope.current.seq, 2);
});

for (const caseName of ["parallel", "descendant"]) {
  test(`peer ${caseName} after own publication stays explicit and preserves only the own acknowledgement`, async () => {
    const mock = transport();
    const store = new DeviceSlotStore(mock.io, () => 1 << 20);
    const empty = await store.inspect(scope, undefined, signal);
    const a = await peerPublish(store, empty, "SBER", 150, deviceId);
    const ownedId = a.files[0].fileId;
    const b = await peerPublish(store, a, "GAZP", 151, deviceB);
    const h = await syncHarness(store, b, "VTBR", "GAZP");
    const patch = mock.io.patch;
    let peerWrote = false;
    mock.io.patch = async (id, tag, body) => {
      if (id !== ownedId || peerWrote) return patch(id, tag, body);
      peerWrote = true;
      if (caseName === "parallel") {
        await peerPublish(store, b, "NVTK", 152, deviceB);
        return patch(id, tag, body);
      }
      const result = await patch(id, tag, body);
      const fresh = await store.inspect(scope, b.checkpoint, signal);
      await peerPublish(store, fresh, "NVTK", 152, deviceB);
      return result;
    };
    const result = await synchronizeDeviceSlots(h.context, h.record());
    assert.equal(result.state, "choice");
    assert.equal(result.preview.snapshot.heads.length, caseName === "parallel" ? 2 : 1);
    assert.ok(result.preview.conflict.remotes.some(({ nodeId }) => nodeId === uid(152)));
    assert.equal(result.record.baseHeads.length, 1);
    assert.notEqual(result.record.baseHeads[0], uid(152));
    assert.equal(h.applies(), 0);
    if (caseName === "descendant") {
      const after = await synchronizeDeviceSlots(h.context, h.record());
      assert.equal(after.state, "idle");
      assert.equal(h.context.capture.backup.layout.symbol, "NVTK");
      assert.equal(h.applies(), 1);
    }
  });
}

test("explicit choice verifies a preview through a fresh store and commits only once", async () => {
  const mock = transport();
  const store = new DeviceSlotStore(mock.io, () => 1 << 20);
  const empty = await store.inspect(scope, undefined, signal);
  await peerPublish(store, empty, "NVTK", 160, deviceB);
  const h = await syncHarness(store, undefined, "SBER");
  h.record().scope = undefined;
  const result = await synchronizeDeviceSlots(h.context, h.record());
  assert.equal(result.state, "choice");
  h.context.store = new DeviceSlotStore(mock.io, () => 1 << 20);
  const chosen = await chooseDeviceSlotVersion(h.context, h.record(), result.preview, {
    kind: "remote",
    id: uid(160)
  });
  assert.equal(chosen.state, "idle");
  assert.equal(h.context.capture.backup.layout.symbol, "NVTK");
  assert.deepEqual(h.accepted, [42]);
});

test("a durable native commit followed by UI restore failure does not reimport on retry", async () => {
  const mock = transport();
  const store = new DeviceSlotStore(mock.io, () => 1 << 20);
  const empty = await store.inspect(scope, undefined, signal);
  const first = await peerPublish(store, empty, "SBER", 170, deviceB);
  const h = await syncHarness(store, first, "SBER");
  await peerPublish(store, first, "NVTK", 171, deviceB);
  const apply = h.context.apply;
  h.context.apply = async (...args) => {
    await apply(...args);
    throw new Error("UI restore failure after native commit");
  };
  await assert.rejects(synchronizeDeviceSlots(h.context, h.record()), /UI restore failure/);
  assert.deepEqual(h.record().baseHeads, [uid(171)]);
  assert.deepEqual(h.accepted, [42]);
  assert.equal(h.context.capture.backup.layout.symbol, "NVTK");
  assert.equal((await synchronizeDeviceSlots(h.context, h.record())).state, "idle");
  assert.equal(h.applies(), 1);
});

test("binary browser probe uses identical upload media framing and enables only measured size after a 412", async () => {
  const id = "synthetic-probe";
  let media;
  let seq = 1;
  let conditionalWrites = 0;
  const authorization = {
    signal,
    getAccessToken: () => "synthetic-token",
    invalidate: () => assert.fail()
  };
  const fetcher = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    const etag = () => `"sequence-${seq}"`;
    if (url.pathname.endsWith("/generateIds")) return Response.json({ ids: [id] });
    if (init.method === "POST") {
      const type = headers.get("Content-Type");
      const multipart = Buffer.from(await init.body.arrayBuffer());
      const name = type.match(/boundary=([^;]+)$/)[1];
      const separator = Buffer.from(`\r\n--${name}\r\n`);
      const afterMetadata = multipart.indexOf(separator);
      const data = multipart.indexOf(Buffer.from("\r\n\r\n"), afterMetadata + separator.length) + 4;
      const close = multipart.lastIndexOf(Buffer.from(`\r\n--${name}--`));
      const metadata = JSON.parse(
        multipart.subarray(multipart.indexOf("\r\n\r\n") + 4, afterMetadata).toString()
      );
      assert.equal(metadata.appProperties.mtpNamespace, "mtp-drive-cas-probe");
      assert.deepEqual(metadata.parents, ["appDataFolder"]);
      media = new Blob([multipart.subarray(data, close)]);
      return Response.json({ ...metadata, id, size: String(media.size) });
    }
    if (init.method === "PATCH") {
      assert.equal(headers.get("Content-Type"), "application/octet-stream");
      conditionalWrites++;
      if (headers.get("If-Match") !== etag()) return new Response(null, { status: 412 });
      media = init.body;
      seq++;
      return new Response(null, { status: 204 });
    }
    assert.equal(url.searchParams.get("alt"), "media");
    return new Response(media, { headers: { "Content-Length": String(media.size), ETag: etag() } });
  };
  assert.equal(verifiedDeviceSlotUploadBytes(authorization), 0);
  const result = await runDriveSlotBinaryProbe(authorization, fetcher, signal, 32);
  assert.equal(conditionalWrites, 2);
  assert.equal(result.loserStatus, 412);
  assert.equal(verifiedDeviceSlotUploadBytes(authorization), result.maxBytes);
  assert.equal(verifiedDeviceSlotUploadBytes({ ...authorization }), 0);
});
