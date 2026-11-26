import assert from "node:assert/strict";
import test from "node:test";
import { backup, hash, root, sourceLoader, Store, tick } from "./drive-reader-guard-helpers.mjs";

const { DriveSync } = sourceLoader(root)("services/drive/sync.ts");
const hasCode = (code) => (error) => error.code === code;
const manifestReads = (store) =>
  store.events.filter((event) => event.op === "read" && event.kind === "snapshot");
const manifestLists = (store) =>
  store.events.filter((event) => event.op === "list" && event.kind === "snapshot");
const manifestFile = (store, nodeId) =>
  store.files.find(
    (file) => file.appProperties.mtpKind === "snapshot" && file.appProperties.mtpKey === nodeId
  );

class VersionedStore extends Store {
  async seed(...args) {
    const file = await super.seed(...args);
    // Keep version strings beyond the safe JS integer range in the fixture.
    file.version = "9007199254740992";
    return file;
  }
}

async function seedChain(store, size) {
  let previous;
  for (let index = 0; index < size; index++)
    previous = await store.snapshot(backup(), previous ? [previous.nodeId] : []);
  return previous;
}

test("inspection lists anew, bounds cold reads and reuses validated warm manifests", async () => {
  const store = new VersionedStore();
  const head = await seedChain(store, 12);
  const drive = new DriveSync(store);
  let active = 0,
    peak = 0;
  store.readHook = async () => {
    peak = Math.max(peak, ++active);
    await tick();
    active--;
  };
  const first = await drive.inspect();
  assert.deepEqual(first.heads, [head.nodeId]);
  assert.equal(manifestReads(store).length, 12);
  assert.equal(peak, 4);

  // Corruption of a caller's inspection cannot mutate the private cache.
  first.snapshots.find(({ manifest }) => manifest.nodeId === head.nodeId).manifest.parents.length =
    0;
  const second = await drive.inspect();
  assert.deepEqual(second.heads, [head.nodeId]);
  assert.deepEqual(
    second.snapshots.find(({ manifest }) => manifest.nodeId === head.nodeId).manifest.parents,
    head.manifest.parents
  );
  assert.equal(manifestLists(store).length, 2);
  assert.equal(manifestReads(store).length, 12);
});

test("changed server version forces verification even with the same declared content hash", async () => {
  const store = new VersionedStore();
  const head = await seedChain(store, 1);
  const drive = new DriveSync(store);
  await drive.inspect();

  const file = manifestFile(store, head.nodeId);
  const replacement = (await store.bodies.get(file.id).text()).replace(
    '"protocol":1',
    '"protocol":2'
  );
  const tampered = new Blob([replacement]);
  assert.equal(tampered.size, file.size);
  file.version = "9007199254740993";
  store.bodies.set(file.id, tampered);
  await assert.rejects(drive.inspect(), hasCode("remote-invalid"));
  assert.equal(manifestReads(store).length, 2);
});

test("absent or invalid versions always fall back to SHA-verified reads", async () => {
  const store = new VersionedStore();
  const head = await seedChain(store, 1);
  const file = manifestFile(store, head.nodeId);
  const drive = new DriveSync(store);
  await drive.inspect();
  delete file.version;
  await drive.inspect();
  await drive.inspect();
  file.version = "not-a-server-version";
  await drive.inspect();
  await drive.inspect();
  assert.equal(manifestReads(store).length, 5);
});

test("metadata drift at a fixed version cannot bypass verification", async () => {
  const store = new VersionedStore();
  const head = await seedChain(store, 1);
  const drive = new DriveSync(store);
  await drive.inspect();
  const file = manifestFile(store, head.nodeId);
  file.appProperties.mtpKey = crypto.randomUUID();
  await assert.rejects(drive.inspect(), hasCode("remote-invalid"));
  file.appProperties.mtpKey = head.nodeId;
  file.appProperties.mtpHash = "0".repeat(64);
  await assert.rejects(drive.inspect(), hasCode("remote-invalid"));
  assert.equal(manifestReads(store).length, 3);
});

test("a new listing evicts snapshots which were deleted", async () => {
  const store = new VersionedStore();
  const head = await seedChain(store, 1);
  const drive = new DriveSync(store);
  await drive.inspect();
  const file = manifestFile(store, head.nodeId);
  store.files = store.files.filter(({ id }) => id !== file.id);
  assert.equal((await drive.inspect()).heads.length, 0);
  store.files.push(file);
  assert.deepEqual((await drive.inspect()).heads, [head.nodeId]);
  assert.equal(manifestReads(store).length, 2);
});

test("warm inspections still detect new heads and conflicting immutable revisions", async () => {
  const store = new VersionedStore();
  const initial = await seedChain(store, 1);
  const drive = new DriveSync(store);
  const before = await drive.inspect();
  const newHead = await store.snapshot(backup(), [initial.nodeId]);
  await assert.rejects(drive.download(initial.nodeId, before), hasCode("conflict"));
  assert.equal(manifestReads(store).length, 2);
  assert.equal(
    store.events.some((event) => event.op === "read" && event.kind === "blob"),
    false
  );
  const accepted = await drive.inspect();
  assert.deepEqual(accepted.heads, [newHead.nodeId]);

  const file = manifestFile(store, newHead.nodeId);
  const changed = new Blob([
    JSON.stringify({ ...newHead.manifest, createdAt: "2026-11-26T00:00:00.000Z" })
  ]);
  file.version = "9007199254740993";
  file.appProperties.mtpHash = await hash(changed);
  file.size = changed.size;
  store.bodies.set(file.id, changed);
  await assert.rejects(drive.download(newHead.nodeId, accepted), hasCode("remote-invalid"));
  assert.equal(manifestReads(store).length, 3);
  assert.equal(
    store.events.some((event) => event.op === "UPLOAD"),
    false
  );
});

test("repeat publish validations download only the new manifest in a warm catalog", async () => {
  const store = new VersionedStore();
  const old = await seedChain(store, 50);
  const drive = new DriveSync(store);
  const before = await drive.inspect();
  assert.equal(manifestReads(store).length, 50);
  store.events.length = 0;
  const next = backup();
  next.layout.chartSettings.theme = "light";
  const result = await drive.publish(next, {
    deviceId: old.manifest.deviceId,
    parents: before.heads,
    expectedInspection: before
  });
  assert.deepEqual(result.inspection.heads, [result.nodeId]);
  assert.equal(manifestLists(store).length, 5);
  assert.equal(manifestReads(store).length, 1);
  assert.equal(
    store.events.filter((event) => event.op === "read" && event.kind === "blob").length,
    1
  );
  assert.equal(store.events.filter((event) => event.op === "UPLOAD").length, 2);
});
