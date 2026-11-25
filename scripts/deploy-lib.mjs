import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const shaPattern = /^[a-f0-9]{40}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const json = async (file) => JSON.parse(await readFile(file, "utf8"));

export function inside(root, candidate) {
  const result = resolve(root, candidate);
  if (!result.startsWith(resolve(root) + sep)) throw new Error("Path outside deployment directory");
  return result;
}

export function safeAsset(name) {
  if (
    typeof name !== "string" ||
    !name ||
    isAbsolute(name) ||
    name.includes("\\") ||
    name.includes(":") ||
    name.split("/").some((part) => !part || part.startsWith(".")) ||
    !/^[a-zA-Z0-9_./-]+$/.test(name) ||
    /(?:^|\/)(?:node_modules|AGENTS\.md|package\.json|pnpm-lock\.yaml|deployment\.json)(?:\/|$)/i.test(
      name
    ) ||
    /\.(?:pem|key|env|map)$/i.test(name)
  )
    throw new Error("Unsafe release asset");
  return name;
}

export async function packageRelease(buildDir, target, sourceSha) {
  if (!shaPattern.test(sourceSha)) throw new Error("Invalid source SHA");
  const publicDir = await realpath(join(buildDir, "public"));
  const assets = await json(join(buildDir, ".release-assets.json"));
  if (!Array.isArray(assets) || assets.length === 0 || new Set(assets).size !== assets.length)
    throw new Error("Invalid asset manifest");
  for (const required of ["index.html", "app-entry.js", "service-worker.js", "version.json"])
    if (!assets.includes(required)) throw new Error(`Missing release asset: ${required}`);
  const version = await json(join(publicDir, "version.json"));
  const pkg = await json(join(buildDir, "package.json"));
  if (version.version !== pkg.version || !/^[a-f0-9]{16}$/.test(version.buildId))
    throw new Error("Build metadata does not match package version");
  const worker = await readFile(join(publicDir, "service-worker.js"), "utf8");
  if (!worker.includes(JSON.stringify(version.buildId)) || !worker.includes("ACTIVATE_UPDATE"))
    throw new Error("PWA update contract is missing");
  await mkdir(target, { recursive: false });
  const files = {};
  try {
    for (const asset of assets) {
      safeAsset(asset);
      const source = inside(publicDir, asset);
      const canonical = await realpath(source);
      if (canonical !== source || !(await lstat(source)).isFile())
        throw new Error("Release asset must be a regular file inside public");
      const destination = inside(target, asset);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      files[asset] = hash(await readFile(destination));
    }
    const metadata = {
      sourceSha,
      version: version.version,
      buildId: version.buildId,
      files
    };
    await writeFile(join(target, "deployment.json"), JSON.stringify(metadata, null, 2) + "\n");
    return metadata;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

export function successfulRun(body, sha, repo, branch = "main") {
  // Newest matching run wins: a failed rerun must not inherit an earlier success.
  const run = (body.workflow_runs ?? [])
    .filter(
      (item) =>
        item.head_sha === sha &&
        item.head_branch === branch &&
        item.event === "push" &&
        item.repository?.full_name === repo &&
        item.path === ".github/workflows/ci.yml"
    )
    .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  return run?.status === "completed" && run.conclusion === "success";
}

export async function currentRelease(root) {
  const current = join(root, "current");
  try {
    if (!(await lstat(current)).isSymbolicLink()) throw new Error("current must be a symlink");
    const target = resolve(root, await readlink(current));
    const releases = join(root, "releases");
    if (!target.startsWith(releases + sep) || !shaPattern.test(relative(releases, target)))
      throw new Error("current points outside managed releases");
    return target;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function switchRelease(root, target) {
  const releases = join(root, "releases");
  if (!target.startsWith(releases + sep) || !shaPattern.test(relative(releases, target)))
    throw new Error("Invalid managed release target");
  if ((await realpath(target)) !== target) throw new Error("Release target must not be a symlink");
  const temporary = join(root, `current.next-${process.pid}`);
  await rm(temporary, { force: true });
  await symlink(target, temporary, process.platform === "win32" ? "junction" : "dir");
  try {
    await rename(temporary, join(root, "current"));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function verifyPublic(origin, metadata, fetcher = fetch) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.username || base.password)
    throw new Error("Public origin must be an HTTPS origin");
  const request = async (path) => {
    const url = new URL(path, base);
    url.searchParams.set("release", `${metadata.sourceSha}-${Date.now()}`);
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Public health failed: ${path} HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const actual = JSON.parse((await request("deployment.json")).toString("utf8"));
  for (const field of ["sourceSha", "version", "buildId"])
    if (actual[field] !== metadata[field]) throw new Error(`Public ${field} mismatch`);
  if (JSON.stringify(actual.files) !== JSON.stringify(metadata.files))
    throw new Error("Public asset manifest mismatch");
  for (const [asset, checksum] of Object.entries(metadata.files)) {
    safeAsset(asset);
    if (hash(await request(asset)) !== checksum)
      throw new Error(`Public checksum mismatch: ${asset}`);
  }
}

export async function activate(root, target, metadata, health = verifyPublic, origin) {
  const previous = await currentRelease(root);
  await switchRelease(root, target);
  try {
    await health(origin, metadata);
  } catch (error) {
    if (previous) await switchRelease(root, previous);
    else await rm(join(root, "current"));
    throw error;
  }
}
