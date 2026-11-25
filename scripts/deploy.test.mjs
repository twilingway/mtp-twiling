import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  activate,
  currentRelease,
  inside,
  packageRelease,
  safeAsset,
  successfulRun,
  switchRelease,
  verifyPublic
} from "./deploy-lib.mjs";
import { isReleaseInput, requireVersion, versionIncreased } from "./deploy-version.mjs";
import { prepareVersion } from "./prepare-version.mjs";
import {
  githubRequest,
  queryState,
  reserveQuery,
  responseNotBefore,
  WaitForCi
} from "./deploy-rate.mjs";

const sha = "a".repeat(40);
const olderSha = "b".repeat(40);
const repo = "owner/mtp-twiling";
const buildId = "1234567890abcdef";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "mtp-deploy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(root) {
  const build = join(root, "build");
  await mkdir(join(build, "public"), { recursive: true });
  const files = {
    "index.html": '<script type="module" src="app-entry.js"></script>',
    "app-entry.js": 'console.log("app")',
    "service-worker.js": `const BUILD = "${buildId}"; // ACTIVATE_UPDATE`,
    "version.json": JSON.stringify({ version: "0.3.8", buildId })
  };
  for (const [name, content] of Object.entries(files))
    await writeFile(join(build, "public", name), content);
  await writeFile(join(build, ".release-assets.json"), JSON.stringify(Object.keys(files)));
  await writeFile(join(build, "package.json"), JSON.stringify({ version: "0.3.8" }));
  return build;
}

test("semantic version must increase for release inputs only", () => {
  assert.equal(versionIncreased("0.3.7", "0.3.8"), true);
  assert.equal(versionIncreased("0.3.9", "0.4.0"), true);
  assert.equal(versionIncreased("1.2.3", "1.2.3"), false);
  assert.equal(versionIncreased("1.2.3", "1.1.99"), false);
  assert.throws(() => versionIncreased("1.2.3", "1.2.4-beta"));
  for (const file of ["src/main.tsx", "public/index.html", "scripts/build.mjs", "package.json"])
    assert.equal(isReleaseInput(file), true);
  for (const file of [
    "docs/deployment.md",
    "scripts/deploy-static.mjs",
    ".github/workflows/ci.yml"
  ])
    assert.equal(isReleaseInput(file), false);
});

test("version preparation works cold and ignores generated outputs on repetition", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "public"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "package.json"), '{"version":"0.3.8"}');
  for (const file of [
    "pnpm-lock.yaml",
    "tsconfig.json",
    "scripts/build.mjs",
    "scripts/prepare-version.mjs",
    "scripts/service-worker.template.js"
  ])
    await writeFile(join(root, file), "source");
  await writeFile(join(root, "src/main.tsx"), "source");
  const first = await prepareVersion(root);
  assert.equal(first.version, "0.3.8");
  assert.match(
    await readFile(join(root, "src/generated/app-version.ts"), "utf8"),
    /APP_VERSION = "0.3.8"/
  );
  await mkdir(join(root, "public/licenses"));
  await mkdir(join(root, "public/assets"));
  await writeFile(join(root, "public/licenses/react-LICENSE.txt"), "generated");
  await writeFile(join(root, "public/assets/chunk.js"), "generated");
  await writeFile(join(root, "public/app-entry.js"), "generated");
  await writeFile(join(root, "public/version.json"), "generated");
  assert.deepEqual(await prepareVersion(root), first);
  await writeFile(join(root, "src/main.tsx"), "changed");
  assert.notEqual((await prepareVersion(root)).buildId, first.buildId);
});

test("PR gate reads merge-base changes and committed versions", async (t) => {
  const root = await workspace(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Deploy Test");
  git("config", "user.email", "deploy-test@example.invalid");
  const commit = (message) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  await writeFile(join(root, "package.json"), '{"version":"0.3.7"}');
  const base = commit("base");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/main.tsx"), "export const app = true;");
  commit("runtime without bump");
  assert.throws(() => requireVersion(base, root), /require package version/);
  await writeFile(join(root, "package.json"), '{"version":"0.3.8"}');
  commit("version bump");
  assert.doesNotThrow(() => requireVersion(base, root));
});

test("CI accepts only latest successful push run for exact main SHA/repo/workflow", () => {
  const run = {
    head_sha: sha,
    head_branch: "main",
    event: "push",
    repository: { full_name: repo },
    path: ".github/workflows/ci.yml",
    run_number: 1,
    run_attempt: 1,
    status: "completed",
    conclusion: "success"
  };
  const verdict = (...runs) => successfulRun({ workflow_runs: runs }, sha, repo);
  assert.equal(verdict(run), true);
  assert.equal(verdict(), false);
  for (const replacement of [
    { head_sha: olderSha },
    { head_branch: "feature" },
    { event: "pull_request" },
    { repository: { full_name: "other/repo" } },
    { path: ".github/workflows/other.yml" },
    { status: "in_progress" },
    { conclusion: "skipped" },
    { conclusion: "failure" }
  ])
    assert.equal(verdict({ ...run, ...replacement }), false);
  assert.equal(verdict(run, { ...run, run_attempt: 2, conclusion: "failure" }), false);
});

test("GitHub query cooldown is global across several changing main SHAs", async (t) => {
  const root = await workspace(t);
  const file = join(root, "query.json");
  const start = 1000000;
  assert.equal(await reserveQuery(file, sha, start), true);
  for (const [nextSha, elapsed] of [
    [olderSha, 60000],
    ["c".repeat(40), 120000],
    ["d".repeat(40), 299999]
  ])
    assert.equal(await reserveQuery(file, nextSha, start + elapsed), false);
  assert.equal((await queryState(file)).sha, sha);
  assert.equal(await reserveQuery(file, olderSha, start + 300000), true);
});

test("GitHub 403/429 and network failures fail closed and preserve retry deadlines", async (t) => {
  const root = await workspace(t);
  const file = join(root, "query.json");
  let now = 2000000;
  await reserveQuery(file, sha, now);
  let calls = 0;
  const reset = now + 900000;
  const fetcher = async () => {
    calls++;
    return new Response("{}", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset / 1000) }
    });
  };
  await assert.rejects(
    githubRequest("https://api.github.com/", {}, file, fetcher, () => now),
    WaitForCi
  );
  now += 300001;
  assert.equal(await reserveQuery(file, olderSha, now), false);
  await assert.rejects(
    githubRequest("https://api.github.com/", {}, file, fetcher, () => now),
    WaitForCi
  );
  assert.equal(calls, 1);
  now = reset + 1;
  assert.equal(await reserveQuery(file, olderSha, now), true);
  const throttled = new Response("{}", { status: 429, headers: { "retry-after": "600" } });
  assert.equal(responseNotBefore(throttled, now), now + 600000);
  const dateRetry = new Response("{}", {
    status: 429,
    headers: { "retry-after": new Date(now + 1200000).toUTCString() }
  });
  assert.ok(responseNotBefore(dateRetry, now) >= now + 1199000);
  const exhausted = new Response("{}", {
    status: 200,
    headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((now + 900000) / 1000) }
  });
  assert.equal(responseNotBefore(exhausted, now), now + 900000);
  await assert.rejects(
    githubRequest(
      "https://api.github.com/",
      {},
      file,
      async () => {
        throw new Error("network");
      },
      () => now
    ),
    WaitForCi
  );
  const allowed = await githubRequest(
    "https://api.github.com/",
    {},
    file,
    async () => new Response('{"workflow_runs":[]}'),
    () => now
  );
  assert.equal(successfulRun(allowed, sha, repo), false);
});

