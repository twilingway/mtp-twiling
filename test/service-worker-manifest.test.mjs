import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const template = readFileSync(
  new URL("../scripts/service-worker.template.js", import.meta.url),
  "utf8"
);
const oldManifest = JSON.stringify({ icons: [{ src: "./icon.svg" }] });
const freshManifest = JSON.stringify({ icons: [{ src: "./icons/icon-192.png" }] });
const assets = ["index.html", "manifest.webmanifest", "icon.svg", "app-entry.js"];

function fixture(base = "/", { cached = true, network = () => new Response(freshManifest) } = {}) {
  const scope = `https://example.test${base}`;
  const prefix = `personal-terminal:${base}:`;
  const cacheName = `${prefix}fixture-build`;
  const contents = new Map(
    cached ? [[new URL("manifest.webmanifest", scope).href, oldManifest]] : []
  );
  contents.set(new URL("index.html", scope).href, "current shell");
  contents.set(new URL("icon.svg", scope).href, "current icon");
  contents.set(new URL("app-entry.js", scope).href, "current code");
  const handlers = {};
  const calls = { fetch: [], matches: [], opens: [], batches: [], deletes: [], skip: 0, claim: 0 };
  const cache = {
    async match(input, options = {}) {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (options.ignoreSearch) url.search = "";
      calls.matches.push(url.href);
      const body = contents.get(url.href);
      return body === undefined ? undefined : new Response(body);
    },
    async addAll(urls) {
      calls.batches.push([...urls]);
    },
    async put() {
      assert.fail("A network response must not overwrite a build cache");
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
        addEventListener: (type, handler) => (handlers[type] = handler),
        skipWaiting: () => calls.skip++,
        clients: { claim: async () => calls.claim++ }
      },
      caches: {
        open: async (name) => {
          calls.opens.push(name);
          assert.equal(name, cacheName);
          return cache;
        },
        keys: async () => [cacheName, `${prefix}old`, "personal-terminal:/another/:old", "foreign"],
        delete: async (name) => calls.deletes.push(name)
      },
      fetch: async (request, options) => {
        calls.fetch.push({ request, options });
        return network(request, options);
      }
    }
  );
  return {
    scope,
    prefix,
    cacheName,
    cache,
    contents,
    calls,
    handlers,
    dispatch(path, { method = "GET", mode } = {}) {
      const request = new Request(new URL(path, scope), { method });
      if (mode) Object.defineProperty(request, "mode", { value: mode });
      let pending;
      handlers.fetch({ request, respondWith: (promise) => (pending = promise) });
      return pending;
    },
    async lifecycle(type) {
      let pending;
      handlers[type]({ waitUntil: (promise) => (pending = promise) });
      await pending;
    }
  };
}

