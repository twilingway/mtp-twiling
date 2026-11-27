import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { context } from "esbuild";
import { cloudPublicDefines } from "./cloud-public-env.mjs";
import {
  browserBuildOptions,
  browserEntryPoints,
  installEntryPoints,
  copyBrowserLicenses
} from "./browser-build-config.mjs";
import {
  appPrefix,
  clientSource,
  disableWorker,
  loadStatic,
  parseOptions,
  requestFile,
  sameOutputFiles,
  staticInputs
} from "./dev-files.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
const csp =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https://invest-brands.cdn-tinkoff.ru; connect-src 'self' https://api.bybit.com wss://stream.bybit.com https://openapi.okx.com wss://ws.okx.com https://invest-public-api.tbank.ru wss://invest-public-api.tbank.ru https://accounts.google.com/gsi/ https://www.googleapis.com https://oauth.yandex.ru https://login.yandex.ru https://cloud-api.yandex.net https://*.dst.yandex.net https://*.disk.yandex.net https://downloader.dst.yandex.ru https://downloader.disk.yandex.ru https://*.storage.yandex.net; worker-src 'none'; manifest-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export async function startDev({ port = 5210, projectRoot = root, outputDirectory } = {}) {
  const outdir = outputDirectory ?? join(projectRoot, "artifacts/dev-runtime");
  const publicDir = join(projectRoot, "public");
  const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  let closed = false,
    ready = false,
    counter = 0,
    timer,
    polling = false;
  const epoch = Date.now().toString(36);
  const clients = new Set(),
    contexts = [],
    groups = new Map();
  let pollingTask = Promise.resolve();
  let statics = await loadStatic(publicDir, outdir);
  await copyBrowserLicenses(projectRoot, outdir);
  const licenses = new Map();
  for (const name of await readdir(join(outdir, "licenses")))
    licenses.set(`licenses/${name}`, await readFile(join(outdir, "licenses", name)));
  groups.set("licenses", licenses);
  function broadcast(event, value) {
    for (const client of clients)
      if (!client.write(`event: ${event}\ndata: ${value}\n\n`)) {
        clients.delete(client);
        client.end();
      }
  }
  function changed() {
    if (!ready || closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      counter++;
      broadcast("revision", `${epoch}-${counter}`);
    }, 80);
  }
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    response.setHeader("Content-Security-Policy", csp);
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const pathname = request.url.split("?")[0];
    if (["/", "/index.html", "/__dev/app"].includes(pathname)) {
      response.writeHead(302, { Location: appPrefix }).end();
      return;
    }
    if (pathname === "/__dev/events") {
      if (clients.size >= 32) {
        response.writeHead(503, { "Retry-After": "3" }).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.write(`event: revision\ndata: ${epoch}-${counter}\n\n`);
      clients.add(response);
      response.on("close", () => clients.delete(response));
      return;
    }
    let body, type;
    if (pathname === "/__dev/client.js") {
      body = Buffer.from(clientSource);
      type = types[".js"];
    } else {
      const name = requestFile(request.url);
      if (name) {
        body = statics.files.get(name);
        for (const files of groups.values()) body ??= files.get(name);
        type = types[extname(name)];
      }
    }
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": type || "application/octet-stream",
      "Content-Length": body.length
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearTimeout(timer);
    for (const client of clients) client.end();
    clients.clear();
    server.closeAllConnections();
    await Promise.all([pollingTask, ...contexts.map((buildContext) => buildContext.dispose())]);
    if (server.listening) await new Promise((done) => server.close(done));
  }
  let pollTimer;
  try {
    const devPlugin = (group) => ({
      name: `dev-${group}`,
      setup(build) {
        let hadBuildError = false;
        build.onResolve({ filter: /generated\/app-version\.js$/ }, () => ({
          path: "version",
          namespace: "dev-version"
        }));
        build.onLoad({ filter: /.*/, namespace: "dev-version" }, () => ({
          contents: `export const APP_VERSION = ${JSON.stringify(`${version}-dev`)}; export const BUILD_ID = "dev";`,
          loader: "js"
        }));
        build.onLoad({ filter: /[\\/]services[\\/]pwa\.ts$/ }, async ({ path }) => ({
          contents: disableWorker(await readFile(path, "utf8")),
          loader: "ts"
        }));
        build.onEnd(async (result) => {
          if (closed) return;
          if (result.errors.length) {
            hadBuildError = true;
            broadcast(
              "build-error",
              "Build failed. See terminal; the last successful app remains available."
            );
            return;
          }
          const files = new Map();
          for (const output of result.outputFiles ?? []) {
            const name = relative(outdir, output.path).replaceAll("\\", "/");
            files.set(name, Buffer.from(output.contents));
          }
          if (sameOutputFiles(groups.get(group), files)) {
            if (hadBuildError) {
              hadBuildError = false;
              changed();
            }
            return;
          }
          hadBuildError = false;
          for (const [name, contents] of files) {
            const outputPath = join(outdir, name);
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, contents);
          }
          // Keep only this context's current outputs; repeated edits must not accumulate chunks.
          for (const name of groups.get(group)?.keys() ?? [])
            if (!files.has(name))
              await unlink(join(outdir, name)).catch((error) => {
                if (error.code !== "ENOENT") throw error;
              });
          groups.set(group, files);
          changed();
        });
      }
    });
    const common = {
      ...browserBuildOptions(projectRoot, outdir),
      minify: false,
      write: false,
      logLevel: "info"
    };
    contexts.push(
      await context({
        ...common,
        entryPoints: installEntryPoints,
        format: "iife",
        plugins: [devPlugin("install")]
      })
    );
    contexts.push(
      await context({
        ...common,
        entryPoints: browserEntryPoints,
        splitting: true,
        format: "esm",
        chunkNames: "assets/[name]-[hash]",
        define: { ...cloudPublicDefines(projectRoot), "process.env.NODE_ENV": '"development"' },
        plugins: [devPlugin("app")]
      })
    );
    await Promise.all(contexts.map((buildContext) => buildContext.rebuild()));
    await Promise.all(contexts.map((buildContext) => buildContext.watch()));
    // Only known public assets are polled; esbuild watches the actual TS/TSX import graph.
    pollTimer = setInterval(() => {
      if (polling || closed) return;
      polling = true;
      pollingTask = (async () => {
        try {
          const signature = JSON.stringify([...(await staticInputs(publicDir))]);
          if (signature !== statics.signature && !closed) {
            const next = await loadStatic(publicDir, outdir);
            const outputChanged = !sameOutputFiles(statics.files, next.files);
            statics = next;
            if (outputChanged) changed();
          }
        } catch (error) {
          console.error("[dev] Static update failed:", error.message);
        } finally {
          polling = false;
        }
      })();
    }, 300);
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", done);
    });
    ready = true;
    console.log(
      `[dev] http://127.0.0.1:${server.address().port}${appPrefix} · incremental build + reload · Ctrl+C to stop`
    );
    return { close, server };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help)
      console.log(
        "Usage: node scripts/dev.mjs [--port 5210]\nLoopback only. Incremental esbuild + browser reload; no typecheck, tests, production build or deployment."
      );
    else {
      let runtime,
        stopping = false;
      const shutdown = () => {
        stopping = true;
        void runtime?.close().catch((error) => {
          console.error(error.message);
          process.exitCode = 1;
        });
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      runtime = await startDev(options);
      if (stopping) await runtime.close();
    }
  } catch (error) {
    console.error(`[dev] ${error.message}`);
    process.exitCode = 1;
  }
}
