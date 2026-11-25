import test from "node:test";
import assert from "node:assert/strict";
import { createGuestFixture } from "./helpers/guest-recovery-database.mjs";
const target = "profile-v2:public",
  marker = "guest-public-adoption:v1";
const layout = {
  engine: "kline",
  rangeDays: 180,
  symbol: "SBER",
  timeframe: "1d",
  chartSettings: { theme: "light", grid: false, scaleFontSize: 13 }
};
const row = {
  symbol: "SBER",
  ticker: "SBER",
  name: "Sber",
  uid: "bank-uid",
  figi: null,
  color: "#ffffff",
  mark: "S",
  currency: "rub",
  step: 1,
  price: null,
  previousClose: null,
  availability: "pending"
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const f = await createGuestFixture(),
    recovery = f.load("services/storage-guest-recovery.ts");
  await f.storage.savePreferences("guest", structuredClone(layout));
  await f.storage.saveWatchlistSnapshot("guest", [row]);
  await f.storage.saveView("guest", "SBER:1d:kline:180", {
    camera: { barSpace: 9, rightOffsetBars: -2 }
  });
  await f.storage.saveDrawings("guest", "SBER", [
    { id: "drawing", name: "horizontalStraightLine", points: [{ timestamp: 1, value: 10 }] }
  ]);
  await f.storage.saveImage({
    id: "old-image",
    owner: "guest",
    symbol: "SBER",
    name: "image",
    blob: new Blob(["img"], { type: "image/png" }),
    point: { timestamp: 1, value: 10 },
    width: 100
  });
  await f.storage.saveHistory(
    "guest",
    "bank-uid",
    "1d",
    [{ timestamp: 1700000000000, open: 1, high: 2, low: 1, close: 2, volume: 1 }],
    { from: 1, to: 2, fetchedAt: 3 }
  );
  // Fixtures only: sentinel credentials/bank data must never be requested by the recovery code.
  f.database.stores.vault.set("device-key", { id: "device-key", key: "sentinel-not-a-key" });
  f.database.stores.preferences.set("session", {
    id: "session",
    owner: "bank-A",
    value: "sentinel-not-a-token"
  });
  f.database.stores.preferences.set("layout:bank-A", {
    id: "layout:bank-A",
    owner: "bank-A",
    value: { symbol: "PRIVATE" }
  });
  f.database.stores.drawings.set("bank-A:PRIVATE", {
    id: "bank-A:PRIVATE",
    owner: "bank-A",
    symbol: "PRIVATE",
    items: []
  });
  f.database.reads.length = 0;
  return { ...f, recovery };
}
const record = (id, owner, value) => ({ id, owner, value });
const dump = (f) =>
  structuredClone(
    Object.fromEntries(Object.entries(f.database.stores).map(([name, map]) => [name, [...map]]))
  );
function assertPrivateUnread(f) {
  assert.ok(f.database.transactions.every((tx) => !tx.names.includes("vault")));
  assert.ok(f.database.reads.every((read) => read.key !== "session" && read.owner !== "bank-A"));
}

test("actual DB copies .17 settings plus portable/history/coverage once, even with ready marker and empty bootstrap, preserving source and secrets", async () => {
  const f = await fixture();
  await f.storage.saveWatchlistSnapshot(target, []);
  await f.storageDB.put("preferences", record("v2-profile-ready:public", target, true));
  const before = dump(f);
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "copied");
  assert.deepEqual(await f.storage.loadPreferences(target), layout);
  assert.equal((await f.storage.loadWatchlist(target))[0].uid, "bank-uid");
  assert.equal(f.database.stores.preferences.get(marker).value.status, "copied");
  const image = [...f.database.stores.images.values()].find((value) => value.owner === target);
  assert.equal(image.syncId, "old-image");
  assert.notEqual(image.id, "old-image");
  assert.equal(await image.blob.text(), "img");
  const oldBlock = [...f.database.stores.history.values()].find((value) => value.owner === "guest"),
    newBlock = [...f.database.stores.history.values()].find((value) => value.owner === target);
  assert.deepEqual(new Uint8Array(newBlock.data), new Uint8Array(oldBlock.data));
  assert.equal(
    [...f.database.stores.coverage.values()].filter((value) => value.owner === target).length,
    1
  );
  for (const [store, records] of Object.entries(before))
    for (const [id, value] of records)
      if (value.owner !== target)
        assert.deepEqual(f.database.stores[store].get(id), value, `${store}/${id}`);
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "already-checked");
  assert.equal(
    [...f.database.stores.images.values()].filter((value) => value.owner === target).length,
    1
  );
  assertPrivateUnread(f);
});

