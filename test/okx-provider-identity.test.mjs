import test from "node:test";
import assert from "node:assert/strict";
import { createPortableFixture } from "./helpers/portable-database.mjs";
import { backup, root, sourceLoader, Store } from "./drive-reader-guard-helpers.mjs";

const ref = { provider: "okx", category: "spot", symbol: "BTC-USDT" };
const id = "okx:spot:BTC-USDT";
const viewKey = `${id}:1d:kline:90`;
const point = { timestamp: 1_700_000_000_000, value: 10 };
const view = { from: 1, to: 2 };
const drawing = { id: "price-line", name: "horizontalStraightLine", points: [point] };
const image = {
  id: "retained-image",
  symbol: id,
  type: "image/png",
  point,
  width: 20,
  data: "eA=="
};
const bybitRef = { provider: "bybit", category: "spot", symbol: "BTCUSDT" };
const bybitId = "bybit:spot:BTCUSDT";
const row = (uid, providerRef) => ({
  uid,
  symbol: uid,
  name: "Bitcoin",
  ticker: providerRef.symbol,
  providerRef,
  type: "crypto"
});
const detachedBackup = () => ({
  ...backup(),
  drawings: [{ symbol: id, items: [drawing] }],
  images: [image],
  views: [{ key: viewKey, value: view }]
});
const load = sourceLoader(root);

test("OKX and legacy Bybit references retain independent canonical identities", () => {
  const { providerSeriesId, providerRefFromId, validProviderIdentity, isBankIdentity } = load(
    "model/market-provider.ts"
  );
  assert.equal(providerSeriesId(ref), id);
  assert.deepEqual(providerRefFromId(id), ref);
  assert.equal(providerSeriesId(bybitRef), bybitId);
  assert.deepEqual(providerRefFromId(bybitId), bybitRef);
  const linear = { provider: "okx", category: "linear", symbol: "BTC-USDT-SWAP" };
  assert.deepEqual(providerRefFromId(providerSeriesId(linear)), linear);
  assert.equal(providerSeriesId(linear), "okx:linear:BTC-USDT-SWAP");
  assert.equal(validProviderIdentity(row(id, ref)), true);
  assert.equal(validProviderIdentity(row(bybitId, ref)), false);
  for (const invalid of [
    "okx:spot:BTC-USDT-SWAP",
    "okx:linear:BTC-USD-SWAP",
    "okx:spot:BTCUSDT",
    "okx:spot:btc-usdt",
    "okx:spot:BTC--USDT",
    "okx:spot:BTC-USDT:tail",
    "OKX:spot:BTC-USDT"
  ]) {
    assert.equal(providerRefFromId(invalid), null);
    assert.equal(isBankIdentity({ uid: invalid }), false);
    assert.equal(isBankIdentity({ symbol: invalid }), false);
  }
  assert.equal(isBankIdentity({ uid: "uid-bank", symbol: "SBER" }), true);
});

test("bank transport rejects even malformed public IDs and refs before network or cache access", async () => {
  const { assertBankRequest, bankCacheView } = load("services/market-bank-cache.ts");
  assert.throws(() => assertBankRequest({ instruments: [id] }), /OKX/);
  assert.throws(() => assertBankRequest({ instruments: [" okx:unknown:broken"] }), /OKX/);
  assert.throws(() => assertBankRequest({ item: { provider: "OKX" } }), /OKX/);
  assert.throws(() => assertBankRequest({ instruments: [bybitId] }), /Bybit/);
  assert.doesNotThrow(() => assertBankRequest({ instruments: ["uid-bank", "SBER"] }));
  const rows = [{ uid: "uid-bank", symbol: "SBER" }, row(id, ref), row(bybitId, bybitRef)];
  const cache = bankCacheView({
    loadWatchlist: async () => rows,
    loadMarket: async () => ({ rows, at: 17 })
  });
  assert.deepEqual(await cache.loadWatchlist("profile"), [rows[0]]);
  assert.deepEqual(await cache.loadMarket("profile"), { rows: [rows[0]], at: 17 });
  let calls = 0;
  const { marketCalendar } = sourceLoader(root, {
    "services/tbank-calendar.ts": {
      loadCandleCalendar: async () => {
        calls++;
        return [];
      }
    }
  })("services/market-calendar.ts");
  const query = (uid) =>
    marketCalendar(
      { bankClient: {} },
      uid,
      point.timestamp,
      "1d",
      point.timestamp,
      new AbortController().signal,
      () => true
    );
  await query(id);
  await query("okx:spot:wrong");
  await query(bybitId);
  assert.equal(calls, 0);
  await query("uid-bank");
  assert.equal(calls, 1);
});

