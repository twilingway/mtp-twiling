import test from "node:test";
import assert from "node:assert/strict";
import { createPortableFixture } from "./helpers/portable-database.mjs";

const ref = { provider: "bybit", category: "spot", symbol: "BTCUSDT" },
  id = "bybit:spot:BTCUSDT";
const row = {
  symbol: id,
  uid: id,
  ticker: "BTCUSDT",
  name: "Bitcoin / Tether",
  providerRef: ref,
  color: "#ffffff",
  mark: "B",
  figi: null,
  currency: "USDT",
  type: "crypto",
  step: 0.01,
  price: null,
  previousClose: null,
  availability: "pending",
  comparisonBasis: "rolling-24h"
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("TA settings migrate once and survive mixed-provider schema2 JSON/Drive without old-writer data loss", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  const make = f.load("model/technical-indicators/instances.ts").createTechnicalIndicatorInstance;
  const original = {
    symbol: "SBER",
    technicalIndicators: [
      make("rsi", "rsi-7", {
        params: { length: 7 },
        pane: { kind: "pane", id: "strength" },
        styles: {
          value: { color: "#123456", width: 3, visible: true, opacity: 0.4, lineStyle: "dashed" }
        }
      }),
      make("rsi", "rsi-21", {
        params: { length: 21 },
        pane: { kind: "pane", id: "strength" },
        order: 2
      }),
      make("bollinger-bandwidth", "bandwidth", {
        params: { expansionLength: 57, contractionLength: 83 }
      }),
      make("ultimate-oscillator", "ultimate", { params: { middleLength: 17 } }),
      make("historical-volatility", "volatility", { params: { length: 13 } })
    ],
    technicalPaneLayout: [{ paneId: "strength", heightRatio: 0.31, collapsed: true }],
    indicatorPaneLayout: { volume: { heightRatio: 0.25 } },
    chartSettings: { legendCollapsed: true }
  };
  await f.storage.savePreferences("A", original);
  await v2.prepareProfileV2("A");
  await v2.savePreferences("A", { ...original, symbol: id, instrumentUid: id, providerRef: ref });
  await v2.saveWatchlistSnapshot("A", [row]);
  const exported = await v2.createBackup("A");
  assert.equal(exported.schemaVersion, 2);
  const backup = f.load("model/backup-format.ts");
  const validated = backup.validateBackup(plain(exported));
  assert.deepEqual(
    plain(validated.layout.technicalIndicators),
    plain(original.technicalIndicators)
  );
  const drive = f.load("services/drive/backup.ts");
  const prepared = await drive.prepareDriveBackup(validated);
  const restored = await drive.restoreDriveBackup(prepared.payload, []);
  await v2.importBackup("B", restored, { replacePortable: true });
  const preferences = await v2.loadPreferences("B");
  assert.deepEqual(plain(preferences.technicalIndicators), plain(original.technicalIndicators));
  assert.deepEqual(plain(preferences.technicalPaneLayout), original.technicalPaneLayout);
  assert.equal(preferences.chartSettings.legendCollapsed, true);
  assert.equal(preferences.indicatorPaneLayout.volume.heightRatio, 0.25);
  assert.deepEqual(plain(preferences.providerRef), ref);
  assert.deepEqual(plain((await v2.loadWatchlist("B"))[0].providerRef), ref);
  // An older app writes its own namespace; the new portable profile remains intact.
  await f.storage.savePreferences("A", { symbol: "GAZP" });
  assert.equal((await v2.loadPreferences("A")).symbol, id);
  assert.equal((await v2.loadPreferences("A")).technicalIndicators[0].params.length, 7);
  assert.equal((await f.storage.loadPreferences("A")).symbol, "GAZP");
  const corrupt = plain(exported);
  corrupt.layout.technicalIndicators[0].styles.value.opacity = 10;
  assert.throws(() => backup.validateBackup(corrupt));
});

test("a legacy v1 file with supported TA preferences imports into v2 without changing legacy data", async () => {
  const f = await createPortableFixture(),
    v2 = f.load("services/storage-v2.ts");
  const make = f.load("model/technical-indicators/instances.ts").createTechnicalIndicatorInstance;
  const preferences = {
    symbol: "SBER",
    technicalIndicators: [make("wma", "average")],
    technicalPaneLayout: []
  };
  await f.storage.savePreferences("A", preferences);
  const exported = { ...(await f.storage.createBackup("A")), schemaVersion: 1 };
  await v2.importBackup("B", plain(exported), { replacePortable: true });
  assert.deepEqual(
    plain((await v2.loadPreferences("B")).technicalIndicators),
    plain(preferences.technicalIndicators)
  );
  assert.deepEqual(
    plain((await f.storage.loadPreferences("A")).technicalIndicators),
    plain(preferences.technicalIndicators)
  );
});
