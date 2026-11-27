import { readFile, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

export const appPrefix = "/__dev/app/";
const staticExtensions = new Set([
  ".html",
  ".css",
  ".webmanifest",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".ico",
  ".woff",
  ".woff2"
]);

export function parseOptions(args) {
  let port = 5210;
  let help = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (["--help", "-h"].includes(argument)) help = true;
    else if (argument === "--port") {
      const value = args[++index];
      if (!/^\d+$/.test(value ?? "")) throw new Error("--port requires an integer from 1 to 65535");
      port = Number(value);
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (port < 1 || port > 65535) throw new Error("--port requires an integer from 1 to 65535");
  return { port, help };
}

export function requestFile(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.split("?")[0]);
  } catch {
    return null;
  }
  if (!pathname.startsWith(appPrefix)) return null;
  const file = pathname.slice(appPrefix.length) || "index.html";
  if (file.includes("\\") || file.includes("\0")) return null;
  if (
    file.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  )
    return null;
  return file;
}

export function devHtml(source) {
  const entry = /<script\s+type="module"\s+src="\.\/app-entry\.js"><\/script>/;
  if (!entry.test(source))
    throw new Error("Cannot find the application module in public/index.html");
  return source
    .replace(entry, '<script type="module" src="/__dev/client.js"></script>')
    .replace(/<link\s+rel="manifest"[^>]*>/g, "");
}

export function disableWorker(source) {
  const guard = 'if (!("serviceWorker" in navigator) || !window.isSecureContext) return dispose;';
  if (!source.includes(guard))
    throw new Error("PWA registration guard changed; update the dev plugin");
  return source.replace(guard, "return dispose;");
}

export async function staticInputs(publicDir) {
  const files = new Map();
  async function scan(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        if (!["assets", "generated", "licenses"].includes(item.name)) await scan(path);
      } else if (
        staticExtensions.has(extname(item.name)) ||
        (relative(publicDir, path).startsWith("vendor") && extname(item.name) === ".js")
      ) {
        const name = relative(publicDir, path).replaceAll("\\", "/");
        const stat = await lstat(path);
        if (stat.isFile()) files.set(name, `${stat.mtimeMs}:${stat.size}`);
      }
    }
  }
  await scan(publicDir);
  return files;
}

export async function loadStatic(publicDir, outdir) {
  const inputs = await staticInputs(publicDir);
  const files = new Map();
  for (const name of inputs.keys()) {
    let contents = await readFile(join(publicDir, name));
    if (name === "index.html") contents = Buffer.from(devHtml(contents.toString("utf8")));
    files.set(name, contents);
    const output = join(outdir, name);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, contents);
  }
  return { files, signature: JSON.stringify([...inputs]) };
}

export const clientSource = `
const worker = navigator.serviceWorker;
if (worker) {
  const controlled = Boolean(worker.controller);
  const registrations = await worker.getRegistrations();
  await Promise.all(registrations.filter(registration =>
    new URL(registration.scope).origin === location.origin
  ).map(registration => registration.unregister()));
  if (controlled) location.reload();
  else await start();
} else await start();
async function start() {
  let revision;
  const events = new EventSource('/__dev/events');
  events.addEventListener('revision', event => {
    if (revision !== undefined && revision !== event.data) location.reload();
    revision = event.data;
  });
  events.addEventListener('build-error', event => console.error('[dev]', event.data));
  addEventListener('pagehide', () => events.close(), {once: true});
  await import('/__dev/app/app-entry.js');
}
`;
