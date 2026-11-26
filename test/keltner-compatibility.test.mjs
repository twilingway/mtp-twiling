import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  core,
  load,
  createSourceLoader,
  gitSource,
  BASE,
  MATH,
  BASE_DRIVE_KEYS,
  bars,
  backup
} from "./keltner-fixture.mjs";
import { contractHash, FROZEN42_SHA256 } from "./technical-state-oscillator-fixture.mjs";
import { numeric42Witness } from "./ta-render-contract-fixture.mjs";
const oldLoad = createSourceLoader({}, (relative) => gitSource(BASE, relative)),
  old = oldLoad("model/technical-indicators/index.js");

test("independent git-show preserves exact old50 definition/default/custom style/history/result/profile/JSON/Drive witness", async () => {
  assert.equal(old.technicalIndicatorDefinitions.length, 50);
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 50),
    old.technicalIndicatorDefinitions
  );
  const contract = (model, reader) => {
    const definitions = model.technicalIndicatorDefinitions.slice(0, 50),
      instances = definitions.map((d, order) =>
        model.createTechnicalIndicatorInstance(d.id, `frozen-${d.id}`, { order })
      ),
      customized = definitions.map((d, order) =>
        model.createTechnicalIndicatorInstance(d.id, `custom-${d.id}`, {
          order,
          visible: order % 2 === 0,
          pane: { kind: "pane", id: "shared" },
          styles: Object.fromEntries(
            d.outputs.map((o, i) => [
              o.id,
              {
                color: "#123456",
                width: (i % 4) + 1,
                visible: i % 2 === 0,
                opacity: 0.35,
                lineStyle: "dotted"
              }
            ])
          )
        })
      ),
      dense = bars(85),
      cases = [
        [],
        dense,
        dense.map((b) => ({ ...b, volume: null })),
        dense.map((b, i) =>
          i % 7 === 3 ? { ...b, open: null, high: null, low: null, close: null, volume: null } : b
        )
      ],
      profile = {
        locale: "ru",
        timeZone: "UTC",
        symbol: "ONE",
        timeframe: "1d",
        engine: "kline",
        technicalIndicators: customized,
        technicalPaneLayout: [{ paneId: "shared", heightRatio: 0.2, collapsed: true }]
      },
      raw = { ...backup(customized), layout: profile },
      validate = reader("model/backup-format.js");
    assert.equal(validate.isProfilePreferences(profile), true);
    return {
      definitions,
      instances,
      customized,
      history: instances.map((i) => model.technicalIndicatorHistoryRequirement(i)),
      results: cases.map((input) =>
        instances.map((i) =>
          model.calculateTechnicalIndicator(i, input, { historicalVolatilityPeriodsPerYear: 365 })
        )
      ),
      profile,
      json: validate.validateBackup(JSON.parse(JSON.stringify(raw))),
      drive: reader("services/drive/backup.js").sanitizeDriveBackup(raw)
    };
  };
  const before = contract(old, oldLoad),
    after = contract(core, load);
  assert.deepEqual(after, before);
  const hash = createHash("sha256").update(JSON.stringify(before)).digest("hex");
  assert.equal(hash, "8f972b956f4704cff925b686cb9ace9ac3c09471cf6b188fc14b352a790f7a63");
  process.stdout.write(`Independent old50 witness ${hash}\n`);
  for (const model of [old, core]) {
    assert.equal(contractHash(model), FROZEN42_SHA256);
    assert.equal(
      numeric42Witness(model),
      "7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3"
    );
  }
  const drive = load("services/drive/backup.js"),
    prepared = await drive.prepareDriveBackup(backup(after.customized)),
    restored = await drive.restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.technicalIndicators, before.customized);
  const keys = gitSource(BASE, "services/drive/backup.ts")
    .match(/params:\s*scalars\(\s*"([^"]+)"/)[1]
    .split(" ");
  assert.deepEqual(BASE_DRIVE_KEYS, keys);
});

test("reviewed math sixfiles remain unchanged780e9 and all4 existing PVO choices retain exact params/results/history/rejections", () => {
  for (const name of ["averages", "channels", "filters", "index", "inputs", "metadata"]) {
    const relative = `model/technical-indicators/channel-average/${name}.ts`;
    assert.equal(
      readFileSync(new URL("../src/" + relative, import.meta.url), "utf8").replaceAll("\r\n", "\n"),
      gitSource(MATH, relative)
    );
  }
  for (const oscillatorAverage of ["EMA", "SMA"])
    for (const signalAverage of ["EMA", "SMA"]) {
      const params = {
          fastLength: 3,
          slowLength: 5,
          signalLength: 2,
          oscillatorAverage,
          signalAverage
        },
        previous = old.createTechnicalIndicatorInstance("volume-oscillator", "pvo", { params }),
        current = core.createTechnicalIndicatorInstance("volume-oscillator", "pvo", { params });
      assert.deepEqual(current, previous);
      assert.deepEqual(
        core.calculateTechnicalIndicator(current, bars()),
        old.calculateTechnicalIndicator(previous, bars())
      );
      assert.deepEqual(
        core.technicalIndicatorHistoryRequirement(current),
        old.technicalIndicatorHistoryRequirement(previous)
      );
      for (const invalid of ["Range", "Average True Range", true, 0, null, [], {}])
        for (const key of ["oscillatorAverage", "signalAverage"]) {
          const candidate = { ...current, params: { ...current.params, [key]: invalid } };
          assert.equal(core.isTechnicalIndicatorInstance(candidate), false);
          assert.equal(old.isTechnicalIndicatorInstance(candidate), false);
        }
    }
});
