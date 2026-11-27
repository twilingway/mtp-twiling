import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { createLegacyArchiveOverlay } = load("services/drive/legacy-archive-overlay.ts");
const { encodeRawArchive, decodeRawArchive, MAX_RAW_ARCHIVE_BYTES } = load(
  "services/drive/legacy-raw-archive-codec.ts"
);
const { DriveSync } = load("services/drive/sync.ts");
const { sha256 } = load("services/drive/backup.ts");
const { DRIVE_NAMESPACE, LEGACY_DRIVE_NAMESPACE } = load("services/drive/types.ts");
const deviceId = "00000000-0000-4000-8000-000000000002";
const metadata = {
  operationId: "overlay-operation",
  workspaceId: "overlay-workspace",
  publicClientId: "overlay-client",
  createdAt: "2026-11-27T00:00:00.000Z"
};
const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const backup = (symbol) => ({
  application: "personal-terminal",
  schemaVersion: 2,
  layout: { symbol },
  drawings: [],
  images: [
    {
      id: "synthetic",
      type: "image/gif",
      data: gif,
      symbol,
      point: { timestamp: 1000, value: 1 },
      width: 20
    }
  ],
  watchlist: [],
  views: []
});
const code = (expected) => (error) => error.code === expected;

class MemoryStore {
  constructor(namespace = DRIVE_NAMESPACE) {
    this.namespace = namespace;
  }
  files = [];
  contents = new Map();
  reads = 0;
  creates = 0;
  async list(kind) {
    return this.files
      .filter((file) => file.appProperties.mtpKind === kind)
      .map((file) => structuredClone(file));
  }
  async read(file, maxBytes) {
    this.reads++;
    const body = this.contents.get(file.id);
    assert.ok(body && body.size <= maxBytes);
    return body;
  }
  async create(kind, key, hash, body) {
    this.creates++;
    const file = {
      id: crypto.randomUUID(),
      name: key,
      size: body.size,
      version: "1",
      appProperties: { mtpNamespace: this.namespace, mtpKind: kind, mtpKey: key, mtpHash: hash }
    };
    this.files.push(file);
    this.contents.set(file.id, body);
    return structuredClone(file);
  }
}

async function archiveFiles(store, files = store.files, overrides = {}) {
  const objects = files.map((file) => ({
    file: {
      fileId: file.id,
      namespace: file.appProperties.mtpNamespace,
      kind: file.appProperties.mtpKind,
      key: file.appProperties.mtpKey,
      version: file.version,
      etag: `"${file.id}-tag"`,
      size: file.size,
      sha256: file.appProperties.mtpHash,
      appProperties: file.appProperties
    },
    body: store.contents.get(file.id)
  }));
  return decodeRawArchive((await encodeRawArchive(objects, { ...metadata, ...overrides })).body);
}

async function lateFixture() {
  const base = new MemoryStore();
  const writer = new DriveSync(base);
  const parent = await writer.publish(backup("BASELINE"), { deviceId, parents: [] });
  const baselineIds = new Set(base.files.map((file) => file.id));
  const archive = await archiveFiles(base);
  const child = await writer.publish(backup("LATE"), {
    deviceId,
    parents: parent.inspection.heads
  });
  base.files = base.files.filter((file) => !baselineIds.has(file.id));
  for (const id of baselineIds) base.contents.delete(id);
  return { base, archive, parent, child };
}

test("real DriveSync restores a late child with its deleted archived parent and image blob", async () => {
  const { base, archive, parent, child } = await lateFixture();
  await assert.rejects(new DriveSync(base).inspect(), code("remote-invalid"));
  const overlay = await createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [archive]);
  const reader = new DriveSync(overlay);
  const inspection = await reader.inspect();
  assert.deepEqual(inspection.heads, [child.nodeId]);
  assert.deepEqual(
    new Set(inspection.snapshots.map(({ manifest }) => manifest.nodeId)),
    new Set([parent.nodeId, child.nodeId])
  );
  const restored = await reader.download(child.nodeId, inspection);
  assert.equal(restored.layout.symbol, "LATE");
  assert.equal(restored.images[0].data, gif);
  assert.equal((await reader.download(parent.nodeId)).layout.symbol, "BASELINE");
  assert.deepEqual(
    (await overlay.listLateLegacySnapshots()).map((file) => file.appProperties.mtpKey),
    [child.nodeId]
  );
  const before = base.creates;
  await assert.rejects(overlay.create("blob", "x", "a".repeat(64), new Blob()), code("permission"));
  assert.equal(base.creates, before);
});