test("manual backup and public profile copy retain OKX flags and detached annotations", async () => {
  const f = await createPortableFixture();
  const storage = f.load("services/storage-v2.ts");
  const input = {
    ...detachedBackup(),
    layout: { symbol: "SBER", watchlistFlags: { [`uid:${id}`]: "pink" } },
    watchlist: [row(id, ref), row(bybitId, bybitRef)]
  };
  await storage.importBackup("public", f.json(input), { replacePortable: true });
  assert.deepEqual(
    (await storage.loadWatchlist("public")).map(({ uid }) => uid),
    [id, bybitId]
  );
  await storage.saveWatchlistSnapshot("public", [row(bybitId, bybitRef)]);
  const exported = await storage.createBackup("public");
  assert.deepEqual(exported.requiredProviders, ["okx"]);
  assert.deepEqual(
    exported.watchlist.map(({ uid }) => uid),
    [bybitId]
  );
  assert.equal(exported.drawings[0].symbol, id);
  assert.equal(exported.images[0].symbol, id);
  assert.equal(exported.views[0].key, viewKey);
  await storage.importBackup("restored", exported, { replacePortable: true });
  const restored = await storage.createBackup("restored");
  assert.deepEqual(restored.requiredProviders, ["okx"]);
  assert.deepEqual(restored.drawings, exported.drawings);
  assert.deepEqual(restored.views, exported.views);
  assert.deepEqual(restored.images, exported.images);
  const copy = await storage.copyPublicProfile("public", "bank", () => true);
  assert.equal(copy.conflict, false);
  assert.deepEqual(
    await storage.loadDrawings("bank", id),
    await storage.loadDrawings("public", id)
  );
  assert.deepEqual(await storage.loadView("bank", viewKey), view);
  assert.equal((await storage.loadImages("bank", id))[0].owner, "bank");
  assert.equal((await storage.loadPreferences("bank")).watchlistFlags[`uid:${id}`], "pink");
});

test("capability marker covers every portable OKX identity and ignores user captions", () => {
  const { withRequiredProviders } = load("model/backup-export.ts");
  const { validateBackup } = load("model/backup-format.ts");
  const withoutMarker = {
    ...backup(),
    drawings: [{ symbol: "SBER", items: [{ ...drawing, title: "OKX: a user caption" }] }]
  };
  assert.deepEqual(withRequiredProviders(validateBackup(withoutMarker)), withoutMarker);
  for (const fragment of [
    { watchlist: [row(id, ref)] },
    { layout: { symbol: id, instrumentUid: id, providerRef: ref } },
    { layout: { watchlistFlags: { [`uid:${id}`]: "pink" } } },
    {
      layout: {
        watchlistSections: {
          version: 1,
          entries: [{ kind: "instrument", uid: id, symbol: id, occurrence: 0 }]
        }
      }
    },
    { drawings: [{ symbol: id, items: [drawing] }] },
    { images: [image] },
    { views: [{ key: viewKey, value: view }] },
    { history: [{ uid: id, timeframe: "1d", day: "2026-11-10", data: "" }] }
  ]) {
    const data = { ...backup(), ...fragment };
    assert.deepEqual(withRequiredProviders(validateBackup(data)).requiredProviders, ["okx"]);
    assert.throws(() => validateBackup({ ...data, schemaVersion: 1 }));
  }
  assert.throws(() => validateBackup({ ...backup(), requiredProviders: ["unknown"] }));
  assert.throws(() =>
    validateBackup({ ...backup(), requiredProviders: ["okx"], schemaVersion: 1 })
  );
  assert.throws(() => validateBackup({ ...backup(), watchlist: [row(bybitId, ref)] }));
});

test("Drive capability fence protects a head containing only detached OKX data", async () => {
  const { DriveSync } = load("services/drive/sync.ts");
  const store = new Store();
  const current = new DriveSync(store);
  const { nodeId } = await current.publish(detachedBackup(), {
    deviceId: crypto.randomUUID(),
    parents: []
  });
  const restored = await current.download(nodeId);
  assert.deepEqual(restored.requiredProviders, ["okx"]);
  assert.deepEqual(restored.drawings, detachedBackup().drawings);
  assert.deepEqual(restored.images, detachedBackup().images);
  assert.deepEqual(restored.views, detachedBackup().views);

  const currentBackup = load("services/drive/backup.ts");
  const { DriveSync: LegacySync } = sourceLoader(root, {
    // The v0.3.25 projection has no requiredProviders field. The strict read guard compares the raw payload.
    "services/drive/backup.ts": {
      ...currentBackup,
      sanitizeDriveBackup(input) {
        const projected = currentBackup.sanitizeDriveBackup(input);
        const { requiredProviders, ...legacy } = projected;
        assert.deepEqual(requiredProviders, ["okx"]);
        return legacy;
      }
    }
  })("services/drive/sync.ts");
  const previous = new LegacySync(store);
  const uploads = store.events.filter((e) => e.op === "UPLOAD").length;
  await assert.rejects(
    previous.publish(backup(), { deviceId: crypto.randomUUID(), parents: [nodeId] }),
    { code: "unsupported-format" }
  );
  assert.deepEqual((await current.inspect()).heads, [nodeId]);
  assert.equal(store.events.filter((e) => e.op === "UPLOAD").length, uploads);
});
