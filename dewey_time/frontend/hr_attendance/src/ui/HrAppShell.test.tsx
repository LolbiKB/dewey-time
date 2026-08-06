import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

// HrAppShell renders through useCalendarSession (react-query, hits the network)
// and useIsMobile (reads window.innerWidth) — neither works under plain
// node:test/renderToStaticMarkup with no DOM available. This file follows the
// same source-assertion pattern already used for this component in
// src/lib/queryKeys.test.ts:41-47 rather than mounting it.
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

test("FLAGS_INBOX_URL points at the in-app flag queue, not the retired Desk list view", () => {
  const src = shellSource();
  const match = src.match(/FLAGS_INBOX_URL\s*=\s*"([^"]+)"/);
  assert.ok(match, "expected a FLAGS_INBOX_URL constant");
  assert.equal(match![1], "/hr-flags");
  assert.ok(
    !match![1].startsWith("/app/"),
    `FLAGS_INBOX_URL still points at Desk: "${match![1]}"`
  );
});

// activeTab checks /hr-schedule/coverage before the plain /hr-schedule prefix,
// because startsWith("/hr-schedule") alone also matches "/hr-schedule/coverage"
// and would misclassify it (HrAppShell.tsx:27-28). Adding /hr-flags must not
// disturb that order.
test("activeTab keeps the coverage-before-schedule check and adds /hr-flags", () => {
  const src = shellSource();
  const fnStart = src.indexOf("function activeTab");
  const fnEnd = src.indexOf("function tabHref");
  assert.ok(fnStart !== -1 && fnEnd !== -1, "could not locate activeTab/tabHref");
  const fn = src.slice(fnStart, fnEnd);
  const coverageIdx = fn.indexOf('pathname.startsWith("/hr-schedule/coverage")');
  const scheduleIdx = fn.indexOf('pathname.startsWith("/hr-schedule")');
  const flagsIdx = fn.indexOf('pathname.startsWith("/hr-flags")');
  assert.ok(coverageIdx !== -1, "missing the /hr-schedule/coverage check");
  assert.ok(scheduleIdx !== -1, "missing the /hr-schedule check");
  assert.ok(flagsIdx !== -1, "missing the new /hr-flags check");
  assert.ok(
    coverageIdx < scheduleIdx,
    "the more specific /hr-schedule/coverage check must stay first"
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
