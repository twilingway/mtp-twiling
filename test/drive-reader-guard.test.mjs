import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  root,
  sourceLoader,
  Store,
  harness,
  backup,
  payload,
  hash,
  tick
} from "./drive-reader-guard-helpers.mjs";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const load = sourceLoader(root);
const legacyFixtures = JSON.parse(
  readFileSync(new URL("./fixtures/drive-reader-legacy.json", import.meta.url), "utf8")
);
const { DriveSync } = load("services/drive/sync.ts");
const { driveBackupDigest } = load("services/drive/backup.ts");
const code = (value) => (error) => error.code === value;
const uploads = (store) => store.events.filter((event) => event.op === "UPLOAD");
const checkpoints = (f) => f.events.filter((event) => event.op === "CHECKPOINT");
const unknownKinds = ["envelope3", "instance2", "style-key", "unknown-keys", "protocol3"];
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error("No Google or fetch in reader tests");
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(fetchCalls, 0);
});

function unchanged(f, original, expected = "unsupported-format") {
  assert.equal(f.coordinator.getSnapshot().error, expected);
  assert.equal(f.coordinator.getSnapshot().phase, "error");
  assert.equal(f.coordinator.getSnapshot().connected, false);
  assert.equal(f.coordinator.getSnapshot().automatic, false);
  assert.equal(uploads(f.store).length, 0);
  assert.equal(
    f.events.filter((event) => ["bridgeImport", "LOCAL_WRITE"].includes(event.op)).length,
    0
  );
  assert.equal(checkpoints(f).length, 0);
  assert.deepEqual(f.record(), original);
}
async function replaceSnapshot(store, node, data) {
  const body = new Blob([JSON.stringify(data)]),
    sha = await hash(body);
  const payloadFile = await store.seed("blob", sha, sha, body);
  const manifest = { ...node.manifest, payload: { sha256: sha, size: body.size } };
  const manifestBody = new Blob([JSON.stringify(manifest)]);
  store.files = store.files.filter((file) => file.appProperties.mtpKey !== manifest.nodeId);
  await store.seed("snapshot", manifest.nodeId, await hash(manifestBody), manifestBody);
  return { ...node, manifest, payloadFile };
}

for (const kind of unknownKinds)
  for (const dirty of [false, true]) {
    test(`${kind}: same-head ${dirty ? "dirty" : "clean"} cannot accept or upload`, async (t) => {
      const store = new Store(),
        node = await store.snapshot(payload(kind), [], kind === "protocol3" ? 3 : 1);
      const digest = await driveBackupDigest(backup());
      const f = await harness(root, store, {
        baseHeads: [node.nodeId],
        lastSyncedDigest: dirty ? "a".repeat(64) : digest
      });
      t.after(() => f.stop());
      const original = structuredClone(f.record()),
        bytes = await store.bodies.get(node.payloadFile.id).text();
      await f.connect();
      unchanged(f, original);
      assert.equal(await store.bodies.get(node.payloadFile.id).text(), bytes);
      await f.coordinator.setAutomatic(true);
      f.coordinator.localChanged();
      await f.coordinator.sync();
      unchanged(f, original);
    });
  }
for (const kind of unknownKinds)
  for (const link of ["unlinked", "changed"]) {
    test(`${kind}: ${link} rejects before import/checkpoint/upload`, async (t) => {
      const store = new Store(),
        previous = link === "changed" ? await store.snapshot(backup()) : undefined;
      await store.snapshot(
        payload(kind),
        previous ? [previous.nodeId] : [],
        kind === "protocol3" ? 3 : 1
      );
      const f = await harness(
        root,
        store,
        previous
          ? { baseHeads: [previous.nodeId], lastSyncedDigest: await driveBackupDigest(backup()) }
          : {}
      );
      t.after(() => f.stop());
      const original = structuredClone(f.record());
      await f.connect();
      unchanged(f, original);
    });
  }