test("allowlist blocks secret files, traversal and path escapes", () => {
  for (const file of [
    "../key",
    "/etc/passwd",
    "assets/../../key",
    ".env",
    "x/.secret",
    "key.pem",
    "a\\b",
    "C:/key",
    "package.json",
    "node_modules/private.js",
    "deployment.json"
  ])
    assert.throws(() => safeAsset(file));
  assert.equal(safeAsset("assets/chunk-AB12.js"), "assets/chunk-AB12.js");
  assert.throws(() => inside(join(tmpdir(), "mtp"), "../foreign"));
});

test("package exports only manifest files and matching PWA identity", async (t) => {
  const root = await workspace(t);
  const build = await fixture(root);
  await writeFile(join(build, "public", "not-in-manifest.txt"), "private");
  const target = join(root, "release");
  const metadata = await packageRelease(build, target, sha);
  assert.equal(metadata.sourceSha, sha);
  assert.equal(metadata.version, "0.3.8");
  assert.equal(metadata.buildId, buildId);
  assert.equal(metadata.files["not-in-manifest.txt"], undefined);
  await assert.rejects(readFile(join(target, "not-in-manifest.txt")), { code: "ENOENT" });
  await writeFile(
    join(build, "public", "version.json"),
    JSON.stringify({ version: "0.3.7", buildId })
  );
  await assert.rejects(packageRelease(build, join(root, "bad"), sha), /metadata/);
});

test("package rejects symlink directory escaping public", async (t) => {
  const root = await workspace(t);
  const build = await fixture(root);
  const external = join(root, "external");
  await mkdir(external);
  await writeFile(join(external, "payload.js"), "private");
  await symlink(
    external,
    join(build, "public", "linked"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const manifest = JSON.parse(await readFile(join(build, ".release-assets.json")));
  manifest.push("linked/payload.js");
  await writeFile(join(build, ".release-assets.json"), JSON.stringify(manifest));
  await assert.rejects(packageRelease(build, join(root, "bad"), sha), /regular file/);
});

test("public health verifies every byte and rejects stale metadata or asset", async (t) => {
  const root = await workspace(t);
  const target = join(root, "release");
  const metadata = await packageRelease(await fixture(root), target, sha);
  const fetcher = async (url) => new Response(await readFile(join(target, url.pathname.slice(1))));
  await verifyPublic("https://example.invalid", metadata, fetcher);
  await assert.rejects(verifyPublic("http://example.invalid", metadata, fetcher), /HTTPS/);
  await writeFile(join(target, "app-entry.js"), "stale");
  await assert.rejects(verifyPublic("https://example.invalid", metadata, fetcher), /checksum/);
  await assert.rejects(
    verifyPublic("https://example.invalid", { ...metadata, sourceSha: olderSha }, fetcher),
    /sourceSha/
  );
});

test(
  "failed activation restores previous release; first failure removes current",
  {
    skip: process.platform !== "linux" && "Linux rename/symlink semantics; exercised in CI and VDS"
  },
  async (t) => {
    const root = await workspace(t);
    const previous = join(root, "releases", olderSha);
    const next = join(root, "releases", sha);
    await mkdir(previous, { recursive: true });
    await mkdir(next);
    const failure = async () => {
      throw new Error("health failed");
    };
    await assert.rejects(activate(root, next, {}, failure), /health failed/);
    assert.equal(await currentRelease(root), null);
    await switchRelease(root, previous);
    await assert.rejects(activate(root, next, {}, failure), /health failed/);
    assert.equal(await currentRelease(root), previous);
    await activate(root, next, {}, async () => {});
    assert.equal(await currentRelease(root), next);
    await assert.rejects(switchRelease(root, dirname(root)), /managed release/);
  }
);
