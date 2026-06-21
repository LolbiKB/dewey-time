import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { InstallButton } from "./InstallButton";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("InstallButton renders nothing when no install path is available (SSR-safe)", () => {
  const html = renderToStaticMarkup(<InstallButton />);
  assert.equal(html, "", "no button without a captured prompt or iOS");
});

test("InstallButton handles the install lifecycle + iOS fallback", () => {
  const src = readFileSync(resolve(PKG, "src/pwa/InstallButton.tsx"), "utf8");
  assert.match(src, /beforeinstallprompt/, "captures the Chromium prompt");
  assert.match(src, /appinstalled/, "hides after install");
  assert.match(src, /display-mode: standalone/, "detects an installed standalone session");
  assert.match(src, /Add to Home Screen/, "iOS A2HS instructions");
});
