import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function pageSource(): string {
  return readFileSync(resolve(PKG, "src/ui/WeeklySchedulePage.tsx"), "utf8");
}

test("previewOnly is gone", () => {
  // Declared and never read since PR #38 pinned it. Dead constants next to a
  // real mode are worse than dead constants alone.
  assert.doesNotMatch(pageSource(), /previewOnly/);
});

test("isEditing is renamed — it means 'has a live schedule', not 'is editing'", () => {
  // With a real edit mode on the page, the old name names the wrong thing.
  const src = pageSource();
  assert.doesNotMatch(src, /\bisEditing\b/);
  assert.match(src, /hasLiveSchedule/);
});

test("the page no longer tells you that you are editing", () => {
  // Once Edit is a button you pressed, a line saying you are editing is noise.
  assert.doesNotMatch(pageSource(), /Editing an existing schedule/);
});

test("the dev-tools row is gated at the WRAPPER, not only per dialog", () => {
  // Each Clear* dialog returns null in production, but their wrapper is a
  // child of a `flex flex-col gap-2` — an empty wrapper still costs a gap.
  // Gating only the children reclaims nothing.
  const src = pageSource();
  assert.match(src, /IS_DEV_BUILD/, "the page must import and use the gate itself");
  const wrapper = src.match(/\{IS_DEV_BUILD \? \([\s\S]*?ClearSitePatternsDialog[\s\S]*?\) : null\}/);
  assert.ok(wrapper, "expected one IS_DEV_BUILD gate enclosing all three Clear* dialogs");
});

test("the import trigger sits with the picker, not in its own row", () => {
  // In production the old row held exactly one control: all three Clear*
  // dialogs are dev-only. A whole row of vertical space for one button.
  const src = pageSource();
  const importIndex = src.indexOf("<SpreadsheetImportTrigger");
  const devGateIndex = src.indexOf("{IS_DEV_BUILD ?");
  assert.ok(importIndex > 0, "expected the import trigger on the page");
  assert.ok(devGateIndex > 0, "expected the dev gate on the page");
  assert.ok(
    importIndex < devGateIndex,
    "the import trigger must precede the dev-only row, in the picker's own row",
  );
});
