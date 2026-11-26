import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { bars, backup } from "./keltner-fixture.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  base = "8306dd61c17ec2191c9c3a25ec95b4f8e760f695",
  fixed = "e08f4662399dfb634bc41d00909419213041af4b";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 20_000_000 });
const current = createSourceLoader(),
  old = createSourceLoader({}, (relative) =>
    git("show", `${base}:src/${relative}`).toString("utf8")
  );
const core = current("model/technical-indicators/index.js"),
  previous = old("model/technical-indicators/index.js");
test("old51 actual Git definitions/default/custom numeric+history+style+layout/JSON remain exact", () => {
  assert.deepEqual(
    core.technicalIndicatorDefinitions.slice(0, 51),
    previous.technicalIndicatorDefinitions
  );
  for (const definition of previous.technicalIndicatorDefinitions) {
    const styles = Object.fromEntries(
      definition.outputs.map((o) => [
        o.id,
        { color: "#123456", width: 2, visible: true, opacity: 0.4, lineStyle: "dotted" }
      ])
    );
    for (const pane of [{ kind: "overlay" }, { kind: "pane", id: "shared" }]) {
      const options = { styles, pane },
        before = previous.createTechnicalIndicatorInstance(definition.id, "old", options),
        after = core.createTechnicalIndicatorInstance(definition.id, "old", options);
      assert.deepEqual(after, before);
      for (const data of [
        bars(45),
        bars(45).map((b, i) => (i % 9 === 0 ? { ...b, close: null, volume: null } : b))
      ])
        assert.deepEqual(
          core.calculateTechnicalIndicator(after, data, {
            historicalVolatilityPeriodsPerYear: 365
          }),
          previous.calculateTechnicalIndicator(before, data, {
            historicalVolatilityPeriodsPerYear: 365
          }),
          definition.id
        );
      assert.deepEqual(JSON.parse(JSON.stringify(after)), before);
    }
  }
});
test("accepted math merge retains ancestry and all pure math blobs; historic340 receipt remains at fix commit", () => {
  for (const sha of [
    "a906f02d28bd2ea2eaed08d0f5892afcc3d14b78",
    "edccec63477c538ead60896deb0dca4f2ad1a721",
    fixed
  ])
    git("merge-base", "--is-ancestor", sha, "HEAD");
  const entries = git(
    "ls-tree",
    "-rz",
    fixed,
    "src/model/technical-indicators/relative-oscillators"
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const entry of entries) {
    const [, hash, path] = /^\d+ blob (\w+)\t(.+)$/.exec(entry),
      bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.equal(
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      hash,
      path
    );
  }
  const historical = "f889aebb14b9b330913a73595aed11c39b7e5fcd";
  assert.equal(
    git("ls-tree", "-rz", historical, "src", "package.json", "pnpm-lock.yaml", "test/fixtures")
      .toString()
      .split("\0")
      .filter(Boolean).length,
    340
  );
  assert.equal(
    git(
      "diff",
      "--diff-filter=MDR",
      "--name-only",
      historical,
      fixed,
      "src",
      ":(exclude)src/model/technical-indicators/relative-oscillators",
      "package.json",
      "pnpm-lock.yaml",
      "test/fixtures"
    )
      .toString()
      .trim(),
    ""
  );
});
test("actual released .23 strict reader rejects new2 before write; current parser keeps schema1 and no hidden style params", () => {
  const released = createSourceLoader({}, (relative) =>
    git("show", `62a1a36f2409911f6bdb029f37e0bfe14e852489:src/${relative}`).toString("utf8")
  );
  const guard = released("services/drive/reader-guard.js").assertReadableDrivePayload;
  for (const id of ["stochastic-rsi", "coppock-curve"]) {
    const instance = core.createTechnicalIndicatorInstance(id, id),
      payload = backup([instance]),
      before = JSON.stringify(payload);
    assert.throws(
      () => guard(payload),
      (error) => error.code === "unsupported-format"
    );
    assert.equal(JSON.stringify(payload), before);
    assert.equal(core.isTechnicalIndicatorInstance(JSON.parse(JSON.stringify(instance))), true);
  }
});
