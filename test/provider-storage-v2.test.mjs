import test from "node:test";
import assert from "node:assert/strict";
import { createPortableFixture } from "./helpers/portable-database.mjs";
const ref = { provider: "bybit", category: "spot", symbol: "BTCUSDT" };
const id = "bybit:spot:BTCUSDT";
const row = (uid = "bank-uid") => ({
  symbol: uid === "bank-uid" ? "SBER" : uid,
  ticker: "BTCUSDT",
  uid,
  figi: null,
  name: "instrument",
  color: "#ffffff",
  mark: "B",
  currency: "USDT",
  step: 0.01,
  price: null,
  previousClose: null,
  availability: "pending",
  ...(uid === id ? { providerRef: ref, type: "crypto", comparisonBasis: "rolling-24h" } : {})
});
const backup = () => ({
  application: "personal-terminal",
  schemaVersion: 2,
  drawings: [],
  images: [],
  views: [],
  watchlist: [row(id)],
  layout: {
    symbol: id,
    instrumentUid: id,
    providerRef: ref,
    watchlistFlags: { [`uid:${id}`]: "red" }
  }
});

test("v2 atomically seeds legacy once; an old writer cannot overwrite mixed rows or annotations", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  await f.storage.saveWatchlist("A", [row()]);
  await f.storage.savePreferences("A", { symbol: "SBER" });
  await v2.prepareProfileV2("A");
  assert.equal((await v2.loadWatchlist("A"))[0].uid, "bank-uid");
  await v2.saveWatchlistSnapshot("A", [row(), row(id)]);
  await v2.saveDrawings("A", id, []);
  await f.storage.saveWatchlist("A", []);
  await f.storage.importBackup(
    "A",
    {
      application: "personal-terminal",
      schemaVersion: 1,
      drawings: [],
      images: [],
      layout: {},
      watchlist: [],
      views: []
    },
    { replacePortable: true }
  );
  const current = await v2.loadWatchlist("A");
  assert.deepEqual(
    Array.from(current, (r) => r.uid),
    ["bank-uid", id]
  );
  assert.equal(current[1].providerRef.category, "spot");
  assert.ok(f.database.stores.drawings.has(`profile-v2:A:${id}`));
  assert.equal((await f.storage.loadWatchlist("A")).length, 0);
});

test("failed initial copy writes neither partial data nor ready marker and can retry", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  await f.storage.savePreferences("A", { symbol: "SBER" });
  f.database.hooks.beforeWriteComplete = () => {
    throw new Error("disk failure");
  };
  await assert.rejects(v2.prepareProfileV2("A"));
  assert.ok(!f.database.stores.preferences.has("v2-profile-ready:A"));
  assert.ok(!f.database.stores.preferences.has("layout:profile-v2:A"));
  delete f.database.hooks.beforeWriteComplete;
  await v2.prepareProfileV2("A");
  assert.equal((await v2.loadPreferences("A")).symbol, "SBER");
  assert.ok(f.database.stores.preferences.has("layout:A"));
});

test("image migration projects logical owner; IDs separate while portable sync identity survives", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  const image = {
    id: "old",
    owner: "A",
    symbol: "SBER",
    name: "image",
    blob: new Blob(["x"], { type: "image/png" }),
    point: { timestamp: 1, value: 10 },
    width: 10,
    visible: true,
    createdAt: 1
  };
  const normal = f.load("services/types.ts").imageAsset;
  const source = normal(image);
  assert.ok(source, "valid fixture image");
  await f.storage.saveImage(source);
  await v2.prepareProfileV2("A");
  const [copied] = await v2.loadImages("A", "SBER");
  assert.equal(copied.owner, "A");
  assert.notEqual(copied.id, "old");
  assert.equal(copied.syncId, "old");
  copied.width = 20;
  await v2.saveImage(copied);
  assert.equal(f.database.stores.images.get(copied.id).owner, "profile-v2:A");
  assert.equal(f.database.stores.images.get("old").width, 10);
});

