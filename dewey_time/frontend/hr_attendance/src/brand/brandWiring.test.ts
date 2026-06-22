import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("HrAppShell uses the dial+wordmark lockup, not the old image logo/title", () => {
  const shell = readFileSync(resolve(PKG, "src/ui/HrAppShell.tsx"), "utf8");
  assert.match(shell, /DeweyTimeLockup/, "uses the Dewey Time lockup (dial + wordmark)");
  assert.ok(!shell.includes("APP_LOGO"), "drops the APP_LOGO import/usage");
  assert.ok(!shell.includes("<img"), "no <img> logo in the header");
  assert.ok(!shell.includes('title="Dewey Time"'), "drops the text title");
});

test("Dewey Time dial SVG exists and is the adaptive clock mark", () => {
  const p = resolve(PKG, "../../public/images/dewey-time.svg");
  assert.ok(existsSync(p), "public/images/dewey-time.svg present");
  const svg = readFileSync(p, "utf8");
  assert.match(svg, /<circle[^>]*r="32"/, "has the dial ring (r=32)");
  assert.match(svg, /prefers-color-scheme:\s*dark/, "has the light/dark swap");
  assert.match(svg, /#066031/, "Forest green present");
  assert.match(svg, /#C2410C/i, "brand orange present");
});

const DIAL = "dewey-time.svg";
const OLD = "attendance-svgrepo-com.svg";

test("app mark + Dewey Time SPA favicons point at the dial", () => {
  assert.match(readFileSync(resolve(PKG, "src/lib/brand.ts"), "utf8"), new RegExp(DIAL), "brand.ts → dial");
  assert.match(readFileSync(resolve(PKG, "index.html"), "utf8"), new RegExp(DIAL), "Vite index.html favicon → dial");
  assert.match(readFileSync(resolve(PKG, "../../www/hr-personal.html"), "utf8"), new RegExp(DIAL), "hr-personal favicon → dial");

  const py = readFileSync(resolve(PKG, "../../utils/sync_hr_attendance_assets.py"), "utf8");
  assert.match(py, new RegExp(`HR_APP_LOGO\\s*=\\s*"[^"]*${DIAL}"`), "HR_APP_LOGO → dial");
  assert.match(py, new RegExp(`_BRANDING_FILES[\\s\\S]{0,80}${DIAL}`), "_BRANDING_FILES has the dial");
});

test("attendance-svgrepo icon fully retired", () => {
  for (const p of [
    "src/lib/brand.ts",
    "src/ui/HrAppShell.tsx",
    "index.html",
    "../../www/hr-personal.html",
    "../../utils/sync_hr_attendance_assets.py",
  ]) {
    assert.ok(!readFileSync(resolve(PKG, p), "utf8").includes(OLD), `${p} free of ${OLD}`);
  }
  assert.ok(!existsSync(resolve(PKG, "public/images/attendance-svgrepo-com.svg")), "old SVG deleted");
});

test("DI-logo preserved on protected surfaces (Desk / website / adms)", () => {
  const py = readFileSync(resolve(PKG, "../../utils/sync_hr_attendance_assets.py"), "utf8");
  assert.match(py, /_BRANDING_FILES[\s\S]{0,80}DI-logo\.svg/, "_BRANDING_FILES still publishes DI-logo");
  assert.match(py, /SITE_FAVICON_LOGO\s*=\s*"[^"]*DI-logo\.svg"/, "SITE_FAVICON_LOGO is DI-logo");

  const hooks = readFileSync(resolve(PKG, "../../hooks.py"), "utf8");
  assert.match(hooks, /app_logo_url\s*=\s*SITE_FAVICON_LOGO/, "Desk logo uses SITE_FAVICON_LOGO (DI-logo)");
  assert.match(hooks, /"favicon":\s*SITE_FAVICON_LOGO/, "website favicon uses SITE_FAVICON_LOGO (DI-logo)");

  const adms = readFileSync(resolve(PKG, "../../www/adms.html"), "utf8");
  assert.ok(adms.includes("DI-logo.svg"), "adms keeps DI-logo favicon");
  assert.ok(!adms.includes("dewey-time.svg"), "adms not repointed to the dial");
});
