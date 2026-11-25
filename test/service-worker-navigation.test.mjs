import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const template = readFileSync(
  new URL("../scripts/service-worker.template.js", import.meta.url),
  "utf8"
);
const privacy = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
const shell = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const license = "Licensed under the Apache License, Version 2.0";
const assets = [
  "index.html",
  "privacy.html",
  "licenses/lightweight-charts-LICENSE.txt",
  "icon.svg"
];

function fixture(base = "/", online = true) {
  const scope = `https://example.test${base}`,
    handlers = {},
    contents = new Map(),
    requests = [],
    matches = [];
  const response = (path) => {
    if (path === "index.html")
      return new Response(shell, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (path === "privacy.html")
      return new Response(privacy, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (path.startsWith("licenses/"))
      return new Response(license, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response("image", { headers: { "Content-Type": "image/svg+xml" } });
  };
  const cache = {
    async addAll(urls) {
      for (const url of urls) contents.set(url, response(new URL(url).pathname.slice(base.length)));
    },
    async match(input, options = {}) {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (options.ignoreSearch) url.search = "";
      matches.push(url.href);
      return contents.get(url.href)?.clone();
    }
  };
  vm.runInNewContext(
    template
      .replace("__BUILD__", JSON.stringify("fixture-build"))
      .replace("__ASSETS__", JSON.stringify(assets)),
    {
      URL,
      self: {
        registration: { scope },
        addEventListener: (type, handler) => (handlers[type] = handler)
      },
      caches: { open: async () => cache },
      fetch: async (request) => {
        requests.push(request.url);
        if (!online) throw new TypeError("offline");
        const path = new URL(request.url).pathname.slice(base.length);
        return assets.includes(path) ? response(path) : new Response("Not found", { status: 404 });
      }
    }
  );
  return {
    scope,
    contents,
    requests,
    matches,
    async install() {
      let pending;
      handlers.install({ waitUntil: (promise) => (pending = promise) });
      await pending;
    },
    navigate(path) {
      // Browsers alone construct navigate-mode Requests. Dispatch a real Request with that mode.
      const request = new Request(new URL(path, scope));
      Object.defineProperty(request, "mode", { value: "navigate" });
      let pending;
      handlers.fetch({ request, respondWith: (promise) => (pending = promise) });
      return pending;
    },
    dispatch(request) {
      let pending;
      handlers.fetch({ request, respondWith: (promise) => (pending = promise) });
      return pending;
    }
  };
}

for (const base of ["/", "/quotes/", "/nested/terminal/"]) {
  for (const online of [true, false]) {
    test(`navigate privacy and license preserve exact precached bytes and content type (${base}, online=${online})`, async () => {
      const f = fixture(base, online);
      await f.install();
      for (const [path, expected, type] of [
        ["privacy.html", privacy, "text/html"],
        ["licenses/lightweight-charts-LICENSE.txt", license, "text/plain"]
      ]) {
        const result = await f.navigate(`${path}?from=account`);
        assert.equal(await result.text(), expected);
        assert.match(result.headers.get("Content-Type"), new RegExp(type));
      }
      assert.equal(f.requests.length, 0);
      assert.ok(!f.matches.includes(new URL("index.html", f.scope).href));
    });
  }
  test(`only root and index entry serve the app; missing legal/deep URLs never become shell (${base})`, async () => {
    const f = fixture(base, true);
    await f.install();
    for (const path of ["", "?tab=watchlist", "index.html", "index.html?mode=app"]) {
      assert.equal(await (await f.navigate(path)).text(), shell);
    }
    for (const path of ["terms.html", "legal/privacy.html", "missing-route"]) {
      const result = await f.navigate(path);
      assert.equal(result.status, 404);
      assert.equal(await result.text(), "Not found");
    }
    assert.equal(f.requests.length, 3);
  });
  test(`uncached document goes to its own network URL and offline failure is not hidden (${base})`, async () => {
    const online = fixture(base, true),
      offline = fixture(base, false);
    await online.install();
    await offline.install();
    online.contents.delete(new URL("privacy.html", online.scope).href);
    offline.contents.delete(new URL("privacy.html", offline.scope).href);
    assert.equal(await (await online.navigate("privacy.html")).text(), privacy);
    assert.equal(online.requests[0], new URL("privacy.html", online.scope).href);
    await assert.rejects(offline.navigate("privacy.html"), /offline/);
  });
}

test("navigation outside scope/origin, version requests and non-GET requests remain untouched", async () => {
  const f = fixture("/quotes/");
  await f.install();
  for (const path of [
    "/privacy.html",
    "/quotes-other/privacy.html",
    "https://other.test/quotes/privacy.html",
    "version.json"
  ]) {
    assert.equal(f.navigate(path), undefined);
  }
  assert.equal(
    f.dispatch(new Request(new URL("privacy.html", f.scope), { method: "POST", body: "x" })),
    undefined
  );
  assert.equal(f.requests.length, 0);
});
