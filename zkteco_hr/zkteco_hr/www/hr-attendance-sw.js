// Dewey Time HR — service worker.
//
// Served from www/ → resolves to /hr-attendance-sw.js at the origin root, so it
// can claim the narrower /hr-attendance scope without a Service-Worker-Allowed
// header. Registered PROD-only and non-fatally from main.tsx.
//
// Caching is by request CLASS, never the API: the app stays online-only for data
// but its shell loads offline (the user sees the UI + a loading state, not a
// browser connection-error page). No IndexedDB / offline mutation queue.
const VERSION = "hr-attendance-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const ASSET_PREFIX = "/assets/zkteco_hr/hr_attendance/";
const SHELL_URL = "/hr-attendance";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) API: never cache — auth + live data (caching it leaks/staleness).
  if (url.pathname.startsWith("/api/")) return;

  // 2) Navigations: network-first, fall back to the cached shell so the app
  //    opens offline instead of a browser error page.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL);
          cache.put(req, res.clone());
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match(req)) || (await cache.match(SHELL_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  // 3) Built assets: stale-while-revalidate (the ?v=<ts> bundle URL means a new
  //    deploy fetches fresh; old entries are pruned by the versioned cache name).
  if (url.origin === self.location.origin && url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});
