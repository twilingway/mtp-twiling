import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parseVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Release version must be a stable major.minor.patch");
  return version.split(".").map(BigInt);
}

export function versionIncreased(previous, current) {
  const before = parseVersion(previous);
  const after = parseVersion(current);
  for (let index = 0; index < 3; index++) {
    if (after[index] > before[index]) return true;
    if (after[index] < before[index]) return false;
  }
  return false;
}

export function isReleaseInput(file) {
  return (
    /^(src\/|public\/)/.test(file) ||
    [
      "package.json",
      "pnpm-lock.yaml",
      "scripts/build.mjs",
      "scripts/prepare-version.mjs",
      "scripts/build-vendor.mjs",
      "scripts/service-worker.template.js",
      "tsconfig.json"
    ].includes(file)
  );
}

export function requireVersion(base, cwd = process.cwd()) {
  if (!/^[a-f0-9]{40}$/.test(base ?? "")) throw new Error("Expected a full PR base SHA");
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n");
  if (!changed.some(isReleaseInput)) return;
  const previous = JSON.parse(git("show", `${base}:package.json`)).version;
  const current = JSON.parse(git("show", "HEAD:package.json")).version;
  if (!versionIncreased(previous, current))
    throw new Error(`Application changes require package version > ${previous}; got ${current}`);
  console.log(`Release version: ${previous} -> ${current}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireVersion(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
