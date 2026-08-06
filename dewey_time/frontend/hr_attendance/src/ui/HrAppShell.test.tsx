import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import { activeTab, tabHref } from "@/ui/HrAppShell";

// HrAppShell itself renders through useCalendarSession (react-query, hits the
// network) and useIsMobile (reads window.innerWidth) — neither works under
// plain node:test/renderToStaticMarkup with no DOM available. But `activeTab`
// and `tabHref` are plain, hook-free functions exported for exactly this
// reason, so those are exercised directly below instead of grepping source.
// The tabs-array shape (which entries exist, and in what gated block) has no
// pure-function surface to call, so that part still asserts on source text,
// following the same pattern already used elsewhere in this file for
// src/lib/queryKeys.test.ts:41-47-style component wiring.
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHELL_PATH = resolve(PKG, "src/ui/HrAppShell.tsx");

function shellSource(): string {
  return readFileSync(SHELL_PATH, "utf8");
}

test("the Flags tab is gated in the same hrStaff-only block as Schedule and Coverage", () => {
  const src = shellSource();
  const gate = src.match(/\.\.\.\(hrStaff\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[\]\)/);
  assert.ok(gate, "expected a `...(hrStaff ? [...] : [])` block in the tabs array");
  const gatedBlock = gate![1];
  assert.match(gatedBlock, /label:\s*"Schedule"/, "sanity: Schedule is in the gated block");
  assert.match(gatedBlock, /label:\s*"Coverage"/, "sanity: Coverage is in the gated block");
  assert.match(gatedBlock, /label:\s*"Flags"/, "Flags tab is missing from the HR-only block");
  assert.match(
    gatedBlock,
    /icon:\s*FlagIcon/,
    "Flags tab should use the already-imported FlagIcon"
  );
});

test("the Flags tab is absent from the tabs array's always-visible head (non-HR users)", () => {
  const src = shellSource();
  const tabsStart = src.indexOf("const tabs: MobileTab[] = [");
  const gateStart = src.indexOf("...(hrStaff", tabsStart);
  assert.ok(tabsStart !== -1 && gateStart !== -1, "could not locate the tabs array / HR gate");
  const alwaysVisibleHead = src.slice(tabsStart, gateStart);
  assert.doesNotMatch(
    alwaysVisibleHead,
    /label:\s*"Flags"/,
    "Flags must only render inside the hrStaff-gated block, never unconditionally"
  );
});

// The header used to carry a second, redundant "Flags" DeskLink (a bare <a>
// full-page nav) pointed at a FLAGS_INBOX_URL constant. That constant and the
// link were removed: the HR-only tab added above is the one route to
// /hr-flags, and Frappe currently has no server route rule that would make a
// bare <a href="/hr-flags"> land anywhere but a 404 outside the SPA shell.
test("the redundant header Flags link and FLAGS_INBOX_URL constant are gone", () => {
  const src = shellSource();
  assert.doesNotMatch(src, /FLAGS_INBOX_URL/, "FLAGS_INBOX_URL should have been removed");
  assert.doesNotMatch(
    src,
    /<DeskLink href=\{FLAGS_INBOX_URL\}/,
    "the header should no longer render a second Flags DeskLink"
  );
});

// activeTab checks /hr-schedule/coverage before the plain /hr-schedule prefix,
// because startsWith("/hr-schedule") alone also matches "/hr-schedule/coverage"
// and would misclassify it. Calling the real function (rather than grepping
// for the substring) is what actually proves the return values are correct —
// a wrong-but-present check (e.g. the /hr-flags branch returning "coverage")
// would still pass a source-text assertion but fails this one.
test("activeTab classifies every registered path, coverage-before-schedule", () => {
  assert.equal(activeTab("/hr-attendance"), "attendance");
  assert.equal(activeTab("/hr-schedule"), "schedule");
  assert.equal(activeTab("/hr-schedule/import"), "schedule");
  assert.equal(activeTab("/hr-schedule/coverage"), "coverage");
  assert.equal(activeTab("/hr-flags"), "flags");
  assert.equal(activeTab("/some-unknown-path"), "attendance");
});

test("tabHref resolves the canonical path per tab, with and without ?employee=", () => {
  assert.equal(tabHref("attendance", null), "/hr-attendance");
  assert.equal(tabHref("schedule", null), "/hr-schedule");
  assert.equal(tabHref("coverage", null), "/hr-schedule/coverage");
  assert.equal(tabHref("flags", null), "/hr-flags");
  assert.equal(tabHref("flags", "EMP-0001"), "/hr-flags?employee=EMP-0001");
  // Encoding matters — this is the one place tabHref's contract is exercised
  // with a value that needs escaping.
  assert.equal(
    tabHref("flags", "EMP/0001 X"),
    `/hr-flags?employee=${encodeURIComponent("EMP/0001 X")}`
  );
});

test("main.tsx registers /hr-flags inside the HrAppShell element, alongside the other four routes", () => {
  const main = readFileSync(resolve(PKG, "src/main.tsx"), "utf8");
  assert.match(
    main,
    /import \{ FlagQueuePage \} from ["']\.\/ui\/FlagQueuePage["']/,
    "missing the FlagQueuePage import"
  );
  const shellStart = main.indexOf("<Route element={<HrAppShell");
  const shellEnd = main.indexOf("</Route>", shellStart);
  assert.ok(shellStart !== -1 && shellEnd !== -1, "could not locate the <HrAppShell /> route block");
  const shellBlock = main.slice(shellStart, shellEnd);
  for (const path of [
    "/hr-attendance",
    "/hr-schedule",
    "/hr-schedule/import",
    "/hr-schedule/coverage",
    "/hr-flags",
  ]) {
    assert.match(
      shellBlock,
      new RegExp(`<Route path="${path}"`),
      `expected a <Route path="${path}"> inside the HrAppShell element`
    );
  }
});
