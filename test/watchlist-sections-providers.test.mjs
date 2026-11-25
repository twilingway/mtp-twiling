import test from "node:test";
import assert from "node:assert/strict";
import { controllerFixture, row, header } from "./helpers/watchlist-sections.mjs";

test("section operations on actual mixed MarketClient do not reorder canonical rows, request providers or write quote snapshots", async () => {
  const f = controllerFixture(),
    { MarketClient } = f.load("services/market-client.js"),
    { TBankClient } = f.load("services/tbank-client.js"),
    cache = new Proxy(
      {},
      { get: (_object, key) => () => assert.fail(`section edit used quote cache ${String(key)}`) }
    ),
    bank = new TBankClient("unit-test-only-not-real", "Test", cache),
    provider = { provider: "bybit", category: "spot", symbol: "BTCUSDT" },
    bybit = {
      ...row("bybit:spot:BTCUSDT", "bybit:spot:BTCUSDT"),
      ticker: "BTCUSDT",
      currency: "USDT",
      type: "crypto",
      assetClass: "crypto",
      productKind: "spot",
      providerRef: provider
    },
    rows = [row("SAME", "first"), bybit, row("SAME", "second")];
  bank.request = () => assert.fail("section edits must not send TBank requests");
  bank.send = () => assert.fail("section edits must not send TBank subscriptions");
  const client = new MarketClient("unit-test-only-not-real", "Test", cache, {
    owner: "profile-A",
    bankFactory: () => bank,
    online: () => false,
    fetch: () => assert.fail("section edits must not fetch Bybit")
  });
  client.values = rows;
  client.reorderWatchlist = () =>
    assert.fail("display ledger must replace canonical reorder in this path");
  f.controller.session.client = client;
  f.controller.update({
    rows,
    preferences: {
      ...f.controller.getSnapshot().preferences,
      symbol: "SAME",
      instrumentUid: "second"
    }
  });
  const refs = f.model.watchlistReferences(rows),
    key = f.model.watchlistEntryKey;
  await f.persist(f.controller, { kind: "insert", header: header("mixed"), before: key(refs[1]) });
  await f.persist(f.controller, { kind: "assign", source: key(refs[2]), section: null });
  const ordered = f.model.orderedWatchlistRows(
    rows,
    f.controller.getSnapshot().preferences.watchlistSections
  );
  assert.deepEqual(
    ordered.map((item) => item.uid),
    ["first", "second", "bybit:spot:BTCUSDT"]
  );
  assert.equal(client.rows, rows);
  assert.equal(client.rows[1].providerRef, provider);
  assert.equal(f.controller.getSnapshot().preferences.instrumentUid, "second");
  assert.equal(f.reloads(), 0);
  const storage = f.load("services/storage.ts"),
    backup = {
      application: "personal-terminal",
      schemaVersion: 2,
      drawings: [],
      images: [],
      layout: f.controller.getSnapshot().preferences,
      watchlist: rows
    },
    { sanitizeDriveBackup } = f.load("services/drive/backup.js");
  const exported = JSON.parse(JSON.stringify(sanitizeDriveBackup(backup)));
  await storage.importBackup("profile-B", exported);
  const restoredRows = await storage.loadWatchlist("profile-B"),
    prefs = await storage.loadPreferences("profile-B");
  assert.deepEqual(
    f.model.orderedWatchlistRows(restoredRows, prefs.watchlistSections).map((r) => r.uid),
    ordered.map((r) => r.uid)
  );
  assert.deepEqual(restoredRows[1].providerRef, provider);
});

test("remove-selected controller fallback selects the first real instrument in ledger order including collapsed members", async () => {
  const f = controllerFixture(),
    refs = f.model.watchlistReferences(f.rows),
    rows = [...f.rows],
    sections = { version: 1, entries: [header("collapsed"), refs[2], refs[1], refs[0]] };
  sections.entries[0].collapsed = true;
  let currentRows = rows;
  const client = {
    owner: "profile-A",
    flush: async () => {},
    removeInstrument: async (reference) => {
      currentRows = currentRows.filter((r) => r.uid !== reference.uid);
    },
    snapshot: () => ({
      rows: currentRows,
      profileKey: "profile-A",
      authenticated: true,
      marketReady: true
    })
  };
  f.controller.session.client = client;
  f.controller.update({
    preferences: { ...f.controller.getSnapshot().preferences, watchlistSections: sections }
  });
  f.controller.session.applyBankState = (snapshot) => f.controller.update({ rows: snapshot.rows });
  await f.controller.removeInstrument(rows[0]);
  assert.equal(f.controller.getSnapshot().preferences.instrumentUid, "uid-THREE");
  assert.equal(f.controller.getSnapshot().preferences.symbol, "THREE");
  assert.equal(f.reloads(), 1, "removing the selected instrument reloads only its replacement");
});