for (const dirty of [false, true]) {
  test(`actual automatic debounce validates unknown same-head (${dirty ? "dirty" : "clean"})`, async (t) => {
    const store = new Store(),
      node = await store.snapshot(backup());
    const f = await harness(
      root,
      store,
      { baseHeads: [node.nodeId], lastSyncedDigest: await driveBackupDigest(backup()) },
      true
    );
    t.after(() => f.stop());
    await f.connect();
    const beforeAutomatic = structuredClone(f.record());
    await replaceSnapshot(store, node, payload("envelope3"));
    f.events.length = 0;
    store.events.length = 0;
    if (dirty) {
      const local = backup();
      local.layout.chartSettings.theme = "light";
      f.setLocal(local);
    }
    await f.automatic();
    assert.equal(f.coordinator.getSnapshot().error, "unsupported-format");
    assert.equal(uploads(store).length, 0);
    assert.deepEqual(f.record().baseHeads, [node.nodeId]);
    assert.equal(f.events.filter((event) => event.op === "LOCAL_WRITE").length, 0);
    assert.equal(checkpoints(f).length, 1, "only localChanged pending marker precedes validation");
    assert.equal(f.record().pendingChanges, true);
    assert.deepEqual(f.record(), { ...beforeAutomatic, pendingChanges: true });
    assert.equal(f.coordinator.getSnapshot().automatic, false);
    assert.equal(f.coordinator.getSnapshot().automaticBlockedByFormat, true);
  });
}
for (const schemaVersion of [1, 2])
  for (const dirty of [false, true]) {
    test(`supported envelope${schemaVersion} same-head ${dirty ? "publishes" : "accepts"}`, async (t) => {
      const data = backup();
      data.schemaVersion = schemaVersion;
      const store = new Store(),
        node = await store.snapshot(data);
      const f = await harness(root, store, {
        baseHeads: [node.nodeId],
        lastSyncedDigest: dirty ? "a".repeat(64) : await driveBackupDigest(backup())
      });
      t.after(() => f.stop());
      await f.connect();
      assert.equal(f.coordinator.getSnapshot().phase, "idle");
      assert.equal(checkpoints(f).length, 1);
      assert.equal(
        uploads(store).filter((event) => event.kind === "snapshot").length,
        dirty ? 1 : 0
      );
      assert.ok(store.events.some((event) => event.op === "read" && event.kind === "blob"));
      if (dirty) {
        const inspection = await new DriveSync(store).inspect();
        assert.deepEqual(
          inspection.snapshots.find((item) => item.manifest.nodeId === inspection.heads[0]).manifest
            .parents,
          [node.nodeId]
        );
      }
    });
  }
for (const kind of unknownKinds)
  for (const resolving of [false, true]) {
    test(`standalone ${resolving ? "resolve" : "publish"} validates ${kind} parents`, async () => {
      const store = new Store();
      await store.snapshot(payload(kind), [], kind === "protocol3" ? 3 : 1);
      if (resolving) await store.snapshot(backup());
      const sync = new DriveSync(store);
      const parents = store.files
        .filter((file) => file.appProperties.mtpKind === "snapshot")
        .map((file) => file.appProperties.mtpKey);
      const operation = resolving ? "resolve" : "publish";
      await assert.rejects(
        sync[operation](backup(), { deviceId: crypto.randomUUID(), parents }),
        code("unsupported-format")
      );
      assert.equal(uploads(store).length, 0);
    });
  }
