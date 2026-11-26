import test from "node:test";
import assert from "node:assert/strict";
import {
  core,
  load,
  ids,
  make,
  customInstance,
  backup,
  ledger,
  invalidInstances,
  currentSource
} from "./technical-trend-price-fixture.mjs";
const { validateBackup, isProfilePreferences } = load("model/backup-format.js"),
  { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = load(
    "services/drive/backup.js"
  );

test("both2 flat custom/default styles survive root/profile/JSON/actual Drive roundtrip in price and own pane", async () => {
  for (const pane of [{ kind: "overlay" }, { kind: "pane", id: "own" }]) {
    const instances = ids.flatMap((id, i) => [
        make(id, `default-${id}`, { pane, order: i }),
        { ...customInstance(id, i + 2), pane }
      ]),
      profile = {
        technicalIndicators: instances,
        technicalPaneLayout:
          pane.kind === "pane" ? [{ paneId: pane.id, heightRatio: 0.25, collapsed: true }] : []
      },
      raw = { ...backup(instances), layout: profile },
      json = JSON.parse(JSON.stringify(raw));
    assert.equal(isProfilePreferences(profile), true);
    assert.deepEqual(validateBackup(json).layout, profile);
    assert.deepEqual(sanitizeDriveBackup(json).layout, profile);
    const prepared = await prepareDriveBackup(json),
      restored = await restoreDriveBackup(prepared.payload, []);
    assert.deepEqual(restored.layout, profile);
    for (const [i, instance] of restored.layout.technicalIndicators.entries()) {
      assert.equal(instance.schemaVersion, 1);
      assert.deepEqual(
        core.calculateTechnicalIndicator(instance, ledger()),
        core.calculateTechnicalIndicator(instances[i], ledger())
      );
      assert.ok(Object.values(instance.params).every((v) => typeof v === "number"));
      for (const key of [
        "series",
        "timestamps",
        "historyRequirement",
        "warmupBars",
        "bodyMiddle",
        "direction",
        "presentation",
        "precisionPolicy",
        "fills"
      ])
        assert.equal(Object.hasOwn(instance, key), false);
      assert.equal(Object.hasOwn(instance, "styles"), i % 2 === 1);
    }
  }
});

test("malformed params/runtime keys/styles fail root and JSON/Drive before allowlist projection or restore", async () => {
  for (const id of ids) {
    for (const item of invalidInstances(id)) {
      const raw = backup([item]);
      assert.equal(core.isTechnicalIndicatorInstance(item), false);
      assert.throws(() => validateBackup(raw));
      assert.throws(
        () => sanitizeDriveBackup(raw),
        (e) => e.code === "remote-invalid"
      );
      const json = JSON.parse(JSON.stringify(raw));
      assert.throws(() => validateBackup(json));
      assert.throws(
        () => sanitizeDriveBackup(json),
        (e) => e.code === "remote-invalid"
      );
    }
    const bad = backup([{ ...make(id, id), params: { ...make(id, id).params, bodyMiddle: 100 } }]);
    await assert.rejects(
      () => restoreDriveBackup(new Blob([JSON.stringify(bad)]), []),
      (e) => e.code === "remote-invalid"
    );
  }
});

test("Drive projection adds exactly the5 authorized numeric keys and no runtime or G5 writer fields", () => {
  const keys = currentSource("services/drive/backup.ts")
      .match(/params:\s*scalars\(\s*"([^"]+)"/)[1]
      .split(" "),
    previous =
      "length source fastLength slowLength signalLength multiplier smoothK smoothD expansionLength contractionLength middleLength diLength adxSmoothing divisor emaLength oscillatorAverage signalAverage longLength shortLength roc1Length roc2Length roc3Length roc4Length sma1Length sma2Length sma3Length sma4Length".split(
        " "
      );
  assert.deepEqual(
    keys.filter((key) => !previous.includes(key)),
    ["atrLength", "factor", "start", "increment", "maximum"]
  );
  assert.ok(previous.every((key) => keys.includes(key)));
  assert.equal(keys.length, new Set(keys).size);
  for (const key of [
    "bodyMiddle",
    "direction",
    "upTrend",
    "downTrend",
    "presentation",
    "precisionPolicy",
    "mode"
  ])
    assert.equal(keys.includes(key), false);
});
