import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  activate,
  currentRelease,
  json,
  packageRelease,
  shaPattern,
  successfulRun,
  verifyPublic
} from "./deploy-lib.mjs";
import { githubRequest, reserveQuery, WaitForCi } from "./deploy-rate.mjs";

const exists = async (path) =>
  access(path).then(
    () => true,
    () => false
  );
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

export function expectedDeploymentSha(value = process.env.MTP_DEPLOY_EXPECTED_SHA) {
  if (value !== undefined && !shaPattern.test(value))
    throw new Error("MTP_DEPLOY_EXPECTED_SHA must be a full lowercase 40-character Git SHA");
  return value;
}

function assertExpectedSha(sha, expected) {
  if (expected !== undefined && sha !== expected)
    throw new Error("Selected main SHA differs from MTP_DEPLOY_EXPECTED_SHA; deployment stopped");
}

function command(program, args, cwd, output = false) {
  try {
    const env = { ...process.env, CI: "true" };
    // Build tasks need no GitHub API credential.
    if (program !== "git") delete env.GH_TOKEN;
    return execFileSync(program, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: output ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024
    })?.trim();
  } catch {
    throw new Error(`${program} failed; deployment stopped`);
  }
}

export async function configuration(file) {
  const config = await json(file);
  if (!/^[-\w]+\/[-.\w]+$/.test(config.repository ?? ""))
    throw new Error("Set repository to owner/name");
  if (config.branch !== "main") throw new Error("Only main may be released");
  if (
    typeof config.root !== "string" ||
    config.root !== resolve(config.root) ||
    config.root === "/"
  )
    throw new Error("Set an absolute, dedicated deployment root");
  if (config.root !== process.env.MTP_DEPLOY_ROOT) throw new Error("Config and lock roots differ");
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password)
    throw new Error("Set an HTTPS publicOrigin");
  return config;
}

async function latestMain(repo) {
  const output = command("git", ["ls-remote", "origin", "refs/heads/main"], repo);
  const sha = output.split(/\s/)[0];
  if (!shaPattern.test(sha)) throw new Error("Cannot resolve exact origin/main SHA");
  return sha;
}

async function green(config, sha) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const url = new URL(
    `https://api.github.com/repos/${config.repository}/actions/workflows/ci.yml/runs`
  );
  url.search = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: sha,
    per_page: "100"
  });
  const body = await githubRequest(url, headers, join(config.root, "state", "last-query.json"));
  return successfulRun(body, sha, config.repository);
}

async function release(config, sha, expected) {
  const { root } = config;
  const repo = join(root, "repo");
  command("git", ["fetch", "--no-tags", "origin", "refs/heads/main"], repo);
  if (command("git", ["rev-parse", "FETCH_HEAD"], repo) !== sha)
    throw new WaitForCi("main advanced while preparing; wait for its exact CI");
  const temporary = await mkdtemp(join(root, "build-"));
  const archive = join(temporary, "source.tar");
  const buildDir = join(temporary, "source");
  const target = join(root, "releases", sha);
  const staging = join(root, "releases", `.staging-${sha}`);
  try {
    await mkdir(buildDir);
    command("git", ["archive", "--format=tar", `--output=${archive}`, sha], repo);
    command("tar", ["-xf", archive, "-C", buildDir], temporary);
    command(
      "pnpm",
      ["install", "--frozen-lockfile", "--child-concurrency=1", "--network-concurrency=1"],
      buildDir,
      true
    );
    // Exact-SHA hosted CI owns all checks. Build the same payload locally on VDS;
    // the builder prepares version metadata without repeating tsc/lint/tests.
    command("node", ["scripts/build.mjs"], buildDir, true);
    await rm(staging, { recursive: true, force: true });
    const metadata = await packageRelease(buildDir, staging, sha);
    // A release is immutable once present: never overwrite bytes used by current.
    if (await exists(target)) {
      const previous = await json(join(target, "deployment.json"));
      if (JSON.stringify(previous) !== JSON.stringify(metadata))
        throw new Error("Existing SHA has different build output; inspect reproducibility");
      await rm(staging, { recursive: true });
    } else await rename(staging, target);
    if ((await latestMain(repo)) !== sha || !(await green(config, sha)))
      throw new WaitForCi("main or CI changed before activation; keeping current release");
    assertExpectedSha(sha, expected);
    await activate(root, target, metadata, verifyPublic, config.publicOrigin);
    await writeFile(join(root, "state", "deployed-sha"), sha + "\n");
    log(`Released ${sha} v${metadata.version} build ${metadata.buildId}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}

async function watch(config) {
  const expected = expectedDeploymentSha();
  const state = join(config.root, "state");
  if (await exists(join(state, "paused"))) return log("Paused; current release retained");
  const sha = await latestMain(join(config.root, "repo"));
  assertExpectedSha(sha, expected);
  const current = await currentRelease(config.root);
  if (current && (await json(join(current, "deployment.json"))).sourceSha === sha) return;
  if (await exists(join(state, "failed-sha"))) {
    if ((await readFile(join(state, "failed-sha"), "utf8")).trim() === sha)
      return log(`SHA ${sha} previously failed; use resume after diagnosis`);
  }
  const queryFile = join(state, "last-query.json");
  // Global cooldown survives changing main SHAs. One cycle makes at most two
  // requests (initial CI and the exact-SHA check immediately before activation).
  if (!(await reserveQuery(queryFile, sha))) return;
  if (!(await green(config, sha))) return log(`Waiting for successful main push CI at ${sha}`);
  try {
    await release(config, sha, expected);
    await rm(join(state, "failed-sha"), { force: true });
  } catch (error) {
    if (error instanceof WaitForCi) return log(error.message);
    await writeFile(join(state, "failed-sha"), sha + "\n");
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (process.platform !== "linux" || process.env.MTP_DEPLOY_LOCKED !== "1")
    throw new Error("Run through scripts/deploy-static.sh on Linux to acquire the deployment lock");
  const [mode = "watch", argument] = args;
  const config = await configuration(
    process.env.MTP_DEPLOY_CONFIG ?? "/etc/mtp-deploy/config.json"
  );
  const state = join(config.root, "state");
  if (mode === "watch") return watch(config);
  if (mode === "resume") {
    for (const file of ["paused", "failed-sha"]) await rm(join(state, file), { force: true });
    return log("Automatic releases resumed; next timer run checks main CI");
  }
  if (mode === "pause") {
    await writeFile(join(state, "paused"), "operator\n");
    return log("Automatic releases paused");
  }
  if (mode === "rollback" && shaPattern.test(argument ?? "")) {
    await writeFile(join(state, "paused"), "rollback\n");
    const target = join(config.root, "releases", argument);
    const metadata = await json(join(target, "deployment.json"));
    if (metadata.sourceSha !== argument) throw new Error("Rollback metadata SHA mismatch");
    await activate(config.root, target, metadata, verifyPublic, config.publicOrigin);
    await writeFile(join(state, "deployed-sha"), argument + "\n");
    return log(`Rolled back to ${argument}; automatic releases paused`);
  }
  throw new Error("Usage: deploy-static.sh [watch|pause|resume|rollback <full SHA>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