test("same-node replacement during a payload read cannot be accepted", async (t) => {
  const store = new Store(),
    node = await store.snapshot(backup());
  const f = await harness(root, store, {
    baseHeads: [node.nodeId],
    lastSyncedDigest: await driveBackupDigest(backup())
  });
  t.after(() => f.stop());
  const original = structuredClone(f.record());
  let changed = false;
  store.readHook = async (file) => {
    if (!changed && file.id === node.payloadFile.id) {
      changed = true;
      await replaceSnapshot(store, node, payload("envelope3"));
    }
  };
  await f.connect();
  assert.equal(f.coordinator.getSnapshot().error, "remote-invalid");
  assert.deepEqual(f.record(), original);
  assert.equal(uploads(store).length + checkpoints(f).length, 0);
});
for (const resolving of [false, true]) {
  test(`standalone ${resolving ? "resolve" : "publish"} rechecks heads after parent read`, async () => {
    const store = new Store(),
      node = await store.snapshot(backup());
    const sibling = resolving ? await store.snapshot(backup()) : undefined;
    let changed = false;
    store.readHook = async (file) => {
      if (!changed && file.id === node.payloadFile.id) {
        changed = true;
        await store.snapshot(payload("envelope3"), [node.nodeId]);
      }
    };
    const sync = new DriveSync(store);
    await assert.rejects(
      sync[resolving ? "resolve" : "publish"](backup(), {
        deviceId: crypto.randomUUID(),
        parents: [node.nodeId, ...(sibling ? [sibling.nodeId] : [])]
      }),
      code("conflict")
    );
    assert.equal(uploads(store).length, 0);
  });
}
test("pinned inspection forbids same-node supported replacement before standalone publish", async () => {
  const store = new Store(),
    node = await store.snapshot(backup()),
    sync = new DriveSync(store);
  const expectedInspection = await sync.inspect(),
    replacement = backup();
  replacement.layout.chartSettings.theme = "light";
  await replaceSnapshot(store, node, replacement);
  await assert.rejects(
    sync.publish(backup(), {
      deviceId: crypto.randomUUID(),
      parents: [node.nodeId],
      expectedInspection
    }),
    code("remote-invalid")
  );
  assert.equal(uploads(store).length, 0);
});
test("a late head after blob upload prevents the snapshot commit", async () => {
  const store = new Store(),
    node = await store.snapshot(backup()),
    sync = new DriveSync(store);
  const create = store.create.bind(store);
  let changed = false;
  store.create = async (...args) => {
    const result = await create(...args);
    if (!changed && args[0] === "blob") {
      changed = true;
      await store.snapshot(payload("envelope3"), [node.nodeId]);
    }
    return result;
  };
  const local = backup();
  local.layout.chartSettings.theme = "light";
  await assert.rejects(
    sync.publish(local, { deviceId: crypto.randomUUID(), parents: [node.nodeId] }),
    code("conflict")
  );
  assert.equal(uploads(store).filter((event) => event.kind === "snapshot").length, 0);
  assert.equal(
    uploads(store).length,
    1,
    "the validated local blob can remain orphaned; no Drive CAS exists"
  );
});

