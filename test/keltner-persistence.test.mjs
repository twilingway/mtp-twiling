import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPECTED_DRIVE_PARAMETER_KEYS } from "./technical-registry-expectation.mjs";
import {
  core,
  load,
  make,
  bars,
  backup,
  invalidInstances,
  BASE_DRIVE_KEYS
} from "./keltner-fixture.mjs";
const { validateBackup, isProfilePreferences } = load("model/backup-format.js"),
  { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = load(
    "services/drive/backup.js"
  );

test("all bool/choice combinations and default/custom sparse styles round-trip current v1 JSON/profile/Drive in price and own pane", async () => {
  for (const useExponentialMa of [true, false])
    for (const bandsStyle of core.KELTNER_BANDS_STYLES)
      for (const pane of [{ kind: "overlay" }, { kind: "pane", id: "own" }]) {
        const instance = make(
            { length: 3, multiplier: 1.5, useExponentialMa, bandsStyle, atrLength: 2 },
            {
              pane,
              order: 7,
              visible: false,
              styles: {
                basis: {
                  color: "#123456",
                  width: 3,
                  visible: false,
                  opacity: 0.35,
                  lineStyle: "dotted"
                }
              }
            }
          ),
          raw = backup([instance]),
          json = JSON.parse(JSON.stringify(raw));
        assert.equal(isProfilePreferences(raw.layout), true);
        assert.deepEqual(validateBackup(json).layout.technicalIndicators, [instance]);
        assert.deepEqual(sanitizeDriveBackup(json).layout.technicalIndicators, [instance]);
        const prepared = await prepareDriveBackup(json),
          restored = await restoreDriveBackup(prepared.payload, []);
        assert.deepEqual(restored.layout.technicalIndicators, [instance]);
        const saved = restored.layout.technicalIndicators[0];
        assert.equal(typeof saved.params.useExponentialMa, "boolean");
        assert.equal(saved.params.useExponentialMa, useExponentialMa);
        assert.equal(saved.params.bandsStyle, bandsStyle);
        assert.deepEqual(Object.keys(saved.styles), ["basis"]);
        assert.deepEqual(
          core.calculateTechnicalIndicator(saved, bars()),
          core.calculateTechnicalIndicator(instance, bars())
        );
        for (const key of [
          "historyRequirement",
          "firstReadyBars",
          "series",
          "unavailableReason",
          "presentation",
          "fills"
        ])
          assert.equal(Object.hasOwn(saved, key), false);
      }
  const original = make(),
    prepared = await prepareDriveBackup(backup([original])),
    restored = await restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.technicalIndicators, [original]);
  assert.equal(Object.hasOwn(restored.layout.technicalIndicators[0], "styles"), false);
  const fullyStyled = make(
    { useExponentialMa: false, bandsStyle: "Range" },
    {
      styles: Object.fromEntries(
        core.getTechnicalIndicatorDefinition("keltner-channels").outputs.map((output, index) => [
          output.id,
          {
            color: "#654321",
            width: index + 1,
            visible: index !== 1,
            opacity: 0.35,
            lineStyle: "dashed"
          }
        ])
      )
    }
  );
  const fullPrepared = await prepareDriveBackup(backup([fullyStyled])),
    fullRestored = await restoreDriveBackup(fullPrepared.payload, []);
  assert.deepEqual(fullRestored.layout.technicalIndicators, [fullyStyled]);
});

test("malformed boolean/choice/numeric/unknown/runtime data rejects before JSON/Drive projection and restore", async () => {
  for (const instance of invalidInstances()) {
    const raw = backup([instance]);
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
  for (const value of ["false", 0, null, []]) {
    const bad = backup([{ ...make(), params: { ...make().params, useExponentialMa: value } }]);
    await assert.rejects(
      () => restoreDriveBackup(new Blob([JSON.stringify(bad)]), []),
      (e) => e.code === "remote-invalid"
    );
  }
});

test("Drive allowlist retains every exact pinned old key followed by the KC bool/choice keys", () => {
  const source = readFileSync(new URL("../src/services/drive/backup.ts", import.meta.url), "utf8"),
    keys = source.match(/params:\s*scalars\(\s*"([^"]+)"/)[1].split(" ");
  assert.deepEqual(keys.slice(0, BASE_DRIVE_KEYS.length), BASE_DRIVE_KEYS);
  assert.deepEqual(keys.slice(BASE_DRIVE_KEYS.length, BASE_DRIVE_KEYS.length + 2), [
    "useExponentialMa",
    "bandsStyle"
  ]);
  assert.deepEqual(keys, EXPECTED_DRIVE_PARAMETER_KEYS);
  assert.equal(keys.length, new Set(keys).size);
});
