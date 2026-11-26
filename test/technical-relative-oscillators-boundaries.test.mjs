import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "f889aebb14b9b330913a73595aed11c39b7e5fcd";
test("all previously tracked source/math/registry/UI/native files byte-identical exact base", () => {
  const entries = execFileSync(
    "git",
    ["ls-tree", "-rz", base, "src", "package.json", "pnpm-lock.yaml", "test/fixtures"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean);
  let math = 0;
  for (const entry of entries) {
    const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(entry);
    assert.ok(match, entry);
    const [, expected, path] = match;
    const bytes = readFileSync(resolve(root, path));
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(actual, expected, path);
    if (path.startsWith("src/model/technical-indicators/")) math++;
  }
  assert.ok(math > 30);
  console.log(
    `Frozen base ${base}: ${entries.length} old files unchanged, ${math} indicator files.`
  );
});