test("public to bank copies only public subset, preserves bank preferences, requires explicit merge", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  await v2.saveWatchlistSnapshot("public", [row(id)]);
  await v2.savePreferences(
    "public",
    f.json({
      symbol: id,
      instrumentUid: id,
      providerRef: ref,
      watchlistFlags: { [`uid:${id}`]: "red" }
    })
  );
  await v2.saveWatchlistSnapshot("A", [row()]);
  await v2.savePreferences(
    "A",
    f.json({ symbol: "SBER", timeframe: "1h", watchlistFlags: { "uid:bank-uid": "blue" } })
  );
  assert.equal((await v2.copyPublicProfile("public", "A", () => true)).conflict, false);
  const prefs = await v2.loadPreferences("A");
  assert.equal(prefs.symbol, "SBER");
  assert.equal(prefs.timeframe, "1h");
  assert.equal(prefs.watchlistFlags[`uid:${id}`], "red");
  assert.equal((await v2.copyPublicProfile("public", "A", () => true)).conflict, true);
  assert.equal((await v2.copyPublicProfile("public", "A", () => true, true)).conflict, false);
  assert.equal((await v2.loadWatchlist("A")).length, 2);
  assert.equal((await v2.loadWatchlist("public")).length, 1);
});

test("schema 2 roundtrips refs and flags; schema1/stripped/mismatched provider rows fail", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  const validate = f.load("model/backup-format.ts").validateBackup;
  validate(f.json(backup()));
  assert.throws(() => validate({ ...backup(), schemaVersion: 1 }));
  const stripped = backup();
  delete stripped.watchlist[0].providerRef;
  assert.throws(() => validate(stripped));
  const mismatch = backup();
  mismatch.watchlist[0].providerRef = { ...ref, category: "linear" };
  assert.throws(() => validate(mismatch));
  await v2.importBackup("public", f.json(backup()), { replacePortable: true });
  const exported = await v2.createBackup("public");
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.watchlist[0].providerRef.symbol, "BTCUSDT");
  assert.equal(exported.layout.watchlistFlags[`uid:${id}`], "red");
});

test("session abort during initial migration rolls back queued writes and ready marker", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts"),
    abort = new AbortController();
  await f.storage.savePreferences("A", { symbol: "SBER" });
  let entered, release;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    ready = new Promise((resolve) => {
      entered = resolve;
    });
  f.database.hooks.beforeWriteComplete = async () => {
    entered();
    await gate;
  };
  const migration = v2.prepareProfileV2("A", () => !abort.signal.aborted, abort.signal);
  const rejected = assert.rejects(migration, { name: "AbortError" });
  await ready;
  abort.abort();
  release();
  await rejected;
  assert.equal(f.database.stores.preferences.has("v2-profile-ready:A"), false);
  assert.equal(f.database.stores.preferences.has("layout:profile-v2:A"), false);
  delete f.database.hooks.beforeWriteComplete;
  await v2.prepareProfileV2("A");
  assert.equal((await v2.loadPreferences("A")).symbol, "SBER");
});

test("history export merges legacy bank cache and v2 overlap with newer v2 bars winning", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts"),
    codec = f.load("model/history-codec.ts"),
    format = f.load("model/backup-format.ts");
  await v2.prepareProfileV2("A");
  const bar = (timestamp, close) => ({ timestamp, open: 10, high: 12, low: 9, close, volume: 1 }),
    time = 1_700_000_000_000;
  for (const [owner, bars] of [
    ["A", [bar(time, 10), bar(time + 60_000, 10)]],
    ["profile-v2:A", [bar(time + 60_000, 11)]]
  ]) {
    const block = {
      id: owner + ":bank-uid:1m:2023-11-14",
      owner,
      uid: "bank-uid",
      timeframe: "1m",
      day: "2023-11-14",
      data: codec.encodeCandles(bars)
    };
    f.database.stores.history.set(block.id, block);
  }
  const exported = await v2.createBackup("A", { includeHistory: true });
  assert.equal(exported.history.length, 1);
  const bars = codec.decodeCandles(format.fromBase64(exported.history[0].data));
  assert.equal(bars.length, 2);
  assert.equal(bars[1].close, 11);
});
