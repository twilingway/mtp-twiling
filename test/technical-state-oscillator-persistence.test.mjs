import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  core,
  load,
  ids,
  make,
  customInstance,
  backup,
  candles
} from "./technical-state-oscillator-fixture.mjs";
const { validateBackup } = load("model/backup-format.js");
const { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = load(
  "services/drive/backup.js"
);

test("all3 custom flat instances and both output styles survive JSON and actual Drive prepare/restore", async () => {
  const instances = ids.map(customInstance),
    json = JSON.parse(JSON.stringify(backup(instances)));
  assert.deepEqual(validateBackup(json).layout.technicalIndicators, instances);
  assert.deepEqual(sanitizeDriveBackup(json).layout.technicalIndicators, instances);
  const prepared = await prepareDriveBackup(json),
    restored = await restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.technicalIndicators, instances);
  for (const instance of restored.layout.technicalIndicators) {
    assert.ok(Object.values(instance.params).every((v) => typeof v === "number"));
    assert.deepEqual(
      core.calculateTechnicalIndicator(instance, candles([1, 2, 4, 2, 8, 9, 4, 6, 10, 12, 9])),
      core.calculateTechnicalIndicator(
        instances.find((i) => i.id === instance.id),
        candles([1, 2, 4, 2, 8, 9, 4, 6, 10, 12, 9])
      )
    );
    for (const key of [
      "series",
      "timestamps",
      "warmupBars",
      "alwaysUndefined",
      "historyRequirement",
      "outputWarmup",
      "availability"
    ])
      assert.equal(Object.hasOwn(instance, key), false);
  }
});
test("Fisher1 nullable recursive flags are recomputed after persistence and never stored", async () => {
  const instance = make("fisher-transform", "fisher1", { params: { length: 1 } }),
    source = backup([instance]);
  const prepared = await prepareDriveBackup(source),
    restored = await restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.technicalIndicators, [instance]);
  const result = core.calculateTechnicalIndicator(
    restored.layout.technicalIndicators[0],
    candles([1, 2, 3])
  );
  assert.equal(result.warmupBars, null);
  assert.equal(result.historyRequirement.seedBars, null);
  assert.equal(result.alwaysUndefined, true);
  for (const key of ["warmupBars", "historyRequirement", "alwaysUndefined"]) {
    const corrupt = { ...instance, [key]: result[key] };
    assert.equal(core.isTechnicalIndicatorInstance(corrupt), false);
    assert.throws(() => validateBackup(backup([corrupt])));
    assert.throws(() => sanitizeDriveBackup(backup([corrupt])));
  }
});
test("raw root/JSON/Drive reject array/null/unknown/extra params and styles before allowlist projection", async () => {
  for (const id of ids) {
    const instance = customInstance(id, 0),
      definition = core.getTechnicalIndicatorDefinition(id);
    const invalid = [
      { ...instance, params: null },
      { ...instance, params: [] },
      { ...instance, params: { ...instance.params, rocLengths: [1, 2, 3, 4] } },
      { ...instance, params: { ...instance.params, unexpected: 1 } },
      { ...instance, styles: null },
      { ...instance, styles: { extra: { color: "#123456", width: 1, visible: true } } },
      { ...instance, styles: { value: { color: "#123456", width: 1, visible: true, extra: true } } }
    ];
    for (const p of definition.parameters) {
      for (const value of [null, [], {}, "unknown", 0, 1.5, 10001])
        invalid.push({ ...instance, params: { ...instance.params, [p.key]: value } });
      const missing = { ...instance.params };
      delete missing[p.key];
      invalid.push({ ...instance, params: missing });
    }
    for (const item of invalid) {
      const data = JSON.parse(JSON.stringify(backup([item])));
      assert.equal(core.isTechnicalIndicatorInstance(data.layout.technicalIndicators[0]), false);
      assert.throws(() => validateBackup(data));
      assert.throws(
        () => sanitizeDriveBackup(data),
        (e) => e.code === "remote-invalid"
      );
    }
    const bad = backup([{ ...instance, params: { ...instance.params, extra: "discard-me" } }]);
    await assert.rejects(
      () => restoreDriveBackup(new Blob([JSON.stringify(bad)]), []),
      (e) => e.code === "remote-invalid"
    );
  }
});
test("Drive parameter allowlist adds exactly10 state,5 trend-price and2 channel-price scalar keys", () => {
  const source = readFileSync(new URL("../src/services/drive/backup.ts", import.meta.url), "utf8");
  const keys = source.match(/params:\s*scalars\(\s*"([^"]+)"/)[1].split(" ");
  const previous =
    "length source fastLength slowLength signalLength multiplier smoothK smoothD expansionLength contractionLength middleLength diLength adxSmoothing divisor emaLength oscillatorAverage signalAverage".split(
      " "
    );
  assert.deepEqual(
    keys.filter((k) => !previous.includes(k)),
    [
      "longLength",
      "shortLength",
      "roc1Length",
      "roc2Length",
      "roc3Length",
      "roc4Length",
      "sma1Length",
      "sma2Length",
      "sma3Length",
      "sma4Length",
      "atrLength",
      "factor",
      "start",
      "increment",
      "maximum",
      "offset",
      "sigma"
    ]
  );
  assert.ok(previous.every((k) => keys.includes(k)));
  assert.equal(keys.length, new Set(keys).size);
});
