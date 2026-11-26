import test from "node:test";
import assert from "node:assert/strict";
import { core, load, ids, candles } from "./technical-volume-registration-fixture.mjs";

const { validateBackup } = load("model/backup-format.js");
const { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = load(
  "services/drive/backup.js"
);
const make = core.createTechnicalIndicatorInstance;
const custom = {
  cmf: { length: 3 },
  "chaikin-oscillator": { fastLength: 4, slowLength: 2 },
  efi: { length: 2 },
  eom: { length: 2, divisor: 123456 },
  "volume-oscillator": {
    fastLength: 2,
    slowLength: 3,
    signalLength: 2,
    oscillatorAverage: "SMA",
    signalAverage: "EMA"
  },
  nvi: { emaLength: 2 },
  pvi: { emaLength: 3 }
};
const input = (instances) => ({
  application: "personal-terminal",
  schemaVersion: 1,
  layout: { technicalIndicators: instances },
  drawings: [],
  images: []
});
const validInstance = (id, order) =>
  make(id, `custom-${id}`, {
    params: custom[id],
    pane: { kind: "pane", id: "volume-group" },
    order,
    visible: false,
    styles: Object.fromEntries(
      core.getTechnicalIndicatorDefinition(id).outputs.map((output, i) => [
        output.id,
        {
          color: "#123456",
          width: i + 1,
          visible: i % 2 === 0,
          opacity: 0.35,
          lineStyle: "dashed"
        }
      ])
    )
  });

test("JSON and production Drive prepare/restore preserve all7 custom parameter/style instances", async () => {
  const instances = ids.map(validInstance),
    backup = input(instances);
  const json = JSON.parse(JSON.stringify(backup));
  assert.equal(core.isTechnicalIndicatorInstanceList(json.layout.technicalIndicators), true);
  assert.deepEqual(validateBackup(json).layout.technicalIndicators, instances);
  assert.deepEqual(sanitizeDriveBackup(json).layout.technicalIndicators, instances);
  const prepared = await prepareDriveBackup(json),
    restored = await restoreDriveBackup(prepared.payload, []);
  assert.deepEqual(restored.layout.technicalIndicators, instances);
  const real = candles([10, 12, 9, 18, 9], [10, 20, 10, 10, 5]);
  for (const instance of restored.layout.technicalIndicators) {
    assert.deepEqual(
      core.calculateTechnicalIndicator(instance, real),
      core.calculateTechnicalIndicator(
        instances.find((item) => item.id === instance.id),
        real
      )
    );
    assert.deepEqual(
      Object.keys(instance).sort(),
      ["schemaVersion", "id", "definitionId", "params", "pane", "visible", "order", "styles"].sort()
    );
    for (const key of [
      "historyRequirement",
      "warmupBars",
      "outputWarmupBars",
      "unavailableReason",
      "alwaysUndefined",
      "series",
      "timestamps"
    ])
      assert.equal(Object.hasOwn(instance, key), false);
  }
});

test("all four exact choice combinations roundtrip as strings through production validators and Drive", async () => {
  for (const oscillatorAverage of ["EMA", "SMA"]) {
    for (const signalAverage of ["EMA", "SMA"]) {
      const instance = make("volume-oscillator", "pvo", {
        params: { oscillatorAverage, signalAverage }
      });
      const backup = input([instance]),
        json = JSON.parse(JSON.stringify(backup));
      assert.equal(core.isTechnicalIndicatorInstance(json.layout.technicalIndicators[0]), true);
      assert.deepEqual(validateBackup(json), backup);
      const prepared = await prepareDriveBackup(json),
        restored = await restoreDriveBackup(prepared.payload, []);
      assert.equal(
        restored.layout.technicalIndicators[0].params.oscillatorAverage,
        oscillatorAverage
      );
      assert.equal(restored.layout.technicalIndicators[0].params.signalAverage, signalAverage);
    }
  }
});

test("JSON and Drive reject null/unknown/extra parameter and style corruption before projection", () => {
  for (const id of ids) {
    const instance = validInstance(id, 0),
      definition = core.getTechnicalIndicatorDefinition(id);
    const corrupted = [
      { ...instance, params: null },
      { ...instance, params: { ...instance.params, unexpected: 1 } },
      { ...instance, styles: null },
      { ...instance, styles: { unknown: { color: "#123456", width: 1, visible: true } } },
      { ...instance, unavailableReason: "volume-unavailable" },
      { ...instance, historyRequirement: { kind: "recursive" } }
    ];
    const firstOutput = definition.outputs[0].id;
    for (const patch of [
      { width: 0 },
      { width: null },
      { opacity: null },
      { lineStyle: "unknown" },
      { color: "red" },
      { extra: true }
    ])
      corrupted.push({
        ...instance,
        styles: { [firstOutput]: { color: "#123456", width: 1, visible: true, ...patch } }
      });
    for (const parameter of definition.parameters) {
      for (const invalid of [
        null,
        "unknown",
        ...(parameter.type === "choice"
          ? ["ema", "WMA", 1, {}, []]
          : [0, -1, 1.5, parameter.max + 1])
      ])
        corrupted.push({ ...instance, params: { ...instance.params, [parameter.key]: invalid } });
      const missing = { ...instance.params };
      delete missing[parameter.key];
      corrupted.push({ ...instance, params: missing });
    }
    for (const candidate of corrupted) {
      const json = JSON.parse(JSON.stringify(input([candidate])));
      assert.equal(core.isTechnicalIndicatorInstance(json.layout.technicalIndicators[0]), false);
      assert.throws(() => validateBackup(json));
      assert.throws(
        () => sanitizeDriveBackup(json),
        (error) => error.code === "remote-invalid"
      );
    }
  }
  for (const choice of [null, "WMA", "ema", 0]) {
    assert.throws(
      () => make("volume-oscillator", "bad-choice", { params: { signalAverage: choice } }),
      RangeError
    );
  }
});

test("Drive rejects corrupt restore payload and never sanitizes extra TA keys into defaults", async () => {
  const instance = make("volume-oscillator", "pvo"),
    backup = input([instance]);
  for (const mutate of [
    (item) => {
      item.params.signalAverage = null;
    },
    (item) => {
      item.params.signalAverage = "bad";
    },
    (item) => {
      item.params.extra = "discard-me";
    },
    (item) => {
      item.extra = true;
    }
  ]) {
    const candidate = structuredClone(backup);
    mutate(candidate.layout.technicalIndicators[0]);
    await assert.rejects(
      () => restoreDriveBackup(new Blob([JSON.stringify(candidate)]), []),
      (error) => error.code === "remote-invalid"
    );
  }
});
