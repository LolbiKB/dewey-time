import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationsButton } from "./NotificationsButton";
import { isPushSupported } from "./push";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("isPushSupported is false outside a push-capable browser (SSR-safe)", () => {
  assert.equal(isPushSupported(), false);
});

test("NotificationsButton renders nothing where push is unsupported (SSR-safe)", () => {
  const html = renderToStaticMarkup(<NotificationsButton />);
  assert.equal(html, "", "no bell without push support");
});

test("push client exposes subscribe / unsubscribe / rebind / badge / test", () => {
  const src = readFileSync(resolve(PKG, "src/pwa/push.ts"), "utf8");
  for (const fn of [
    "enablePush",
    "disablePush",
    "rebindPush",
    "refreshBadgeFromPage",
    "getBadgeCount",
    "sendTestPush",
    "savePushSubscription",
  ]) {
    assert.match(src, new RegExp(`export (async )?(function|const) ${fn}\\b`), `exports ${fn}`);
  }
  assert.match(src, /userVisibleOnly: true/, "subscribes user-visible");
  assert.match(src, /applicationServerKey/, "passes the VAPID application server key");
});

test("HrAppShell mounts the notifications toggle + re-binds push on load", () => {
  const shell = readFileSync(resolve(PKG, "src/ui/HrAppShell.tsx"), "utf8");
  assert.match(shell, /NotificationsButton/, "renders the bell");
  assert.match(shell, /rebindPush\(\)/, "re-binds push on load");
  assert.match(shell, /refreshBadgeFromPage\(\)/, "syncs the badge on load");
});