for (const base of ["/", "/quotes/", "/nested/terminal/"]) {
  test(`fresh manifest wins over old cache, including query, without cache writes (${base})`, async () => {
    const f = fixture(base);
    for (const path of ["manifest.webmanifest", "manifest.webmanifest?from=install"]) {
      assert.equal(await (await f.dispatch(path)).text(), freshManifest);
      const call = f.calls.fetch.at(-1);
      assert.equal(call.request.url, new URL(path, f.scope).href);
      assert.equal(call.options.cache, "no-cache");
    }
    assert.equal(f.calls.fetch.length, 2);
    assert.equal(f.calls.matches.length, 0);
    assert.equal(f.contents.get(new URL("manifest.webmanifest", f.scope).href), oldManifest);
    assert.deepEqual(f.calls.batches, []);
  });

  test(`network rejection falls back to cached manifest with query (${base})`, async () => {
    const f = fixture(base, {
      network: () => {
        throw new TypeError("offline");
      }
    });
    assert.equal(await (await f.dispatch("manifest.webmanifest?from=install")).text(), oldManifest);
    assert.equal(f.calls.fetch.length, 1);
    assert.deepEqual(f.calls.matches, [new URL("manifest.webmanifest", f.scope).href]);
  });

  for (const status of [404, 503]) {
    test(`HTTP ${status} falls back to cached manifest (${base})`, async () => {
      const f = fixture(base, { network: () => new Response("server error", { status }) });
      const result = await f.dispatch("manifest.webmanifest");
      assert.equal(result.status, 200);
      assert.equal(await result.text(), oldManifest);
      assert.equal(f.calls.fetch.length, 1);
    });

    test(`HTTP ${status} without a cache preserves the original response (${base})`, async () => {
      const failure = new Response("server error", { status });
      const f = fixture(base, { cached: false, network: () => failure });
      assert.equal(await f.dispatch("manifest.webmanifest?check=1"), failure);
      assert.equal(f.calls.fetch.length, 1);
    });
  }

  test(`network rejection without a cache preserves the original error (${base})`, async () => {
    const failure = new TypeError("offline without cache");
    const f = fixture(base, {
      cached: false,
      network: () => {
        throw failure;
      }
    });
    await assert.rejects(f.dispatch("manifest.webmanifest"), (error) => error === failure);
    assert.equal(f.calls.fetch.length, 1);
  });

  test(`online manifest refresh leaves offline shell, assets and activation unchanged (${base})`, async () => {
    let online = true;
    const f = fixture(base, {
      network: () => {
        if (!online) throw new TypeError("offline");
        return new Response(freshManifest);
      }
    });
    assert.equal(await (await f.dispatch("manifest.webmanifest")).text(), freshManifest);
    online = false;
    for (const path of ["", "?tab=watchlist", "index.html", "index.html?reload=1"]) {
      assert.equal(await (await f.dispatch(path, { mode: "navigate" })).text(), "current shell");
    }
    for (const [path, expected] of [
      ["icon.svg?1", "current icon"],
      ["app-entry.js?2", "current code"]
    ]) {
      assert.equal(await (await f.dispatch(path)).text(), expected);
    }
    assert.equal(await (await f.dispatch("manifest.webmanifest?offline=1")).text(), oldManifest);
    assert.equal(f.calls.fetch.length, 2);
    assert.equal(f.calls.skip, 0);
    assert.deepEqual(f.calls.batches, []);
    assert.deepEqual(new Set(f.calls.opens), new Set([f.cacheName]));
  });
}

test("only exact scoped manifest gets network-first; other manifest-like paths keep cache-first", async () => {
  const f = fixture("/quotes/");
  for (const path of [
    "nested/manifest.webmanifest",
    "manifest.webmanifest/extra",
    "other.webmanifest"
  ]) {
    f.contents.set(new URL(path, f.scope).href, "other cached response");
    assert.equal(await (await f.dispatch(path)).text(), "other cached response");
  }
  assert.equal(f.calls.fetch.length, 0);
});

test("API, cross-origin, outside-scope, version and non-GET exclusions are preserved", () => {
  const f = fixture("/quotes/");
  for (const path of [
    "/manifest.webmanifest",
    "/quotes-other/manifest.webmanifest",
    "https://other.test/quotes/manifest.webmanifest",
    "https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles",
    "https://api.bybit.com/v5/market/kline",
    "version.json?check=1"
  ])
    assert.equal(f.dispatch(path), undefined);
  assert.equal(f.dispatch("manifest.webmanifest", { method: "POST" }), undefined);
  assert.equal(f.dispatch("manifest.webmanifest", { method: "HEAD" }), undefined);
  assert.deepEqual(f.calls.opens, []);
  assert.deepEqual(f.calls.fetch, []);
});

test("install precaches one complete build batch and activation remains explicit and scoped", async () => {
  const f = fixture("/quotes/");
  await f.lifecycle("install");
  assert.deepEqual(f.calls.batches, [assets.map((path) => new URL(path, f.scope).href)]);
  assert.deepEqual(f.calls.opens, [f.cacheName]);
  assert.equal(f.calls.skip, 0);
  assert.equal(f.calls.claim, 0);
  f.handlers.message({ data: { type: "OTHER_MESSAGE" } });
  f.handlers.message({});
  assert.equal(f.calls.skip, 0);
  f.handlers.message({ data: { type: "ACTIVATE_UPDATE" } });
  assert.equal(f.calls.skip, 1);
  await f.lifecycle("activate");
  assert.deepEqual(f.calls.deletes, [`${f.prefix}old`]);
  assert.equal(f.calls.claim, 1);
});

test("failed precache batch rejects installation without activating or claiming", async () => {
  const f = fixture();
  const failure = new TypeError("incomplete build download");
  f.cache.addAll = async () => {
    throw failure;
  };
  await assert.rejects(f.lifecycle("install"), (error) => error === failure);
  assert.equal(f.calls.skip, 0);
  assert.equal(f.calls.claim, 0);
  assert.deepEqual(f.calls.deletes, []);
});
