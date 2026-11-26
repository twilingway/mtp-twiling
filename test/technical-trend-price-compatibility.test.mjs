import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  core,
  load,
  historicalLoader,
  gitSource,
  currentSource,
  REVIEWED_MATH,
  ledger,
  candle,
  backup
} from "./technical-trend-price-fixture.mjs";
import { contractHash, FROZEN42_SHA256 } from "./technical-state-oscillator-fixture.mjs";
import { numeric42Witness } from "./ta-render-contract-fixture.mjs";

test("independent git-show base preserves exact old45 definitions/defaults/custom instances/results/history/profile and v1 backups", async () => {
  const baseLoad = historicalLoader(),
    base = baseLoad("model/technical-indicators/index.js");
  assert.equal(base.technicalIndicatorDefinitions.length, 45);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 45),
    base.technicalIndicatorDefinitions
  );
  const contract = (model, reader) => {
    const definitions = model.technicalIndicatorDefinitions.slice(0, 45),
      defaults = definitions.map((d, i) =>
        model.createTechnicalIndicatorInstance(d.id, `frozen-${d.id}`, { order: i })
      ),
      custom = definitions.map((d, i) =>
        model.createTechnicalIndicatorInstance(d.id, `custom-${d.id}`, {
          order: i,
          visible: i % 2 === 0,
          pane: { kind: "pane", id: "legacy-shared" },
          styles: Object.fromEntries(
            d.outputs.map((o, j) => [
              o.id,
              {
                color: "#123456",
                width: (j % 4) + 1,
                visible: j % 2 === 0,
                opacity: 0.35,
                lineStyle: "dotted"
              }
            ])
          )
        })
      ),
      dense = Array.from({ length: 64 }, (_, i) =>
        candle(10 + (i % 7), i % 6, 12 + (i % 7), 8 + (i % 7), i)
      ),
      cases = [
        [],
        dense,
        dense.map((b) => ({ ...b, volume: null })),
        dense.map((b, i) =>
          i % 5 === 2 ? { ...b, open: null, high: null, low: null, close: null, volume: null } : b
        )
      ],
      profile = {
        locale: "ru",
        timeZone: "Europe/Moscow",
        symbol: "SBER",
        timeframe: "1d",
        engine: "kline",
        rangeDays: 365,
        technicalIndicators: custom,
        technicalPaneLayout: [{ paneId: "legacy-shared", heightRatio: 0.2, collapsed: false }]
      },
      validator = reader("model/backup-format.js"),
      drive = reader("services/drive/backup.js");
    assert.equal(validator.isProfilePreferences(profile), true);
    const raw = { ...backup(custom), layout: profile };
    return {
      definitions,
      defaults,
      custom,
      profile,
      histories: defaults.map((i) => model.technicalIndicatorHistoryRequirement(i)),
      results: cases.map((bars) =>
        defaults.map((i) =>
          model.calculateTechnicalIndicator(i, bars, { historicalVolatilityPeriodsPerYear: 365 })
        )
      ),
      json: validator.validateBackup(JSON.parse(JSON.stringify(raw))),
      drive: drive.sanitizeDriveBackup(raw)
    };
  };
  const before = contract(base, baseLoad),
    after = contract(core, load);
  assert.deepEqual(after, before);
  for (const model of [base, core]) {
    assert.equal(contractHash(model), FROZEN42_SHA256);
    assert.equal(
      numeric42Witness(model),
      "7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3"
    );
  }
  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.equal(hash(before), "74f0feb3595c7bfccc42086369260520446641b61593658107f2ee54756c39d0");
  assert.equal(hash(after), hash(before));
  process.stdout.write(`Independent old45 witness ${hash(before)}\n`);
  const source = backup(after.custom),
    prepared = await load("services/drive/backup.js").prepareDriveBackup(source),
    restored = await load("services/drive/backup.js").restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.technicalIndicators, before.custom);
});

test("reviewed math source remains byte-identical to49b; no formula rewrite hidden by integration", () => {
  for (const name of [
    "sar",
    "supertrend",
    "inputs",
    "filters",
    "metadata",
    "index",
    "fisher",
    "oscillators"
  ]) {
    const relative = `model/technical-indicators/trend-state/${name}.ts`;
    // Git normalizes LF; working-tree checkout may use CRLF.
    assert.equal(
      currentSource(relative).replaceAll("\r\n", "\n"),
      gitSource(REVIEWED_MATH, relative)
    );
  }
  assert.ok(ledger().every((bar) => bar.volume === null));
});
