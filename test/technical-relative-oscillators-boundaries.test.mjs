import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "f889aebb14b9b330913a73595aed11c39b7e5fcd";
const fixed = "e08f4662399dfb634bc41d00909419213041af4b";
test("historical340 exact fix receipt and current52 immutable math blobs survive later app integration", () => {
  const entries = execFileSync(
    "git",
    ["ls-tree", "-rz", base, "src", "package.json", "pnpm-lock.yaml", "test/fixtures"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean);
  const receipt=JSON.parse(readFileSync(new URL("fixtures/stoch-coppock-provenance.json",import.meta.url),"utf8"));
  const accepted=new Map(execFileSync("git",["ls-tree","-rz",fixed,"src","package.json","pnpm-lock.yaml","test/fixtures"],{cwd:root,encoding:"utf8"}).split("\0").filter(Boolean).map(line=>{const [,hash,path]=/^\d+ blob (\w+)\t(.+)$/.exec(line);return[path,hash];}));
  for (const entry of entries) {
    const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(entry);
    assert.ok(match, entry);
    const [, expected, path] = match;
    assert.equal(accepted.get(path),expected,path);
  }
  assert.equal(entries.length,340);
  assert.equal(execFileSync("git",["rev-parse",`${fixed}:test/technical-relative-oscillators-boundaries.test.mjs`],{cwd:root,encoding:"utf8"}).trim(),receipt.historicalReceipt.originalTestGitBlob);
  assert.equal(receipt.immutableMathBlobs.length,52);
  for(const {path,blob}of receipt.immutableMathBlobs){const bytes=readFileSync(resolve(root,path));assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),blob,path);}
});
