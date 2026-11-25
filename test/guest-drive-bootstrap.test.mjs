import test from "node:test";
import assert from "node:assert/strict";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const target = "profile-v2:public",
  decision = "guest-public-adoption:v1",
  markerId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  otherId = "33333333-3333-4333-8333-333333333333";
const layout = {
  engine: "kline",
  rangeDays: 180,
  chartSettings: { theme: "light", grid: false, scaleFontSize: 13 }
};
const drive = () => ({
  id: "drive-v2:public",
  owner: "public",
  value: { schemaVersion: 1, markerId, deviceId, baseHeads: [], automatic: true }
});
const device = () => ({ id: "drive-device", value: deviceId });
async function fixture() {
  const f = await createGuestFixture();
  await f.storage.savePreferences("guest", layout);
  await f.storage.saveWatchlistSnapshot(target, []);
  await f.storageDB.put("preferences", {
    id: "v2-profile-ready:public",
    owner: target,
    value: true
  });
  return { ...f, recovery: f.load("services/storage-guest-recovery.ts") };
}

test("actual .18 loadDriveRecord empty bootstrap permits guest adoption without modifying Drive/device/source", async () => {
  const f = await fixture(),
    { loadDriveRecord } = f.load("services/drive/local.ts");
  await loadDriveRecord("public");
  const pref = f.database.stores.preferences,
    originalDrive = structuredClone(f.database.stores.preferences.get("drive-v2:public")),
    originalDevice = structuredClone(f.database.stores.preferences.get("drive-device")),
    originalGuest = structuredClone(f.database.stores.preferences.get("layout:guest"));
  assert.equal(Object.keys(originalDrive.value).length, 5);
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "copied");
  assert.deepEqual(await f.storage.loadPreferences(target), layout);
  assert.deepEqual(f.database.stores.preferences.get("drive-v2:public"), originalDrive);
  assert.deepEqual(f.database.stores.preferences.get("drive-device"), originalDevice);
  assert.deepEqual(f.database.stores.preferences.get("layout:guest"), originalGuest);
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "already-checked");
});

test("every unknown/linked/nonempty/extra/invalid-ID Drive shape keeps public occupied and remains untouched", async () => {
  const changes = [
    [
      "nonempty heads",
      (record) => {
        record.value.baseHeads = [otherId];
      }
    ],
    [
      "heads object",
      (record) => {
        record.value.baseHeads = { length: 0 };
      }
    ],
    [
      "heads extra",
      (record) => {
        record.value.baseHeads.extra = true;
      }
    ],
    [
      "schema 2",
      (record) => {
        record.value.schemaVersion = 2;
      }
    ],
    [
      "schema string",
      (record) => {
        record.value.schemaVersion = "1";
      }
    ],
    [
      "automatic false",
      (record) => {
        record.value.automatic = false;
      }
    ],
    [
      "automatic missing",
      (record) => {
        delete record.value.automatic;
      }
    ],
    [
      "marker missing",
      (record) => {
        delete record.value.markerId;
      }
    ],
    [
      "marker invalid",
      (record) => {
        record.value.markerId = "invalid";
      }
    ],
    [
      "marker wrong UUID version",
      (record) => {
        record.value.markerId = "11111111-1111-1111-8111-111111111111";
      }
    ],
    [
      "device mismatched",
      (record) => {
        record.value.deviceId = otherId;
      }
    ],
    [
      "device invalid",
      (record) => {
        record.value.deviceId = "invalid";
      }
    ],
    [
      "device missing",
      (record) => {
        delete record.value.deviceId;
      }
    ],
    [
      "device entry absent",
      (_record, _device, pref) => {
        pref.delete("drive-device");
      }
    ],
    [
      "device entry wrong UUID",
      (_record, device) => {
        device.value = otherId;
      }
    ],
    [
      "device entry invalid",
      (_record, device) => {
        device.value = "invalid";
      }
    ],
    [
      "device entry extra",
      (_record, device) => {
        device.owner = "public";
      }
    ],
    [
      "record owner wrong",
      (record) => {
        record.owner = target;
      }
    ],
    [
      "record extra",
      (record) => {
        record.extra = true;
      }
    ],
    [
      "unknown public key",
      (_record, _device, pref) => {
        pref.set("drive-extra:public", { id: "drive-extra:public", owner: "public", value: {} });
      }
    ],
    ...[
      "linked",
      "linkedHead",
      "head",
      "lastSyncedDigest",
      "lastSyncedAt",
      "pendingChanges",
      "extra"
    ].map((key) => [
      key,
      (record) => {
        record.value[key] = false;
      }
    ]),
    [
      "undefined extra",
      (record) => {
        record.value.extra = undefined;
      }
    ]
  ];
  for (const [name, change] of changes) {
    const f = await fixture(),
      pref = f.database.stores.preferences,
      record = drive(),
      currentDevice = device();
    pref.set("drive-v2:public", record);
    pref.set("drive-device", currentDevice);
    change(record, currentDevice, pref);
    const before = structuredClone([...pref]);
    assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "target-occupied", name);
    assert.equal(f.database.stores.preferences.has(`layout:${target}`), false, name);
    for (const [id, value] of before)
      assert.deepEqual(f.database.stores.preferences.get(id), value, `${name}/${id}`);
    assert.equal(f.database.stores.preferences.get(decision).value.status, "target-occupied");
  }
});

test("inert Drive never bypasses a real public layout or an already-recorded occupied decision", async () => {
  for (const existing of ["layout", "decision"]) {
    const f = await fixture(),
      pref = f.database.stores.preferences;
    pref.set("drive-v2:public", drive());
    pref.set("drive-device", device());
    if (existing === "layout") await f.storage.savePreferences(target, {});
    else
      await f.storageDB.put("preferences", {
        id: decision,
        owner: target,
        value: { status: "target-occupied" }
      });
    assert.equal(
      await f.recovery.adoptLegacyGuestWorkspace(() => true),
      existing === "layout" ? "target-occupied" : "already-checked"
    );
    assert.deepEqual(
      f.database.stores.preferences.get(`layout:${target}`)?.value,
      existing === "layout" ? {} : undefined
    );
    assert.deepEqual(f.database.stores.preferences.get("drive-v2:public"), drive());
  }
});

test("strict bootstrap checker rejects accessors/prototypes/symbols and wrong envelope IDs without reading accessors", async () => {
  const f = await createGuestFixture(),
    { isInertPublicDriveBootstrap } = f.load("services/storage-guest-drive-bootstrap.ts");
  assert.equal(isInertPublicDriveBootstrap(drive(), device()), true);
  let reads = 0;
  const accessor = drive();
  Object.defineProperty(accessor.value, "markerId", {
    enumerable: true,
    get() {
      reads++;
      return markerId;
    }
  });
  const symbol = drive();
  symbol.value[Symbol("extra")] = true;
  const prototype = drive();
  Object.setPrototypeOf(prototype.value, { extra: true });
  const wrongRecord = drive();
  wrongRecord.id = "drive-v2:other";
  const wrongDevice = device();
  wrongDevice.id = "device-key";
  for (const record of [accessor, symbol, prototype, wrongRecord, [], null])
    assert.equal(isInertPublicDriveBootstrap(record, device()), false);
  assert.equal(isInertPublicDriveBootstrap(drive(), wrongDevice), false);
  assert.equal(reads, 0);
});
