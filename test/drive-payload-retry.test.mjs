import assert from "node:assert/strict";
import test from "node:test";
import { backup, hash, root, sourceLoader, Store } from "./drive-reader-guard-helpers.mjs";

const load = sourceLoader(root);
const { DriveSync } = load("services/drive/sync.ts");
const { prepareDriveBackup, restoreDriveBackup } = load("services/drive/backup.ts");

test("retry after a failed manifest reuses the v2 payload when only export time changed", async () => {
  class FailingManifestStore extends Store {
    failNextManifest = true;

    async create(kind, key, sha, body) {
      if (kind === "snapshot" && this.failNextManifest) {
        this.failNextManifest = false;
        throw new Error("manifest failed");
      }
      return super.create(kind, key, sha, body);
    }
  }

  const first = { ...backup(), exportedAt: "2026-11-26T10:00:00.000Z" };
  const retry = { ...first, exportedAt: "2026-11-26T10:01:00.000Z" };
  const store = new FailingManifestStore();
  const sync = new DriveSync(store);
  const options = { deviceId: crypto.randomUUID(), parents: [] };

  await assert.rejects(sync.publish(first, options), /manifest failed/);
  const [prepared] = store.files;
  assert.equal(store.files.length, 1);
  assert.equal(prepared.appProperties.mtpKind, "blob");
  const { nodeId, inspection } = await sync.publish(retry, options);

  assert.equal(store.events.filter(({ op, kind }) => op === "UPLOAD" && kind === "blob").length, 1);
  assert.equal(inspection.snapshots[0].manifest.payload.sha256, prepared.appProperties.mtpHash);
  assert.ok(Number.isFinite(Date.parse(inspection.snapshots[0].manifest.createdAt)));
  assert.deepEqual(await sync.download(nodeId), backup());
  assert.equal(first.exportedAt, "2026-11-26T10:00:00.000Z");
  assert.equal(retry.exportedAt, "2026-11-26T10:01:00.000Z");
});

test("v2 payloads ignore only the export date and still read existing dated files", async () => {
  const old = { ...backup(), exportedAt: "2026-11-26T10:00:00.000Z" };
  const oldPayload = new Blob([JSON.stringify(old)], { type: "application/json" });
  assert.equal((await restoreDriveBackup(oldPayload, [])).exportedAt, old.exportedAt);

  const { payload } = await prepareDriveBackup(old);
  const { payload: next } = await prepareDriveBackup({
    ...old,
    layout: { ...old.layout, symbol: "GAZP" }
  });
  assert.notEqual(await hash(payload), await hash(next));
  assert.equal((await restoreDriveBackup(payload, [])).exportedAt, undefined);

  const legacy = { ...old, schemaVersion: 1 };
  const { payload: legacyPayload } = await prepareDriveBackup(legacy);
  assert.equal((await restoreDriveBackup(legacyPayload, [])).exportedAt, old.exportedAt);
});
