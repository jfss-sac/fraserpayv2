// FraserPay service worker runtime. Assembled into public/sw.js by
// scripts/build-sw.mjs, which injects SW_VERSION + PRECACHE_URLS and inlines the
// sw-core helpers above this body. Do not register this file directly.

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName(SW_VERSION));
      await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => isStaleCache(name, SW_VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const strategy = selectStrategy({
    method: request.method,
    sameOrigin: url.origin === self.location.origin,
    pathname: url.pathname,
    isNavigate: request.mode === "navigate",
  });
  if (strategy === STRATEGY.STATIC_CACHE_FIRST) {
    event.respondWith(cacheFirst(event, false));
  } else if (strategy === STRATEGY.HTML_CACHE_FIRST) {
    event.respondWith(cacheFirst(event, true));
  }
});

async function cacheFirst(event, revalidate) {
  const cache = await caches.open(cacheName(SW_VERSION));
  const cached = await cache.match(event.request);
  if (cached) {
    if (revalidate && self.navigator.onLine) {
      event.waitUntil(fetchAndStore(event, cache).catch(() => {}));
    }
    return cached;
  }
  return fetchAndStore(event, cache);
}

async function fetchAndStore(event, cache) {
  const response = await fetch(event.request);
  if (response && response.ok && !response.redirected) {
    event.waitUntil(cache.put(event.request, response.clone()));
  }
  return response;
}