test("every occupied public category including a defaults layout is retained; subsequent clearing never triggers automatic restore", async () => {
  for (const category of [
    "layout",
    "defaults",
    "watchlist",
    "view",
    "camera",
    "unknown",
    "drawings",
    "images",
    "history",
    "coverage",
    "raw-public"
  ]) {
    const f = await fixture();
    if (category === "layout") await f.storage.savePreferences(target, {});
    if (category === "defaults")
      await f.storage.savePreferences(
        target,
        f.load("screens/terminal/controller-bridge.ts").defaultPreferences()
      );
    if (category === "watchlist") await f.storage.saveWatchlistSnapshot(target, [row]);
    if (category === "view") await f.storage.saveView(target, "SBER:1d:kline:180", {});
    if (category === "camera" || category === "unknown")
      await f.storageDB.put("preferences", record(`${category}:${target}:x`, target, {}));
    if (category === "drawings") await f.storage.saveDrawings(target, "SBER", []);
    if (category === "images")
      await f.storage.saveImage({
        id: "target-image",
        owner: target,
        symbol: "SBER",
        name: "",
        blob: new Blob(["x"], { type: "image/png" }),
        point: { timestamp: 1, value: 1 },
        width: 1
      });
    if (category === "history" || category === "coverage")
      f.database.stores[category].set(`${target}:x`, { id: `${target}:x`, owner: target });
    if (category === "raw-public") await f.storage.savePreferences("public", { rangeDays: 365 });
    const before = dump(f);
    assert.equal(
      await f.recovery.adoptLegacyGuestWorkspace(() => true),
      "target-occupied",
      category
    );
    for (const [store, records] of Object.entries(before))
      for (const [id, value] of records) assert.deepEqual(f.database.stores[store].get(id), value);
    for (const [store, map] of Object.entries(f.database.stores))
      for (const [id, value] of map)
        if (value.owner === target && id !== marker) f.database.stores[store].delete(id);
    assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "already-checked");
    assert.equal(f.database.stores.preferences.has(`layout:${target}`), false);
    assertPrivateUnread(f);
  }
});

test("source-empty decision prevents old writers unexpectedly filling an explicitly empty public later", async () => {
  const f = await createGuestFixture(),
    recovery = f.load("services/storage-guest-recovery.ts");
  assert.equal(await recovery.adoptLegacyGuestWorkspace(() => true), "source-empty");
  await f.storage.savePreferences("guest", layout);
  assert.equal(await recovery.adoptLegacyGuestWorkspace(() => true), "already-checked");
  assert.equal(f.database.stores.preferences.has(`layout:${target}`), false);
});

test("quota/corrupt/abort leave no partial target or successful decision and permit retry", async () => {
  for (const failure of ["quota", "corrupt", "abort", "invalid-fence"]) {
    const f = await fixture(),
      abort = new AbortController();
    let valid = true;
    if (failure === "corrupt")
      f.database.stores.preferences.get("layout:guest").value.rangeDays = -1;
    if (failure === "quota")
      f.database.hooks.beforeWriteComplete = () => {
        throw new DOMException("full", "QuotaExceededError");
      };
    if (failure === "abort" || failure === "invalid-fence")
      f.database.hooks.beforeReadComplete = () => {
        if (failure === "abort") abort.abort();
        else valid = false;
      };
    if (["abort", "invalid-fence"].includes(failure))
      await assert.rejects(f.recovery.adoptLegacyGuestWorkspace(() => valid, abort.signal));
    else
      assert.equal(
        await f.recovery.adoptLegacyGuestWorkspace(() => true),
        failure === "corrupt" ? "source-invalid" : "quota-failed"
      );
    assert.equal(f.database.stores.preferences.has(marker), false);
    assert.ok(
      Object.values(f.database.stores).every(
        (map) => ![...map.values()].some((value) => value.owner === target)
      )
    );
    delete f.database.hooks.beforeWriteComplete;
    delete f.database.hooks.beforeReadComplete;
    f.database.stores.preferences.get("layout:guest").value = layout;
    assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "copied");
    assertPrivateUnread(f);
  }
});

