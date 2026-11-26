import test from "node:test";
import assert from "node:assert/strict";
import { backup, core, createSourceLoader, gitSource, load, make } from "./keltner-fixture.mjs";

// Exact released .23 reader, not current code renamed or an expected stub.
const previous = createSourceLoader({}, (relative) =>
  gitSource("62a1a36f2409911f6bdb029f37e0bfe14e852489", relative)
);
const oldGuard = previous("services/drive/reader-guard.js").assertReadableDrivePayload;
const currentGuard = load("services/drive/reader-guard.js").assertReadableDrivePayload;

test("released .23 reader stops new KC backups as unsupported without changing their schema1 data", () => {
  for (const useExponentialMa of [false, true])
    for (const bandsStyle of ["Average True Range", "True Range", "Range"]) {
      const input = backup([make({ useExponentialMa, bandsStyle })]);
      const before = JSON.stringify(input);
      const current = currentGuard(input);
      assert.equal(current.layout.technicalIndicators[0].params.useExponentialMa, useExponentialMa);
      assert.equal(current.layout.technicalIndicators[0].params.bandsStyle, bandsStyle);
      assert.throws(
        () => oldGuard(current),
        (error) => error.code === "unsupported-format"
      );
      assert.equal(JSON.stringify(input), before);
      assert.equal(current.schemaVersion, 1);
      assert.equal(current.layout.technicalIndicators[0].schemaVersion, 1);
    }
});

test("released .23 and current readers project old50 backups identically after KC integration", () => {
  const instances = core.technicalIndicatorDefinitions
    .slice(0, 50)
    .map((definition, order) =>
      core.createTechnicalIndicatorInstance(definition.id, "legacy-" + order, { order })
    );
  const input = backup(instances);
  const before = JSON.stringify(input);
  assert.deepEqual(currentGuard(input), oldGuard(input));
  assert.equal(JSON.stringify(input), before);
});
