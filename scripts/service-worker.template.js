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
      if (url.pathname === new URL("manifest.webmanifest", scope).pathname) {
        // Keep the build cache immutable while allowing install metadata to refresh online.
        try {
          const response = await fetch(event.request, { cache: "no-cache" });
          if (response.ok) return response;
          return (await cache.match(event.request, { ignoreSearch: true })) || response;
        } catch (error) {
          const cached = await cache.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          throw error;
        }
      }
      // Only the app entry aliases the shell. Documents and assets keep their exact response.
      if (event.request.mode === "navigate" && url.pathname === scope.pathname)
        return (await cache.match(new URL("index.html", scope).href)) || fetch(event.request);
      return (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request);
    })()
  );
});