async function localFixture(value) {
  const { database, storageDB } = await createGuestFixture();
  const id = "drive-v2:owner";
  if (value !== undefined)
    database.stores.preferences.set(id, { id, owner: "owner", value: structuredClone(value) });
  const writes = [];
  database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) =>
    writes.push(structuredClone(record));
  const loader = sourceLoader(root, {
    "services/storage-db.ts": storageDB
  });
  return {
    ...loader("services/drive/local.ts"),
    writes,
    loader,
    get records() {
      return database.stores.preferences;
    }
  };
}
const association = () => ({
  schemaVersion: 1,
  markerId: crypto.randomUUID(),
  deviceId: crypto.randomUUID(),
  baseHeads: [crypto.randomUUID()],
  automatic: false,
  lastSyncedDigest: "a".repeat(64),
  lastSyncedAt: "2026-11-26T00:00:00.000Z"
});
for (const kind of ["version", "extension"]) {
  test(`unknown association ${kind}: zero fallback writes and byte preservation`, async () => {
    const value = association();
    if (kind === "version") value.schemaVersion = 2;
    else value.futureMinimumReader = 99;
    const f = await localFixture(value),
      original = JSON.stringify([...f.records]);
    await assert.rejects(f.loadDriveRecord("owner"), code("unsupported-format"));
    assert.equal(f.writes.length, 0);
    assert.equal(JSON.stringify([...f.records]), original);
  });
  for (const manual of [false, true])
    test(`unknown association ${kind}: ${manual ? "connect" : "restore"} exposes pause, never connected/autosync`, async (t) => {
      const value = association();
      if (kind === "version") value.schemaVersion = 2;
      else value.futureMinimumReader = 99;
      const f = await localFixture(value),
        calls = [],
        abort = new AbortController();
      const { DriveCoordinator } = f.loader("services/drive/coordinator.ts");
      const authorization = {
        signal: abort.signal,
        invalidate: () => abort.abort(),
        getAccessToken: () => "fake-only"
      };
      const coordinator = new DriveCoordinator(
        {
          profile: () => ({
            owner: "owner",
            session: "session",
            authenticated: true,
            blocked: false
          }),
          exportBackup: async () => {
            calls.push("export");
            return backup();
          },
          importBackup: async () => calls.push("import")
        },
        {
          load: f.loadDriveRecord,
          save: f.saveDriveRecord,
          sync: () => {
            calls.push("remote");
            throw new Error("must not create remote");
          },
          auth: {
            prepare: async () => {},
            restore: async () => {
              calls.push("restoreAuth");
              return authorization;
            },
            connectFromUserGesture: () => Promise.resolve(authorization),
            suspend: () => {},
            disconnect: async () => {}
          }
        }
      );
      t.after(() => coordinator.suspend());
      coordinator.profileChanged();
      await tick();
      if (manual) {
        await coordinator.prepare();
        await coordinator.connect();
      }
      const status = coordinator.getSnapshot();
      assert.equal(status.phase, "error");
      assert.equal(status.error, "unsupported-format");
      assert.equal(status.connected, false);
      assert.equal(status.automatic, false);
      coordinator.localChanged();
      await coordinator.setAutomatic(true);
      await coordinator.sync();
      assert.equal(f.writes.length, 0);
      assert.deepEqual(f.records.get("drive-v2:owner").value, value);
      assert.deepEqual(calls, []);
    });
}
test("only missing association bootstraps; supported association retains heads and optional flags", async () => {
  const fresh = await localFixture();
  const created = await fresh.loadDriveRecord("owner");
  assert.equal(created.schemaVersion, 1);
  assert.deepEqual(created.baseHeads, []);
  assert.equal(fresh.writes.length, 2);
  const value = association(),
    existing = await localFixture(value),
    loaded = await existing.loadDriveRecord("owner");
  assert.deepEqual(loaded.baseHeads, value.baseHeads);
  assert.equal(loaded.automatic, false);
  assert.equal(existing.writes.length, 0);
});
test("malformed current association does not trigger destructive bootstrap", async () => {
  const f = await localFixture({ ...association(), markerId: "invalid" });
  await assert.rejects(f.loadDriveRecord("owner"), code("remote-invalid"));
  assert.equal(f.writes.length, 0);
});
for (const fixture of legacyFixtures.fixtures) {
  for (const namespace of ["mtp-drive-v1", "mtp-drive-v2"])
    test(`historical writer ${fixture.name}: ${namespace} payload remains readable`, async () => {
      const store = new Store(),
        node = await store.snapshot(fixture.payload);
      node.manifest.images = fixture.images.map((image) => ({
        ...image.reference,
        index: image.index,
        mimeType: image.mimeType
      }));
      for (const image of fixture.images) {
        const body = new Blob([Buffer.from(image.base64, "base64")], { type: image.mimeType });
        await store.seed("blob", image.reference.sha256, image.reference.sha256, body);
      }
      const manifestFile = store.files.find((file) => file.appProperties.mtpKey === node.nodeId);
      const manifestBody = new Blob([JSON.stringify(node.manifest)]);
      manifestFile.size = manifestBody.size;
      manifestFile.appProperties.mtpHash = await hash(manifestBody);
      store.bodies.set(manifestFile.id, manifestBody);
      for (const file of store.files) file.appProperties.mtpNamespace = namespace;
      const sync = new DriveSync(store, namespace),
        result = await sync.download(node.nodeId);
      const expected = structuredClone(fixture.payload);
      expected.images.forEach((image, index) => {
        image.data = fixture.images[index].base64;
      });
      assert.deepEqual(result, expected);
      assert.equal(uploads(store).length, 0);
    });
}
for (const change of ["revision", "owner", "session", "disconnect"])
  test(`same-head validation preserves ${change} guard`, async (t) => {
    const store = new Store(),
      node = await store.snapshot(backup());
    const f = await harness(root, store, {
      baseHeads: [node.nodeId],
      lastSyncedDigest: await driveBackupDigest(backup())
    });
    t.after(() => f.stop());
    let changed = false;
    store.readHook = async (file) => {
      if (changed || file.id !== node.payloadFile.id) return;
      changed = true;
      if (change === "revision") f.coordinator.localIntent();
      else if (change === "disconnect") f.coordinator.disconnect();
      else f.changeProfile(change === "owner" ? { owner: "next-owner" } : { session: {} });
    };
    await f.connect();
    await tick();
    assert.equal(uploads(store).length + checkpoints(f).length, 0);
    assert.equal(f.events.filter((event) => event.op === "LOCAL_WRITE").length, 0);
    assert.equal(
      f.coordinator.getSnapshot().error,
      change === "revision" ? "local-changed" : undefined
    );
  });
for (const selection of ["local", "remote"])
  test(`conflict ${selection} choice cannot use a replaced unknown same-ID head`, async (t) => {
    const store = new Store(),
      node = await store.snapshot(backup());
    const f = await harness(root, store);
    t.after(() => f.stop());
    await f.connect();
    assert.equal(f.coordinator.getSnapshot().phase, "conflict");
    const original = structuredClone(f.record());
    await replaceSnapshot(store, node, payload("instance2"));
    await f.coordinator.choose(selection === "local" ? "local" : node.nodeId);
    unchanged(f, original);
  });
