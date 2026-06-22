import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("manifest declares an installable, white-themed PWA scoped to /hr-attendance", () => {
  const m = JSON.parse(readFileSync(resolve(PKG, "public/manifest.json"), "utf8"));
  assert.equal(m.id, "/hr-attendance");
  assert.equal(m.scope, "/hr-attendance");
  assert.equal(m.start_url, "/hr-attendance");
  assert.equal(m.display, "standalone");
  // white chrome — the brand green is a signal inside the SPA, never the shell
  assert.equal(m.theme_color, "#ffffff");
  assert.equal(m.background_color, "#ffffff");

  const any = m.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
  assert.ok(any.includes("192x192") && any.includes("512x512"), "192 + 512 any icons");
  assert.ok(m.icons.some((i) => i.purpose === "maskable"), "a maskable icon");
  for (const i of m.icons) {
    assert.match(i.src, /^\/assets\/dewey_time\/hr_attendance\/icons\//, "icons under the app asset path");
  }
});

test("icon PNGs are present", () => {
  for (const f of ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png"]) {
    assert.ok(existsSync(resolve(PKG, "public/icons", f)), `${f} exists`);
  }
});

test("host page wires manifest + apple meta + safe-area viewport", () => {
  const html = readFileSync(resolve(PKG, "index.html"), "utf8");
  assert.match(html, /rel="manifest" href="\/assets\/dewey_time\/hr_attendance\/manifest\.json"/);
  assert.match(html, /viewport-fit=cover/, "safe-area viewport");
  assert.match(html, /name="theme-color" content="#ffffff"/, "white theme-color");
  assert.match(html, /rel="apple-touch-icon"/, "apple touch icon");
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
});

test("service worker caches by class and never the API", () => {
  const sw = readFileSync(resolve(PKG, "../../www/hr-attendance-sw.js"), "utf8");
  assert.match(sw, /ASSET_PREFIX\s*=\s*"\/assets\/dewey_time\/hr_attendance\/"/);
  assert.match(sw, /SHELL_URL\s*=\s*"\/hr-attendance"/);
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)\)\s*return/, "API is network-only");
  assert.match(sw, /req\.mode === "navigate"/, "navigations network-first");
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
});

test("service worker handles push with a recipient privacy guard + app badge", () => {
  const sw = readFileSync(resolve(PKG, "../../www/hr-attendance-sw.js"), "utf8");
  assert.match(sw, /addEventListener\("push"/, "has a push handler");
  assert.match(sw, /data\.recipient/, "privacy-guards on the recipient");
  assert.match(sw, /showNotification/, "shows a notification");
  assert.match(sw, /setAppBadge/, "refreshes the app badge");
  assert.match(sw, /get_my_badge_count/, "badge count from the backend");
  assert.match(sw, /addEventListener\("notificationclick"/, "focus-or-open on click");
});

test("SW registration is prod-only, scoped, and non-fatal", () => {
  const main = readFileSync(resolve(PKG, "src/main.tsx"), "utf8");
  assert.match(main, /import\.meta\.env\.PROD/, "prod-only");
  assert.match(main, /register\("\/hr-attendance-sw\.js",\s*\{\s*scope:\s*"\/hr-attendance"/, "scoped registration");
  assert.match(main, /updateViaCache:\s*"none"/);
  assert.match(main, /\.catch\(\(\)\s*=>\s*\{\}\)/, "non-fatal");
});
