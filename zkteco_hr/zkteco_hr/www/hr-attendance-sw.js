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
const ICON = `${ASSET_PREFIX}icons/icon-192.png`;

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

// Who is logged in on THIS device right now? (for the push privacy guard)
async function currentUser() {
  try {
    const res = await fetch("/api/method/frappe.auth.get_logged_user", { credentials: "include" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.message ? json.message : null;
  } catch {
    return null;
  }
}

// Refresh the app icon badge from the user's actionable count (runs even with no
// open tab, via the session cookie). Guarded — unsupported browsers no-op.
async function refreshBadge() {
  if (!self.navigator.setAppBadge) return;
  try {
    const res = await fetch("/api/method/zkteco_hr.webpush.get_my_badge_count", {
      credentials: "include",
    });
    if (!res.ok) return;
    const json = await res.json();
    const count = Number(json && json.message ? json.message : 0);
    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch {
    /* offline / logged out — leave the badge as-is */
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const url = data.url || SHELL_URL;
  event.waitUntil(
    (async () => {
      const me = await currentUser();
      const forMe = !data.recipient || me === data.recipient;
      if (forMe) {
        await self.registration.showNotification(data.title || "Dewey Time", {
          body: data.body || "",
          icon: ICON,
          badge: ICON,
          data: { url },
          tag: url,
          renotify: true,
        });
      } else {
        // Privacy guard: a different user (or logged out) on this device — say nothing specific.
        await self.registration.showNotification("Dewey Time", {
          body: "You have a new notification. Open the app to view.",
          icon: ICON,
          badge: ICON,
          data: { url: SHELL_URL },
          tag: "generic",
        });
      }
      await refreshBadge();
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || SHELL_URL;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url.includes(SHELL_URL)) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* hash nav can reject; focus is enough */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