test("archive virtual identities are deterministic, bounded and separate from reused live IDs", async () => {
  const { base, archive, parent } = await lateFixture();
  const original = archive.objects.find((object) => object.file.kind === "snapshot");
  const overlay = await createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [archive]);
  const archiveFile = (await overlay.list("snapshot")).find(
    (file) => file.appProperties.mtpKey === parent.nodeId
  );
  assert.match(archiveFile.id, /^legacy-archive-[a-f0-9]{64}$/);
  assert.notEqual(archiveFile.id, original.file.fileId);
  const again = await createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [archive, archive]);
  assert.deepEqual(
    (await again.list("snapshot")).map((file) => file.id),
    (await overlay.list("snapshot")).map((file) => file.id)
  );
  const live = base.files.find((file) => file.appProperties.mtpKind === "snapshot");
  const oldId = live.id;
  live.id = original.file.fileId;
  base.contents.set(live.id, base.contents.get(oldId));
  base.contents.delete(oldId);
  const inspection = await new DriveSync(overlay).inspect();
  assert.equal(
    inspection.snapshots.length,
    2,
    "reused physical ID cannot shadow the archived version"
  );
  const virtual = (await overlay.list("snapshot")).find((file) => file.id === archiveFile.id);
  const body = await overlay.read(virtual, virtual.size);
  assert.equal(await body.text(), await original.body.text());
  await assert.rejects(overlay.read(virtual, virtual.size - 1), code("limit"));
  await assert.rejects(
    overlay.read({ ...virtual, size: virtual.size + 1 }, virtual.size + 1),
    code("remote-invalid")
  );
});

test("live snapshots are discovered after overlay creation; exact baseline copies are not late", async () => {
  const base = new MemoryStore();
  const writer = new DriveSync(base);
  const parent = await writer.publish(backup("BASELINE"), { deviceId, parents: [] });
  const archive = await archiveFiles(base);
  const overlay = await createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [archive]);
  assert.deepEqual(await overlay.listLateLegacySnapshots(), []);
  const source = base.files.find((file) => file.appProperties.mtpKind === "snapshot");
  base.files.push({ ...structuredClone(source), id: crypto.randomUUID() });
  base.contents.set(base.files.at(-1).id, base.contents.get(source.id));
  assert.deepEqual(await overlay.listLateLegacySnapshots(), []);
  const late = await writer.publish(backup("NEW-LATE"), {
    deviceId,
    parents: parent.inspection.heads
  });
  assert.deepEqual(
    (await overlay.listLateLegacySnapshots()).map((file) => file.appProperties.mtpKey),
    [late.nodeId]
  );
  assert.deepEqual((await new DriveSync(overlay).inspect()).heads, [late.nodeId]);
});

test("same namespace and node ID with different raw hashes fails explicitly without choosing by date", async () => {
  const { base, archive, parent } = await lateFixture();
  const original = archive.objects.find((object) => object.file.kind === "snapshot");
  const manifest = JSON.parse(await original.body.text());
  manifest.createdAt = "2000-01-01T00:00:00.000Z";
  const changed = new Blob([JSON.stringify(manifest)]);
  await base.create("snapshot", parent.nodeId, await sha256(changed), changed);
  const overlay = await createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [archive]);
  await assert.rejects(overlay.list("snapshot"), code("conflict"));
  await assert.rejects(overlay.listLateLegacySnapshots(), code("conflict"));
  await assert.rejects(new DriveSync(overlay).inspect(), code("conflict"));
  const other = new MemoryStore();
  await other.create("snapshot", parent.nodeId, await sha256(changed), changed);
  const second = await archiveFiles(other);
  await assert.rejects(
    createLegacyArchiveOverlay(new MemoryStore(), DRIVE_NAMESPACE, [archive, second]),
    code("conflict")
  );
});

test("unknown future raw bytes remain readable, while existing DriveSync fails closed", async () => {
  const base = new MemoryStore();
  const bytes = new Blob([
    JSON.stringify({ protocol: 99, extension: { future: "preserve-exactly" } })
  ]);
  await base.create("snapshot", crypto.randomUUID(), await sha256(bytes), bytes);
  const archive = await archiveFiles(base);
  const overlay = await createLegacyArchiveOverlay(new MemoryStore(), DRIVE_NAMESPACE, [archive]);
  const [file] = await overlay.list("snapshot");
  assert.equal(await (await overlay.read(file, file.size)).text(), await bytes.text());
  await assert.rejects(new DriveSync(overlay).inspect(), code("unsupported-format"));
  assert.deepEqual(await overlay.listLateLegacySnapshots(), []);
});

test("tampered archive bytes or mismatched cloud receipts cannot produce a readable overlay", async () => {
  const { archive } = await lateFixture();
  const last = new Uint8Array(await archive.body.slice(-1).arrayBuffer());
  last[0] ^= 1;
  const changed = new Blob([archive.body.slice(0, -1), last]);
  for (const candidate of [
    { ...archive, body: changed },
    { ...archive, sha256: "a".repeat(64) },
    { ...archive, indexDigest: "b".repeat(64) },
    { ...archive, size: archive.size + 1 }
  ])
    await assert.rejects(
      createLegacyArchiveOverlay(new MemoryStore(), DRIVE_NAMESPACE, [candidate]),
      code("remote-invalid")
    );
});

