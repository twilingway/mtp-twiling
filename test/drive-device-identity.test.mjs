import assert from "node:assert/strict";
import test from "node:test";
import { root, sourceLoader } from "./drive-reader-guard-helpers.mjs";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const deviceKey = "drive-device";
const ownerKey = (owner) => `drive-v2:${owner}`;
const oldDevice = "12345678-1234-4ABC-9ABC-ABCDEF123456";
const oldMarker = "abcdef12-abcd-4abc-8abc-abcdef123456";
const workspace = "00000000-0000-4000-8000-000000000002";
const otherWorkspace = "00000000-0000-4000-8000-000000000003";

async function browserTabs() {
  const browser = await createGuestFixture();
  const otherTab = sourceLoader(root, { "services/storage-db.ts": browser.storageDB });
  const first = browser.load("services/drive/local.ts").loadDriveRecord;
  const second = otherTab("services/drive/local.ts").loadDriveRecord;
  assert.notEqual(first, second);
  return {
    database: browser.database,
    first,
    second,
    identity: browser.load("services/drive/device-slot-identity.ts"),
    otherIdentity: otherTab("services/drive/device-slot-identity.ts"),
    model: browser.load("services/drive/device-slot-model.ts")
  };
}

test("the browser's first concurrent tabs commit a common device ID and one association per owner", async () => {
  const { database, first, second } = await browserTabs();
  const writes = [];
  database.hooks.beforeWriteComplete = (tx, store, kind, record) => {
    writes.push({ tx, store, kind, id: record.id });
  };
  const [left, right, sameOwner] = await Promise.all([first("A"), second("B"), second("A")]);
  assert.match(left.deviceId, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i);
  assert.equal(right.deviceId, left.deviceId);
  assert.equal(sameOwner.deviceId, left.deviceId);
  assert.equal(sameOwner.markerId, left.markerId);
  assert.notEqual(right.markerId, left.markerId);
  assert.deepEqual(writes.map(({ id }) => id).sort(), [deviceKey, ownerKey("A"), ownerKey("B")]);
  assert.equal(writes[0].tx, writes[1].tx, "the initial UUID and first owner commit together");
  assert.ok(
    writes.every(
      ({ tx, store, kind }) =>
        tx.mode === "readwrite" &&
        tx.state === "finished" &&
        store === "preferences" &&
        kind === "put"
    )
  );
  const records = database.stores.preferences;
  assert.equal(records.get(deviceKey).value, left.deviceId);
  assert.equal(records.get(ownerKey("A")).value.markerId, left.markerId);
  assert.equal(records.get(ownerKey("B")).value.markerId, right.markerId);
});

test("a valid stored browser UUID and existing association are reused without writes to either record", async () => {
  const { database, first, second } = await browserTabs();
  const records = database.stores.preferences;
  const old = {
    id: ownerKey("existing-owner"),
    owner: "existing-owner",
    value: {
      schemaVersion: 1,
      markerId: oldMarker,
      deviceId: oldDevice,
      baseHeads: [oldMarker],
      automatic: false
    }
  };
  records.set(deviceKey, { id: deviceKey, value: oldDevice });
  records.set(old.id, old);
  const writes = [];
  database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => writes.push(record.id);
  const [fresh, existing] = await Promise.all([first("new-owner"), second(old.owner)]);
  assert.equal(fresh.deviceId, oldDevice);
  assert.equal(existing.deviceId, oldDevice);
  assert.equal(existing.markerId, oldMarker);
  assert.equal(existing.automatic, false);
  assert.deepEqual(existing.baseHeads, old.value.baseHeads);
  assert.deepEqual(writes, [ownerKey("new-owner")]);
  assert.deepEqual(database.stores.preferences.get(deviceKey), { id: deviceKey, value: oldDevice });
  assert.deepEqual(database.stores.preferences.get(old.id), old);
});

test("a failed first owner write rolls back device creation and can be retried", async () => {
  const { database, first, second } = await browserTabs();
  const owner = "A";
  const failure = new DOMException("Synthetic write failure", "QuotaExceededError");
  database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => {
    if (record.id === ownerKey(owner)) throw failure;
  };
  await assert.rejects(first(owner), { name: failure.name, message: failure.message });
  assert.equal(database.stores.preferences.has(deviceKey), false);
  assert.equal(database.stores.preferences.has(ownerKey(owner)), false);
  database.hooks.beforeWriteComplete = undefined;
  const record = await second(owner);
  assert.equal(database.stores.preferences.get(deviceKey).value, record.deviceId);
  assert.equal(database.stores.preferences.get(ownerKey(owner)).value.markerId, record.markerId);
});

test("normal v3 identity shares the atomic browser ID with concurrent legacy initialization", async () => {
  const { database, first, identity, otherIdentity } = await browserTabs();
  const [normal, old, another] = await Promise.all([
    identity.loadDriveDeviceId(workspace, "normal"),
    first("A"),
    otherIdentity.loadDriveDeviceId(otherWorkspace, "normal")
  ]);
  assert.equal(normal, old.deviceId);
  assert.equal(another, normal);
  assert.equal(database.stores.preferences.get(deviceKey).value, normal);
});

test("normal v3 identity accepts a legacy UUID without rewriting its original case", async () => {
  const { database, first, identity } = await browserTabs();
  database.stores.preferences.set(deviceKey, { id: deviceKey, value: oldDevice });
  assert.equal(await identity.loadDriveDeviceId(workspace), oldDevice.toLowerCase());
  assert.equal((await first("A")).deviceId, oldDevice);
  assert.equal(database.stores.preferences.get(deviceKey).value, oldDevice);
});

test("explicit testing shares a reserved ID without reading or writing device or profile data", async () => {
  const { database, identity, model, otherIdentity } = await browserTabs();
  assert.equal(await identity.loadDriveSlotMode(workspace), "normal");
  database.reads.length = 0;
  database.transactions.length = 0;
  const testId = await identity.loadDriveDeviceId(workspace, "test");
  assert.equal(testId, model.DEVICE_SLOT_TEST_DEVICE_ID);
  assert.equal(testId, await otherIdentity.loadDriveDeviceId(workspace, "test"));
  assert.deepEqual(database.reads, []);
  assert.deepEqual(database.transactions, []);
  assert.equal(database.stores.preferences.size, 0);
  assert.notEqual(
    model.deviceSlotKey(workspace, testId),
    model.deviceSlotKey(otherWorkspace, testId)
  );
});

test("mode selection is isolated per workspace and invalid state never falls back to normal", async () => {
  const { database, identity, otherIdentity } = await browserTabs();
  await identity.saveDriveSlotMode(workspace, "test");
  assert.equal(await otherIdentity.loadDriveSlotMode(workspace), "test");
  assert.equal(await otherIdentity.loadDriveSlotMode(otherWorkspace), "normal");
  assert.equal(
    await otherIdentity.loadDriveDeviceId(workspace),
    identity.DEVICE_SLOT_TEST_DEVICE_ID
  );
  assert.equal(database.stores.preferences.has(deviceKey), false);
  const id = `drive-slot-mode:${workspace}`;
  database.stores.preferences.set(id, { id, value: "unknown" });
  await assert.rejects(identity.loadDriveDeviceId(workspace), { code: "remote-invalid" });
  await assert.rejects(identity.saveDriveSlotMode(workspace, "unknown"), {
    code: "remote-invalid"
  });
  await assert.rejects(identity.loadDriveDeviceId("profile-A", "test"), { code: "remote-invalid" });
  assert.equal(database.stores.preferences.has(deviceKey), false);
});