test("concurrent adoption is serialized at DB boundary and a previously queued target edit wins", async () => {
  const f = await fixture();
  assert.deepEqual(
    await Promise.all([
      f.recovery.adoptLegacyGuestWorkspace(() => true),
      f.recovery.adoptLegacyGuestWorkspace(() => true)
    ]),
    ["copied", "already-checked"]
  );
  const other = await fixture(),
    entered = deferred(),
    release = deferred();
  other.database.hooks.beforeWriteComplete = async () => {
    entered.resolve();
    await release.promise;
  };
  const edit = other.storage.savePreferences(target, { engine: "tradingview" });
  await entered.promise;
  const copy = other.recovery.adoptLegacyGuestWorkspace(() => true);
  release.resolve();
  await edit;
  assert.equal(await copy, "target-occupied");
  assert.equal((await other.storage.loadPreferences(target)).engine, "tradingview");
});

test("native commit remains copied after a late abort; raw guest offline JSON export roundtrips without a guest-v2 marker", async () => {
  const f = await fixture(),
    abort = new AbortController();
  f.database.hooks.afterNativeCommit = (tx) => {
    if (tx.mode === "readwrite") abort.abort();
  };
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true, abort.signal), "copied");
  delete f.database.hooks.afterNativeCommit;
  const backup = await f.recovery.createLegacyGuestBackup({ includeHistory: true });
  assert.deepEqual(backup.layout, layout);
  assert.equal(backup.history.length, 1);
  assert.equal(backup.images.length, 1);
  assert.equal(f.database.stores.preferences.has("v2-profile-ready:guest"), false);
  assert.equal(f.database.stores.preferences.has("layout:profile-v2:guest"), false);
  assertPrivateUnread(f);
  await f.storage.importBackup("restore-test", JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(await f.storage.loadPreferences("restore-test"), layout);
});

test("abort during queued writes rolls back every copied store and malformed source cannot bypass an occupied decision", async () => {
  const f = await fixture(),
    abort = new AbortController(),
    entered = deferred(),
    release = deferred();
  f.database.hooks.beforeWriteComplete = async () => {
    entered.resolve();
    await release.promise;
  };
  const copying = f.recovery.adoptLegacyGuestWorkspace(() => true, abort.signal);
  await entered.promise;
  abort.abort();
  release.resolve();
  await assert.rejects(copying, { name: "AbortError" });
  assert.equal(f.database.stores.preferences.has(marker), false);
  assert.ok(
    Object.values(f.database.stores).every(
      (map) => ![...map.values()].some((value) => value.owner === target)
    )
  );
  const other = await fixture();
  await other.storage.savePreferences(target, {});
  other.database.stores.preferences.get("layout:guest").value.rangeDays = -1;
  assert.equal(await other.recovery.adoptLegacyGuestWorkspace(() => true), "target-occupied");
  assert.equal(other.database.stores.preferences.get(marker).value.status, "target-occupied");
});

test("deep portable projection excludes unknown auth fields and shared camera extras without modifying guest", async () => {
  const f = await fixture();
  const raw = f.database.stores.preferences.get("layout:guest");
  raw.value.apiToken = "never-export-sentinel";
  await f.storageDB.put(
    "preferences",
    record("chart-camera:guest:kline:1d", "guest", {
      symbol: "SBER",
      camera: { barSpace: 10, rightOffsetBars: -1, token: "never-export-sentinel" }
    })
  );
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "copied");
  const copied = f.database.stores.preferences.get(`chart-camera:${target}:kline:1d`);
  assert.deepEqual(copied.value, { symbol: "SBER", camera: { barSpace: 10, rightOffsetBars: -1 } });
  assert.equal(f.database.stores.preferences.get(`layout:${target}`).value.apiToken, undefined);
  assert.equal(
    f.database.stores.preferences.get("layout:guest").value.apiToken,
    "never-export-sentinel"
  );
  const exported = await f.recovery.createLegacyGuestBackup();
  assert.doesNotMatch(JSON.stringify(exported), /never-export-sentinel/);
  assertPrivateUnread(f);
});

test("manual export without history never reads large/corrupt candle payloads and remains available after adoption fails", async () => {
  const f = await fixture(),
    block = [...f.database.stores.history.values()][0];
  block.data = new ArrayBuffer(3);
  assert.equal(await f.recovery.adoptLegacyGuestWorkspace(() => true), "source-invalid");
  f.database.reads.length = 0;
  const backup = await f.recovery.createLegacyGuestBackup({ includeHistory: false });
  assert.deepEqual(backup.layout, layout);
  assert.deepEqual(backup.history, []);
  assert.equal(f.database.reads.filter((read) => read.store === "history").length, 0);
  await assert.rejects(f.recovery.createLegacyGuestBackup({ includeHistory: true }));
});
