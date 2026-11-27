import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clientSource,
  devHtml,
  disableWorker,
  loadStatic,
  parseOptions,
  requestFile
} from "../scripts/dev-files.mjs";
import {
  browserBuildOptions,
  browserEntryPoints,
  installEntryPoints,
  copyBrowserLicenses
} from "../scripts/browser-build-config.mjs";

test("dev CLI is loopback-only and rejects ambiguous/invalid port arguments", () => {
  assert.deepEqual(parseOptions([]), { port: 5210, help: false });
  assert.deepEqual(parseOptions(["--port", "5288"]), { port: 5288, help: false });
  assert.equal(parseOptions(["--help"]).help, true);
  for (const args of [
    ["--port"],
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", "2.5"],
    ["--host", "0.0.0.0"]
  ])
    assert.throws(() => parseOptions(args));
});

test("asset requests reject traversal, hidden files, malformed encoding and other routes", () => {
  assert.equal(requestFile("/__dev/app/"), "index.html");
  assert.equal(requestFile("/__dev/app/assets/chunk.js?x=1"), "assets/chunk.js");
  for (const path of [
    "/.env",
    "/__dev/app/.env",
    "/__dev/app/%2e%2e/.env",
    "/__dev/app/a/../x",
    "/__dev/app/%5c..%5c.env",
    "/__dev/app/%00",
    "/__dev/app/%FF",
    "/__dev/app//x",
    "/__dev/app/./x",
    "/__dev/app/%2fetc/passwd"
  ])
    assert.equal(requestFile(path), null, path);
});

test("dev HTML launches its bootstrap before the app and disables install metadata", () => {
  const source =
    '<head><link rel="manifest" href="./manifest.webmanifest" /><script type="module" src="./app-entry.js"></script></head>';
  const html = devHtml(source);
  assert.match(html, /src="\/__dev\/client\.js"/);
  assert.doesNotMatch(html, /app-entry\.js|rel="manifest"/);
  assert.throws(() => devHtml("<html></html>"));
  assert.match(clientSource, /registration\.unregister\(\)/);
  assert.doesNotMatch(clientSource, /indexedDB|caches\.delete|localStorage\.clear/);
});

test("PWA dev transform stops before any registration and detects a changed source contract", () => {
  const source =
    'async function setup() { const dispose = () => {}; if (!("serviceWorker" in navigator) || !window.isSecureContext) return dispose; navigator.serviceWorker.register("service-worker.js"); return dispose; }';
  let registered = false;
  const transformed = disableWorker(source);
  const setup = new Function("navigator", `${transformed}; return setup;`)({
    serviceWorker: {
      register() {
        registered = true;
      }
    }
  });
  return setup().then(() => {
    assert.equal(registered, false);
    assert.throws(() => disableWorker("changed source"));
  });
});

test("static snapshots update/remove known inputs without serving source secrets or generated release files", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "mtp-dev-test-"));
  try {
    const publicDir = join(temporary, "public"),
      outdir = join(temporary, "runtime");
    await mkdir(publicDir);
    await writeFile(
      join(publicDir, "index.html"),
      '<script type="module" src="./app-entry.js"></script>'
    );
    await writeFile(join(publicDir, "style.css"), "body { color: red; }");
    await writeFile(join(publicDir, ".env"), "private");
    await writeFile(join(publicDir, "version.json"), "release");
    await writeFile(join(publicDir, "service-worker.js"), "release");
    await mkdir(join(publicDir, "assets"));
    await writeFile(join(publicDir, "assets", "old.js"), "release");
    try {
      await symlink(join(publicDir, ".env"), join(publicDir, "leak.css"));
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    }
    const first = await loadStatic(publicDir, outdir);
    assert.deepEqual([...first.files.keys()].sort(), ["index.html", "style.css"]);
    assert.match(await readFile(join(outdir, "index.html"), "utf8"), /__dev\/client/);
    await writeFile(join(publicDir, "style.css"), "body { color: blue; }");
    const second = await loadStatic(publicDir, outdir);
    assert.notEqual(first.signature, second.signature);
    assert.match(second.files.get("style.css").toString(), /blue/);
    await rm(join(publicDir, "style.css"));
    assert.equal((await loadStatic(publicDir, outdir)).files.has("style.css"), false);
    assert.equal(await readFile(join(publicDir, "version.json"), "utf8"), "release");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("shared browser config keeps standalone model entries and copies existing license inputs", async () => {
  assert.deepEqual(Object.keys(browserEntryPoints).sort(), [
    "app-entry",
    "backup-format",
    "drawing-model",
    "history-codec",
    "market-model",
    "mtp"
  ]);
  assert.equal(installEntryPoints["pwa-install-entry"], "src/pwa-install-entry.ts");
  assert.equal(browserBuildOptions("project", "public").outdir, "public");
  const temporary = await mkdtemp(join(tmpdir(), "mtp-dev-license-"));
  try {
    await mkdir(join(temporary, "node_modules", "react"), { recursive: true });
    await writeFile(join(temporary, "node_modules", "react", "LICENSE"), "React license");
    await copyBrowserLicenses(temporary, join(temporary, "runtime"));
    assert.equal(
      await readFile(join(temporary, "runtime", "licenses", "react-LICENSE.txt"), "utf8"),
      "React license"
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
