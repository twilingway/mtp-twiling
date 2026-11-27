import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, localBackend } from "./helpers/yandex-source.mjs";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";

const load = sourceLoader(),
  { defaultCloudClientMode, CLOUD_TEST_CLIENT_ID, cloudClientLabel } = load(
    "model/cloud-client-identity.ts"
  ),
  { YandexJournal } = load("services/yandex/journal.ts");
const key = "mtp:yandex:device:device-id",
  settingsKey = "mtp:yandex:device:settings";
test("partial document environments keep fresh cloud factories disabled and preserve explicit default policy", async () => {
  const oldDocument = globalThis.document,
    oldLocation = globalThis.location;
  try {
    globalThis.document = { visibilityState: "visible", baseURI: "https://mtp.twiling.ru/" };
    const f = await createGuestFixture();
    const google = f.load("services/drive/device-slot-identity.ts"),
      { initialGoogleSlotStatus } = f.load("services/drive/device-slot-status.ts"),
      { initialYandexClientStatus } = f.load("services/yandex/coordinator-identity.ts");
    const journal = new YandexJournal(async () => await localBackend());
    for (const [pathname, expected] of [
      ["/", "normal"],
      ["/__dev/app/index.html", "test"]
    ]) {
      globalThis.location = { pathname, search: "" };
      assert.equal(google.defaultDriveSlotMode(), expected);
      assert.equal(initialGoogleSlotStatus().clientMode, expected);
      assert.equal(initialYandexClientStatus(true).clientMode, expected);
      assert.equal((await journal.settings()).clientMode, expected);
      assert.equal(initialGoogleSlotStatus().enabled, false);
      assert.equal(initialYandexClientStatus(true).enabled, false);
    }
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
  }
});
test("fresh client policy is shared by explicit DEV/Testing signals and never guesses private browsing", () => {
  assert.equal(defaultCloudClientMode(), "normal");
  for (const pathname of ["/", "/__dev", "/__dev/app-copy", "/other"]) {
    assert.equal(
      defaultCloudClientMode({ pathname, search: "?private=true&incognito=1" }),
      "normal"
    );
    assert.equal(defaultCloudClientMode({ pathname, search: "?sync-client=testing" }), "test");
  }
  for (const pathname of ["/__dev/app", "/__dev/app/", "/__dev/app/index.html"])
    assert.equal(defaultCloudClientMode({ pathname, search: "" }), "test");
  assert.equal(defaultCloudClientMode({ pathname: "/", search: "" }, true), "test");
  assert.equal(cloudClientLabel("normal"), "Этот браузер");
  assert.equal(cloudClientLabel("test"), "Тестирование");
  assert.equal(CLOUD_TEST_CLIENT_ID, "00000000-0000-4000-8000-000000000001");
});

test("Yandex preserves its existing normal UUID and independent browser identities while Testing shares only the reserved client", async () => {
  const first = await localBackend(),
    second = await localBackend(),
    prior = crypto.randomUUID();
  first.records.set(key, prior);
  const a = new YandexJournal(async () => first),
    b = new YandexJournal(async () => second);
  await a.saveSettings(
    { enabled: false, automatic: false, clientMode: "normal" },
    new AbortController().signal
  );
  await b.saveSettings(
    { enabled: false, automatic: false, clientMode: "normal" },
    new AbortController().signal
  );
  assert.equal(await a.deviceId(), prior);
  const other = await b.deviceId();
  assert.notEqual(other, prior);
  for (const journal of [a, b])
    await journal.saveSettings(
      { enabled: false, automatic: false, clientMode: "test" },
      new AbortController().signal
    );
  assert.equal(await a.deviceId(), CLOUD_TEST_CLIENT_ID);
  assert.equal(await b.deviceId(), CLOUD_TEST_CLIENT_ID);
  assert.equal(first.records.get(key), prior);
  assert.equal(second.records.get(key), other);
  await a.saveSettings({ enabled: false, automatic: true }, new AbortController().signal);
  assert.equal(
    (await a.settings()).clientMode,
    "test",
    "unrelated preferences preserve a saved client choice"
  );
  await a.saveSettings(
    { enabled: false, automatic: true, clientMode: "normal" },
    new AbortController().signal
  );
  assert.equal(await new YandexJournal(async () => first).deviceId(), prior);
});

test("a saved normal choice survives a DEV default and an invalid saved mode or identity fails closed", async () => {
  const oldLocation = globalThis.location,
    oldDocument = globalThis.document;
  const backend = await localBackend();
  try {
    globalThis.location = { pathname: "/__dev/app/index.html", search: "" };
    globalThis.document = { querySelector: () => ({}) };
    const journal = new YandexJournal(async () => backend);
    assert.equal((await journal.settings()).clientMode, "test");
    assert.equal(await journal.deviceId(), CLOUD_TEST_CLIENT_ID);
    assert.equal(backend.records.has(key), false);
    await journal.saveSettings(
      { enabled: false, automatic: false, clientMode: "normal" },
      new AbortController().signal
    );
    const normal = await journal.deviceId();
    assert.notEqual(normal, CLOUD_TEST_CLIENT_ID);
    assert.equal((await new YandexJournal(async () => backend).settings()).clientMode, "normal");
    const { YandexCoordinator } = load("services/yandex/coordinator.ts");
    const coordinator = new YandexCoordinator({ scope: () => ({ ready: false }) }, undefined, {
      journal
    });
    try {
      // A preference intent before cold prepare must not replace the saved normal choice.
      await coordinator.setAutomatic(true);
      assert.equal(coordinator.getSnapshot().clientMode, "normal");
      assert.equal((await journal.settings()).clientMode, "normal");
      assert.equal(coordinator.getSnapshot().enabled, false);
    } finally {
      coordinator.dispose();
    }
    backend.records.set(key, "invalid-existing-identity");
    await assert.rejects(journal.deviceId(), { code: "local-save" });
    assert.equal(backend.records.get(key), "invalid-existing-identity");
    backend.records.set(settingsKey, { enabled: false, automatic: false, clientMode: "future" });
    await assert.rejects(journal.settings(), { code: "local-save" });
    assert.equal(backend.records.get(settingsKey).clientMode, "future");
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

test("actual Yandex local adapter creates one durable UUID across concurrent tab transactions and retries failed creation", async () => {
  const f = await createGuestFixture();
  const { yandexLocalStore } = f.load("services/yandex/local.ts"),
    { YandexJournal: Journal } = f.load("services/yandex/journal.ts");
  const a = new Journal(yandexLocalStore),
    b = new Journal(yandexLocalStore);
  let writes = 0;
  f.database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => {
    if (record?.id === key) writes++;
  };
  const [first, second] = await Promise.all([a.deviceId(), b.deviceId()]);
  assert.equal(first, second);
  assert.equal(writes, 1);
  assert.equal(f.database.stores.vault.get(key).value, first);
  assert.equal(await new Journal(yandexLocalStore).deviceId(), first);
  f.database.stores.vault.delete(key);
  f.database.hooks.beforeWriteComplete = (_tx, _store, _kind, record) => {
    if (record?.id === key) throw new DOMException("synthetic full", "QuotaExceededError");
  };
  await assert.rejects(a.deviceId(), { name: "QuotaExceededError" });
  assert.equal(f.database.stores.vault.has(key), false);
  delete f.database.hooks.beforeWriteComplete;
  const retried = await b.deviceId();
  assert.equal(f.database.stores.vault.get(key).value, retried);
  assert.equal(await a.deviceId(), retried);
});
