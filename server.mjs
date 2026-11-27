import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url)),
  publicDir = join(root, "public");
const port = Number(process.env.PORT || 5210),
  host = "127.0.0.1";
const basePath = (process.env.BASE_PATH || "").replace(/\/$/, "");
const files = new Set();
async function inventory(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) await inventory(file);
    else files.add(relative(publicDir, file).replaceAll("\\", "/"));
  }
}
await inventory(publicDir);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https://invest-brands.cdn-tinkoff.ru; connect-src 'self' https://api.bybit.com wss://stream.bybit.com https://openapi.okx.com wss://ws.okx.com https://invest-public-api.tbank.ru wss://invest-public-api.tbank.ru https://accounts.google.com/gsi/ https://www.googleapis.com https://oauth.yandex.ru https://login.yandex.ru https://cloud-api.yandex.net https://*.dst.yandex.net https://*.disk.yandex.net https://downloader.dst.yandex.ru https://downloader.disk.yandex.ru https://*.storage.yandex.net; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  res.setHeader("Cache-Control", "no-cache");
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  try {
    let pathname = new URL(req.url, "http://localhost").pathname;
    if (basePath) {
      if (pathname === basePath) {
        res.writeHead(308, { Location: basePath + "/" });
        res.end();
        return;
      }
      if (!pathname.startsWith(basePath + "/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      pathname = pathname.slice(basePath.length);
    }
    const file = decodeURIComponent(pathname.slice(1)) || "index.html";
    if (!files.has(file)) await inventory(publicDir);
    if (!files.has(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (file === "version.json") res.setHeader("Cache-Control", "no-store");
    if (file === "service-worker.js") res.setHeader("Service-Worker-Allowed", `${basePath}/`);
    const body = await readFile(join(publicDir, file));
    const extension = file.slice(file.lastIndexOf("."));
    res.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
      "Content-Length": body.length
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(port, host, () =>
  console.log(`PWA: http://${host}:${server.address().port}${basePath}/ · static only`)
);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE" ? `Порт ${port} занят.` : "Не удалось запустить сервер."
  );
  process.exitCode = 1;
});
function shutdown() {
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