test("namespace isolation, defensive metadata copies, and aggregate caps retain raw sources", async () => {
  const base = new MemoryStore();
  await new DriveSync(base).publish(backup("BASELINE"), { deviceId, parents: [] });
  const archive = await archiveFiles(base);
  const legacy = await createLegacyArchiveOverlay(
    new MemoryStore(LEGACY_DRIVE_NAMESPACE),
    LEGACY_DRIVE_NAMESPACE,
    [archive]
  );
  assert.deepEqual(await legacy.list("snapshot"), []);
  const overlay = await createLegacyArchiveOverlay(new MemoryStore(), DRIVE_NAMESPACE, [archive]);
  const [file] = await overlay.list("snapshot");
  file.appProperties.mtpHash = "0".repeat(64);
  assert.notEqual(
    (await overlay.list("snapshot"))[0].appProperties.mtpHash,
    file.appProperties.mtpHash
  );
  await assert.rejects(overlay.read(file, file.size), code("remote-invalid"));
  await assert.rejects(
    createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, Array(2049).fill(archive)),
    code("limit")
  );
  class Oversized extends Blob {
    get size() {
      return MAX_RAW_ARCHIVE_BYTES + 1;
    }
  }
  const huge = new Oversized();
  await assert.rejects(
    createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [
      { ...archive, body: huge, size: huge.size }
    ]),
    code("limit")
  );
  assert.ok(base.files.length > 0);
});

test("corrupt live blob cannot be silently replaced by a valid archived duplicate", async () => {
  const base = new MemoryStore();
  const published = await new DriveSync(base).publish(backup("BASELINE"), {
    deviceId,
    parents: []
  });
  const archive = await archiveFiles(base);
  const overlay = await createLegacyArchiveOverlay(base, DRIVE_NAMESPACE, [archive]);
  const blob = base.files.find((file) => file.appProperties.mtpKind === "blob");
  const bytes = new Uint8Array(await base.contents.get(blob.id).arrayBuffer());
  bytes[0] ^= 1;
  base.contents.set(blob.id, new Blob([bytes]));
  await assert.rejects(new DriveSync(overlay).download(published.nodeId), code("remote-invalid"));
  const virtual = (await overlay.list("blob")).find(
    (file) =>
      file.id.startsWith("legacy-archive-") &&
      file.appProperties.mtpHash === blob.appProperties.mtpHash
  );
  assert.equal(await sha256(await overlay.read(virtual, virtual.size)), blob.appProperties.mtpHash);
});

test("migration inspector optional archive injection uses the real overlay and DriveSync readers", async () => {
  const { base, archive, child } = await lateFixture();
  const { inspectLegacyDeviceSlotSources } = sourceLoader({
    "services/drive/device-slot-sync.ts": {
      publishLegacyDeviceSlot: () => assert.fail("read-only discovery must not publish a slot")
    }
  })("services/drive/device-slot-migration.ts");
  const authorization = {
    connectionId: "synthetic-overlay",
    signal: new AbortController().signal,
    getAccessToken: () => "synthetic-token",
    invalidate: () => assert.fail("no auth failure expected")
  };
  const requests = [];
  const fetcher = async (address, init) => {
    assert.equal(init.method ?? "GET", "GET", "archive-aware discovery never writes");
    const url = new URL(address);
    requests.push(url.pathname);
    if (url.searchParams.get("alt") === "media") {
      const body = base.contents.get(url.pathname.split("/").at(-1));
      return new Response(body, { headers: { "Content-Length": String(body.size) } });
    }
    const query = url.searchParams.get("q");
    const kind = query.includes("value='snapshot'") ? "snapshot" : "blob";
    const files = query.includes(`value='${DRIVE_NAMESPACE}'`) ? await base.list(kind) : [];
    return new Response(JSON.stringify({ files, incompleteSearch: false }), {
      headers: { "Content-Type": "application/json" }
    });
  };
  await assert.rejects(
    inspectLegacyDeviceSlotSources(authorization, fetcher),
    code("remote-invalid")
  );
  const sources = await inspectLegacyDeviceSlotSources(authorization, fetcher, [archive]);
  const current = sources.find((source) => source.namespace === DRIVE_NAMESPACE);
  assert.deepEqual(current.inspection.heads, [child.nodeId]);
  assert.equal((await current.sync.download(child.nodeId)).layout.symbol, "LATE");
  assert.deepEqual(
    sources.find((source) => source.namespace === LEGACY_DRIVE_NAMESPACE).inspection.heads,
    []
  );
  assert.ok(requests.length > 0);
});
