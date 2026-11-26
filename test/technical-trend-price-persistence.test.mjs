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
  invalidInstances
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

test("Drive projects only the parameters of each reviewed price trend study", () => {
  const expected = {
    "parabolic-sar": ["increment", "maximum", "start"],
    supertrend: ["atrLength", "factor"]
  };
  for (const id of ids) {
    const instance = customInstance(id, 0);
    const [saved] = sanitizeDriveBackup(backup([instance])).layout.technicalIndicators;
    assert.deepEqual(Object.keys(saved.params).sort(), expected[id]);
    for (const key of [
      "bodyMiddle",
      "direction",
      "upTrend",
      "downTrend",
      "presentation",
      "precisionPolicy",
      "mode"
    ]) {
      assert.throws(
        () =>
          sanitizeDriveBackup(
            backup([{ ...instance, params: { ...instance.params, [key]: "Cumulative" } }])
          ),
        (error) => error.code === "remote-invalid"
      );
    }
  }
});
