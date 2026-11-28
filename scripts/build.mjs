import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { prepareVersion } from "./prepare-version.mjs";
import { cloudPublicDefines } from "./cloud-public-env.mjs";
import {
  browserBuildOptions,
  browserEntryPoints,
  installEntryPoints,
  copyBrowserLicenses
} from "./browser-build-config.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  publicDir = join(root, "public");
async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) {
      if (!["vendor", "assets", "generated"].includes(item.name)) files.push(...(await walk(file)));
    } else files.push(file);
  }
  return files;
}
const own = (path) => {
  const file = resolve(root, path);
  if (!file.startsWith(publicDir + sep)) throw new Error("Build output outside public");
  return file;
};
let previous = [];
try {
  previous = JSON.parse(await readFile(join(root, ".build-manifest.json"), "utf8"));
} catch {}
for (const file of previous) {
  try {
    await unlink(own(file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const legacy = [
  "app.js",
  "app-version.js",
  "backup-format.js",
  "drawing-model.js",
  "drawing-settings.js",
  "drawing-ui.js",
  "history-codec.js",
  "market-model.js",
  "mtp.js",
  "pwa.js",
  "storage.js",
  "tbank-client.js"
];
for (const file of legacy) {
  try {
    await unlink(join(publicDir, file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const { version, buildId } = await prepareVersion(root);
const browserBuild = browserBuildOptions(root, "public");
const installCapture = await build({
  ...browserBuild,
  entryPoints: installEntryPoints,
  format: "iife"
});
const result = await build({
  ...browserBuild,
  entryPoints: browserEntryPoints,
  splitting: true,
  format: "esm",
  chunkNames: "assets/[name]-[hash]",
  define: {
    ...cloudPublicDefines(root),
    "process.env.NODE_ENV": '"production"',
    // Eligible MTP panes activate lazily; ?mtpRaster=native keeps the native fallback.
    __MTP_RASTER_DEV__: "true"
  }
});
const outputs = [
  ...Object.keys(installCapture.metafile.outputs),
  ...Object.keys(result.metafile.outputs)
];
await writeFile(join(root, ".build-manifest.json"), JSON.stringify(outputs));
await copyBrowserLicenses(root, publicDir);
const staticFiles = (await walk(publicDir)).filter(
  (file) => !["version.json", "service-worker.js"].includes(relative(publicDir, file))
);
const assets = [
  ...new Set([
    ...staticFiles.map((file) => relative(publicDir, file).replaceAll("\\", "/")),
    ...outputs.map((file) => relative(publicDir, own(file)).replaceAll("\\", "/"))
  ])
].sort();
const template = await readFile(join(root, "scripts/service-worker.template.js"), "utf8");
await writeFile(
  join(publicDir, "service-worker.js"),
  template
    .replace("__BUILD__", JSON.stringify(buildId))
    .replace("__ASSETS__", JSON.stringify(assets))
);
await writeFile(
  join(publicDir, "version.json"),
  JSON.stringify({ version, buildId, name: "mtp.twiling.ru" }, null, 2) + "\n"
);
await writeFile(
  join(root, ".release-assets.json"),
  JSON.stringify([...assets, "service-worker.js", "version.json"], null, 2)
);
console.log(`MTP Twiling ${version} · build ${buildId} · ${assets.length} assets`);