async function imageStore() {
  const data = backup();
  data.images = [
    {
      id: "guard-image",
      symbol: "SBER",
      type: "image/png",
      width: 100,
      point: { timestamp: 100, value: 99 },
      data: Buffer.alloc(100 * 1024, 7).toString("base64")
    }
  ];
  const store = new Store(),
    sync = new DriveSync(store);
  const node = await sync.publish(data, { deviceId: crypto.randomUUID(), parents: [] });
  const inspection = await sync.inspect(),
    manifest = inspection.snapshots[0].manifest;
  const image = store.files.find((file) => file.appProperties.mtpKey === manifest.images[0].sha256);
  return { data, store, sync, node, inspection, manifest, image };
}
for (const dirty of [false, true])
  test(`100KiB image same-head ${dirty ? "dirty" : "clean"} byte budget`, async (t) => {
    const f = await imageStore();
    const coordinator = await harness(root, f.store, {
      baseHeads: [f.node.nodeId],
      lastSyncedDigest: await driveBackupDigest(f.data)
    });
    t.after(() => coordinator.stop());
    const local = structuredClone(f.data);
    if (dirty) local.layout.chartSettings.theme = "light";
    coordinator.setLocal(local);
    f.store.events.length = 0;
    await coordinator.connect();
    assert.equal(coordinator.coordinator.getSnapshot().phase, "idle");
    const reads = f.store.events.filter((event) => event.op === "read"),
      imageReads = reads.filter((event) => event.id === f.image.id);
    const payloadReads = reads.filter((event) => event.kind === "blob" && event.id !== f.image.id);
    assert.equal(
      imageReads.length,
      dirty ? 1 : 0,
      "only actual unchanged-blob dedup may read the image"
    );
    assert.equal(
      payloadReads.length,
      1,
      "the writer validates a dirty upload, and the coordinator validates an unchanged check"
    );
    console.log(
      JSON.stringify({
        readerByteBudget: dirty ? "dirty" : "clean",
        imageBytes: imageReads.reduce((sum, event) => sum + event.bytes, 0),
        payloadBytes: payloadReads.reduce((sum, event) => sum + event.bytes, 0),
        payloadReads: payloadReads.length,
        manifestReads: reads.filter((event) => event.kind === "snapshot").length,
        uploadKinds: uploads(f.store).map((event) => event.kind)
      })
    );
  });
for (const mismatch of ["count", "mime", "missing-blob"])
  test(`payload-only guard checks image ${mismatch} without binary fetch`, async () => {
    const f = await imageStore();
    if (mismatch === "count") f.manifest.images = [];
    else if (mismatch === "mime") f.manifest.images[0].mimeType = "image/jpeg";
    else f.store.files = f.store.files.filter((file) => file.id !== f.image.id);
    f.store.events.length = 0;
    await assert.rejects(f.sync.validateHeads(f.inspection), code("remote-invalid"));
    assert.equal(
      f.store.events.filter((event) => event.op === "read" && event.id === f.image.id).length,
      0
    );
    assert.equal(uploads(f.store).length, 0);
  });
test("format-only guard leaves image byte integrity to actual download", async () => {
  const f = await imageStore();
  f.store.bodies.set(f.image.id, new Blob([Buffer.alloc(100 * 1024, 8)]));
  f.store.events.length = 0;
  await f.sync.validateHeads(f.inspection);
  assert.equal(
    f.store.events.filter((event) => event.op === "read" && event.id === f.image.id).length,
    0
  );
  await assert.rejects(f.sync.download(f.node.nodeId), code("remote-invalid"));
});
test("actionable unsupported RU/EN copy uses the existing error UI and disables automatic control", () => {
  const ui = readFileSync(
    new URL("../src/screens/terminal/GoogleDriveSettings.tsx", import.meta.url),
    "utf8"
  );
  assert.match(ui, /"unsupported-format":/);
  assert.match(ui, /status.error === "unsupported-format"/);
  const messages = load("i18n/messages-drive.ts").driveMessages;
  assert.ok(
    Object.values(messages).some(
      (message) => message.includes("Update the app") && message.includes("Data is retained")
    )
  );
});
