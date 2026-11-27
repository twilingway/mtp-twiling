import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { createLegacyArchive, restoreArchivedLegacyVersion, verifyLegacyArchiveFile } = load(
  "services/drive/device-slot-archive.ts"
);
const { LegacyDriveCleanup } = load("services/drive/device-slot-cleanup.ts");
const { DriveSync } = load("services/drive/sync.ts");
const { DRIVE_NAMESPACE, LEGACY_DRIVE_NAMESPACE } = load("services/drive/types.ts");
const signal = new AbortController().signal;
const deviceId = "00000000-0000-4000-8000-000000000002";
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

async function fixture() {
  const files = [];
  const transport = {
    list: async (kind) => files.filter(({ appProperties }) => appProperties.mtpKind === kind),
    read: async ({ body }) => body,
    create: async (kind, key, hash, body) => {
      const file = {
        id: `f-${files.length}`,
        name: key,
        size: body.size,
        version: "1",
        body,
        appProperties: { mtpNamespace: DRIVE_NAMESPACE, mtpKind: kind, mtpKey: key, mtpHash: hash }
      };
      files.push(file);
      return file;
    }
  };
  const sync = new DriveSync(transport);
  const write = async (symbol) =>
    sync.publish(backup(symbol), {
      deviceId,
      parents: (await sync.inspect()).heads
    });
  return { sync, write, files, transport };
}

test("issued archive verifies every version from file and restores lossless selected image bytes", async () => {
  const { sync, write } = await fixture();
  await write("SBER");
  await write("GAZP");
  const inspection = await sync.inspect();
  const sources = [{ namespace: DRIVE_NAMESPACE, sync, inspection }];
  const archive = await createLegacyArchive(sources, signal);
  assert.equal(archive.count, 2);
  assert.equal(archive.choices.length, 1);
  const file = new Blob([await archive.body.arrayBuffer()]);
  await verifyLegacyArchiveFile(file, archive, signal);
  const restored = await verifyLegacyArchiveFile(file, archive, signal, archive.choices[0].id);
  assert.equal(restored.layout.symbol, "GAZP");
  assert.equal(restored.images[0].data, gif);
  const old = inspection.snapshots.find(
    ({ manifest }) => !inspection.heads.includes(manifest.nodeId)
  );
  const afterReload = await restoreArchivedLegacyVersion(
    file,
    archive.digest,
    `${DRIVE_NAMESPACE}:${old.manifest.nodeId}`,
    signal
  );
  assert.equal(afterReload.layout.symbol, "SBER");
  // The media bytes changed but the archive header is still identical.
  const last = file.size - 1;
  const damaged = new Blob([file.slice(0, last), new Uint8Array([0])]);
  await assert.rejects(verifyLegacyArchiveFile(damaged, archive, signal), {
    code: "remote-invalid"
  });
  await assert.rejects(verifyLegacyArchiveFile(file.slice(0, last), archive, signal), {
    code: "remote-invalid"
  });
});

test("late old-writer activity invalidates the archive before displaying a migration choice", async () => {
  const { sync, write } = await fixture();
  await write("SBER");
  const before = await sync.inspect();
  await write("GAZP");
  await assert.rejects(
    createLegacyArchive([{ namespace: DRIVE_NAMESPACE, sync, inspection: before }], signal),
    { code: "conflict" }
  );
});

async function cleanupFixture() {
  const { sync, write, files, transport } = await fixture();
  const parent = await write("SBER");
  const child = await write("GAZP");
  const sources = [
    {
      namespace: DRIVE_NAMESPACE,
      sync,
      inspection: await sync.inspect()
    },
    {
      namespace: LEGACY_DRIVE_NAMESPACE,
      sync: { inspect: async () => ({ heads: [], snapshots: [] }) },
      inspection: { heads: [], snapshots: [] }
    }
  ];
  const archive = await createLegacyArchive(sources, signal);
  const removed = [];
  let fenced = false;
  const cleanup = new LegacyDriveCleanup(
    {
      list: (namespace, kind) => (namespace === DRIVE_NAMESPACE ? transport.list(kind) : []),
      deletePinned: async (file) => {
        const i = files.findIndex((item) => item.id === file.id);
        assert.ok(i >= 0);
        removed.push(file);
        files.splice(i, 1);
      }
    },
    {
      assertOldWritersFenced: async () => {
        if (!fenced) throw new Error("writers are still active");
      },
      assertMigratedHead: async (digest) => {
        assert.equal(digest, archive.digest);
      }
    }
  );
  return {
    cleanup,
    removed,
    archive,
    sources,
    write,
    parent,
    child,
    fence: () => {
      fenced = true;
    }
  };
}

test("cleanup needs an external writer fence and removes child snapshots before parents and blobs", async () => {
  const { cleanup, removed, archive, sources, fence, parent, child } = await cleanupFixture();
  const first = await cleanup.preview(sources, archive, archive.body, signal);
  await assert.rejects(cleanup.execute(first, signal, assert.fail), /writers are still active/);
  assert.equal(removed.length, 0);
  fence();
  const preview = await cleanup.preview(sources, archive, archive.body, signal);
  const journal = [];
  const total = await cleanup.execute(preview, signal, async (id, count) => {
    assert.equal(count, journal.length + 1);
    journal.push(id);
  });
  assert.equal(total, preview.fileCount);
  assert.deepEqual(
    removed.filter(({ kind }) => kind === "snapshot").map(({ key }) => key),
    [child.nodeId, parent.nodeId]
  );
  assert.ok(removed.slice(2).every(({ kind }) => kind === "blob"));
  assert.deepEqual(
    journal,
    removed.map(({ id }) => id)
  );
});

test("cleanup does not act on a late manifest outside the verified file and preview", async () => {
  const { cleanup, removed, archive, sources, write, fence } = await cleanupFixture();
  const preview = await cleanup.preview(sources, archive, archive.body, signal);
  fence();
  await write("NVTK");
  await assert.rejects(cleanup.execute(preview, signal, assert.fail), { code: "conflict" });
  assert.equal(removed.length, 0);
});
