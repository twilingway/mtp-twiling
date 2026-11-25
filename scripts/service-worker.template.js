const BUILD = __BUILD__;
const PREFIX = "personal-terminal:" + new URL(self.registration.scope).pathname + ":";
const CACHE = PREFIX + BUILD;
const ASSETS = __ASSETS__;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(ASSETS.map((path) => new URL(path, self.registration.scope).href))
      )
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (
    event.request.method !== "GET" ||
    url.origin !== scope.origin ||
    !url.pathname.startsWith(scope.pathname) ||
    url.pathname.endsWith("/version.json")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === "navigate")
        return (await cache.match(new URL("index.html", scope).href)) || fetch(event.request);
      return (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request);
    })()
  );
});
