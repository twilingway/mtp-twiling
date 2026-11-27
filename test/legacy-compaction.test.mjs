import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { LegacyCompaction } = load("services/drive/legacy-compaction.ts");
const { decodeRawArchive } = load("services/drive/legacy-raw-archive-codec.ts");
const { DRIVE_CLIENT_ID, DriveError } = load("services/drive/types.ts");
const { discoverVerifiedLegacyCompactionRecords, loadVerifiedLegacyArchive,
  discoverVerifiedLegacyArchives, parseLegacyCompactionRecord } = load(
  "services/drive/legacy-compaction-discovery.ts"
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const signal = () => new AbortController().signal;
const metadata = { operationId: "operation-1", workspaceId: "workspace-1",
  publicClientId: "client-1", createdAt: "2026-11-27T12:00:00.000Z" };

function fixture() {
  const state = { objects: new Map(), remote: new Map(), journal: new Map(), events: [],
    identity: true, fault: undefined, changed: new Set(), unknown: new Set(), reservations: 0,
    v3: { fileId: "v3-file", revisionId: "revision-1", envelopeHash: hash("v3") } };
  for (const [id, namespace, kind] of [
    ["v1-snapshot", "mtp-drive-v1", "snapshot"],
    ["v1-orphan", "mtp-drive-v1", "blob"],
    ["v2-duplicate", "mtp-drive-v2", "blob"],
    ["v2-snapshot", "mtp-drive-v2", "snapshot"]
  ]) {
    const bytes = Buffer.from(kind === "blob" ? "orphan duplicate bytes" : id);
    state.objects.set(id, { body: new Blob([bytes]), file: { fileId: id, namespace, kind,
      key: id, version: "1", etag: '"original"', size: bytes.length, sha256: hash(bytes),
      appProperties: { mtpNamespace: namespace, mtpKind: kind, mtpKey: id } } });
  }
  const check = () => {
    if (!state.identity) throw new DOMException("stale account", "AbortError");
  };
  const candidate = ({ etag, sha256, ...file }) => file;
  const remote = {
    async listLegacy() { check(); return [...state.objects.values()].map(({ file }) => candidate(file)); },
    async captureRaw(input) {
      check(); const value = state.objects.get(input.fileId);
      if (!value) throw new DriveError("conflict", "missing");
      return value;
    },
    async createImmutable(kind, body, meta, reserve) {
      check(); const fileId = meta.reservedFileId ?? `retention-${++state.reservations}`;
      await reserve(fileId); check();
      state.events.push(`reserve-committed:${kind}:${fileId}`);
      if (state.fault === `before-${kind}`) throw new Error(state.fault);
      assert.ok([...state.journal.values()].some((entry) =>
        entry.archive?.fileId === fileId || entry.record?.fileId === fileId));
      state.remote.set(fileId, body);
      if (state.fault === `after-${kind}`) throw new Error(state.fault);
      return { fileId, size: body.size, sha256: hash(Buffer.from(await body.arrayBuffer())) };
    },
    async readVerified(ref) {
      check(); const body = state.remote.get(ref.fileId);
      if (!body) throw new DriveError("remote-invalid", "missing", 404);
      if (state.fault === "archive-readback" && ref.indexDigest) throw new Error("readback");
      assert.equal(body.size, ref.size);
      assert.equal(hash(Buffer.from(await body.arrayBuffer())), ref.sha256);
      return body;
    },
    async runDeleteProbe() { check(); state.events.push("probe"); return {}; },
    async deletePinned(file) {
      check(); state.events.push(`delete:${file.fileId}`);
      if (state.fault === "abort-after-first-delete") {
        state.fault = undefined; state.objects.delete(file.fileId); state.identity = false;
        throw new DOMException("changed account", "AbortError");
      }
      if (state.changed.has(file.fileId)) return "changed";
      if (state.unknown.has(file.fileId)) return "unknown";
      state.objects.delete(file.fileId); return "deleted";
    }
  };
  const binding = { accountKey: hash("account-1"), clientId: DRIVE_CLIENT_ID,
    workspaceId: metadata.workspaceId, publicClientId: metadata.publicClientId };
  const gate = { binding,
    async checkIdentity() { check(); },
    async verifyCurrentV3(expected) {
      check(); if (state.fault === "v3") throw new Error("v3");
      if (expected) assert.deepEqual(expected, state.v3);
      return structuredClone(state.v3);
    },
    async assertArchiveReaderReady(archive, record) {
      if (state.fault === "reader") throw new Error("reader");
      assert.equal(archive.inventoryDigest, record.inventoryDigest);
      state.events.push("reader-ready");
    }
  };
  const journal = {
    async read(id) { return structuredClone(state.journal.get(id)); },
    async save(entry) {
      check(); if (state.fault === "journal") throw new Error("journal");
      state.journal.set(entry.metadata.operationId, structuredClone(entry));
    }
  };
  return { state, remote, gate, journal,
    service: () => new LegacyCompaction(remote, gate, journal) };
}

test("full physical coverage includes both namespaces, orphan and duplicate bytes", async () => {
  const f = fixture(), service = f.service(), input = await service.preview(metadata, signal());
  assert.equal(input.fileCount, 4);
  const late = f.state.objects.get("v1-snapshot");
  f.state.objects.set("late-file", { ...late, file: { ...late.file, fileId: "late-file" } });
  const result = await service.execute(input, signal());
  assert.equal(result.deletedFiles, 4);
  assert.equal(result.pendingFiles, 0);
  assert.deepEqual([...f.state.objects.keys()], ["late-file"]);
  const entry = f.state.journal.get(metadata.operationId);
  const archive = await decodeRawArchive(f.state.remote.get(entry.archive.fileId));
  assert.equal(archive.objects.length, 4);
  assert.ok(archive.objects.some(({ file }) => file.fileId === "v1-orphan"));
  assert.ok(f.state.events.indexOf("reader-ready") < f.state.events.indexOf("probe"));
  const deletes = f.state.events.filter((event) => event.startsWith("delete:"));
  assert.deepEqual(deletes.slice(0, 2), ["delete:v1-snapshot", "delete:v2-snapshot"]);
});

test("preview reports checked captures from zero through the complete stable inventory", async () => {
  const f = fixture(), progress = [];
  const preview = await f.service().preview(metadata, signal(), (value) => progress.push(value));
  assert.deepEqual(progress, [0, 1, 2, 3, 4].map((checkedFiles) => ({ checkedFiles, totalFiles: 4 })));
  assert.equal(preview.fileCount, 4);
  assert.ok(progress.every((value) => !Object.hasOwn(value, "archivedFiles")));
  assert.equal(f.state.remote.size, 0);
  assert.equal(f.state.journal.size, 0);
  assert.ok(!f.state.events.some((event) => event.startsWith("delete:")));
});

for (const failure of ["changed-version", "changed-identity"]) {
  test(`preview never advances checked captures after ${failure}`, async () => {
    const f = fixture(), progress = [], capture = f.remote.captureRaw;
    let captured = 0;
    f.remote.captureRaw = async (...args) => {
      const object = await capture(...args);
      if (++captured !== 2) return object;
      if (failure === "changed-identity") {
        f.state.identity = false;
        return object;
      }
      return { ...object, file: { ...object.file, version: "2" } };
    };
    await assert.rejects(f.service().preview(metadata, signal(), (value) => progress.push(value)));
    assert.deepEqual(progress, [{ checkedFiles: 0, totalFiles: 4 }, { checkedFiles: 1, totalFiles: 4 }]);
    assert.ok(progress.every((value) => !Object.hasOwn(value, "archivedFiles")));
    assert.equal(f.state.remote.size, 0);
    assert.equal(f.state.journal.size, 0);
    assert.ok(!f.state.events.some((event) => event.startsWith("delete:")));
  });
}

for (const fault of ["journal", "before-rawarchive", "after-rawarchive", "archive-readback",
  "v3", "before-compaction", "after-compaction", "reader"]) {
  test(`failure at ${fault} never deletes user files`, async () => {
    const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
    f.state.fault = fault;
    await assert.rejects(service.execute(preview, signal()));
    assert.equal(f.state.objects.size, 4);
    assert.equal(f.state.events.filter((event) => event.startsWith("delete:")).length, 0);
  });
}

for (const fault of ["before-rawarchive", "after-rawarchive", "before-compaction", "after-compaction"]) {
  test(`resume reuses reserved IDs after ${fault}`, async () => {
    const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
    f.state.fault = fault;
    await assert.rejects(service.execute(preview, signal()));
    const saved = structuredClone(f.state.journal.get(metadata.operationId));
    f.state.fault = undefined;
    const result = await f.service().resume(metadata.operationId, signal());
    assert.equal(result.deletedFiles, 4);
    const final = f.state.journal.get(metadata.operationId);
    assert.equal(final.archive.fileId, saved.archive.fileId);
    if (saved.record) assert.equal(final.record.fileId, saved.record.fileId);
    assert.equal(f.state.reservations, 2);
  });
}

test("changed 412 and unresolved responses stay preserved; resume only retries unknown", async () => {
  const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
  f.state.changed.add("v1-snapshot"); f.state.unknown.add("v1-orphan");
  const first = await service.execute(preview, signal());
  assert.equal(first.deletedFiles, 2); assert.equal(first.changedFiles, 1);
  assert.equal(first.pendingFiles, 1); assert.equal(f.state.objects.size, 2);
  f.state.unknown.clear(); f.state.events = [];
  const resumed = await f.service().resume(metadata.operationId, signal());
  assert.equal(resumed.deletedFiles, 3);
  assert.deepEqual(f.state.events.filter((event) => event.startsWith("delete:")), ["delete:v1-orphan"]);
});

test("old account callbacks cannot save outcomes or act in the new account", async () => {
  const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
  f.state.fault = "abort-after-first-delete";
  await assert.rejects(service.execute(preview, signal()), { name: "AbortError" });
  assert.deepEqual(f.state.journal.get(metadata.operationId).outcomes, {});
  f.state.identity = true; f.gate.binding.accountKey = hash("account-2");
  const count = f.state.events.filter((event) => event.startsWith("delete:")).length;
  await assert.rejects(f.service().resume(metadata.operationId, signal()));
  assert.equal(f.state.events.filter((event) => event.startsWith("delete:")).length, count);
});

test("resume rejects a changed baseline digest before any DELETE", async () => {
  const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
  f.state.fault = "before-compaction";
  await assert.rejects(service.execute(preview, signal()));
  f.state.fault = undefined;
  f.state.journal.get(metadata.operationId).files[0].sha256 = hash("tampered");
  await assert.rejects(f.service().resume(metadata.operationId, signal()));
  assert.equal(f.state.objects.size, 4);
});

test("clean profile discovers historical records and loads raw recovery lazily", async () => {
  const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
  await service.execute(preview, signal());
  const receipt = structuredClone(f.state.journal.get(metadata.operationId).record);
  f.state.journal.clear();
  const reads = [];
  const remote = { async listCompactionRecords() { return [receipt]; },
    async readVerified(ref, requestSignal) {
      reads.push(ref.fileId); return f.remote.readVerified(ref, requestSignal);
    }
  };
  const scope = { workspaceId: metadata.workspaceId, checkIdentity: f.gate.checkIdentity };
  const records = await discoverVerifiedLegacyCompactionRecords(remote, scope, signal());
  assert.equal(records.length, 1);
  assert.deepEqual(reads, [receipt.fileId]);
  const archive = await loadVerifiedLegacyArchive(remote, scope, records[0], signal());
  assert.equal(archive.archive.objects.length, 4);
  assert.equal(archive.record.publicClientId, "client-1");
  assert.equal((await discoverVerifiedLegacyArchives(remote, scope, signal())).length, 1);
});

test("discovery rejects mismatched sidecar archive identity and future record format", async () => {
  const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
  await service.execute(preview, signal());
  const recordReceipt = f.state.journal.get(metadata.operationId).record;
  const original = JSON.parse(await f.state.remote.get(recordReceipt.fileId).text());
  const scope = { workspaceId: metadata.workspaceId, checkIdentity: f.gate.checkIdentity };
  const record = await parseLegacyCompactionRecord(new Blob([JSON.stringify(original)]));
  await assert.rejects(loadVerifiedLegacyArchive(f.remote, scope,
    { record: { ...record, operationId: "other-operation" }, recordReceipt }, signal()));
  await assert.rejects(parseLegacyCompactionRecord(
    new Blob([JSON.stringify({ ...original, formatVersion: 2 })])
  ), { code: "unsupported-format" });
});

test("preview pins the selected v3 before archive upload; a later head pauses cleanup", async () => {
  const f = fixture(), service = f.service(), preview = await service.preview(metadata, signal());
  f.state.v3 = { ...f.state.v3, revisionId: "revision-2" };
  await assert.rejects(service.execute(preview, signal()));
  assert.equal(f.state.objects.size, 4);
  assert.equal(f.state.events.filter((event) => event.startsWith("delete:")).length, 0);
  assert.equal(f.state.journal.get(metadata.operationId).v3.revisionId, "revision-1");
});

test("installed Google reader proves archive-only baseline and live late-child recovery", async () => {
  class Store {
    constructor(namespace) { this.namespace = namespace; this.files = []; this.bodies = new Map(); }
    async list(kind) { return this.files.filter((f) => f.appProperties.mtpKind === kind); }
    async read(file) { return this.bodies.get(file.id); }
    async create(kind, key, sha256, body) {
      const file = { id: crypto.randomUUID(), name: key, size: body.size, version: "1",
        appProperties: { mtpNamespace: this.namespace, mtpKind: kind, mtpKey: key, mtpHash: sha256 } };
      this.files.push(file); this.bodies.set(file.id, body); return file;
    }
  }
  const stores = new Map(["mtp-drive-v1", "mtp-drive-v2"].map((ns) => [ns, new Store(ns)]));
  const readerLoad = sourceLoader({ "services/drive/transport.ts": {
    DriveTransport: class { constructor(_auth, options) { return stores.get(options.namespace); } }
  } });
  const { assertGoogleLegacyArchiveReaderReady } = readerLoad("services/drive/legacy-compaction-google-reader.ts");
  const { DriveSync } = readerLoad("services/drive/sync.ts");
  const { encodeRawArchive } = readerLoad("services/drive/legacy-raw-archive-codec.ts");
  const store = stores.get("mtp-drive-v2"), writer = new DriveSync(store);
  const backup = (symbol) => ({ application: "personal-terminal", schemaVersion: 2,
    layout: { symbol }, drawings: [], images: [], watchlist: [], views: [] });
  const deviceId = "00000000-0000-4000-8000-000000000002";
  const parent = await writer.publish(backup("BASELINE"), { deviceId, parents: [] });
  const original = [...store.files];
  const archive = await encodeRawArchive(original.map((file) => ({
    file: { fileId: file.id, namespace: "mtp-drive-v2", kind: file.appProperties.mtpKind,
      key: file.appProperties.mtpKey, version: file.version, etag: '"pinned"', size: file.size,
      sha256: file.appProperties.mtpHash, appProperties: file.appProperties }, body: store.bodies.get(file.id)
  })), metadata);
  await writer.publish(backup("LATE"), { deviceId, parents: parent.inspection.heads });
  store.files = store.files.filter((file) => !original.includes(file));
  for (const file of original) store.bodies.delete(file.id);
  let checks = 0;
  await assertGoogleLegacyArchiveReaderReady({}, fetch, [archive], signal(), async () => { checks++; });
  assert.ok(checks > 3);
  assert.ok(store.files.length > 0);
});
