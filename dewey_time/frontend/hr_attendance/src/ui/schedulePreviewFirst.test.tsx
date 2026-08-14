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

test("the preview branch carries none of the editing chrome", () => {
  // The branch renders <SchedulePreview>, a local component defined lower in
  // the same file — so the canvas is asserted separately, below, against the
  // whole source. What matters here is what the branch does NOT reach for.
  const src = pageSource();
  const preview = src.match(/mode === "preview" \? \([\s\S]*?\) : \(/);
  assert.ok(preview, "expected a mode === 'preview' branch in the page");
  assert.match(preview[0], /<SchedulePreview/, "the preview branch mounts the read-only view");
  assert.doesNotMatch(preview[0], /WeeklyScheduleTemplatePickerDialog/);
  assert.doesNotMatch(preview[0], /WeekPatternGroupEditor/);
});

test("the read-only view is a canvas, a line of facts and one button", () => {
  const src = pageSource();
  const component = src.match(/function SchedulePreview\([\s\S]*?\n}/);
  assert.ok(component, "expected a SchedulePreview component in the page file");
  assert.match(component[0], /<PlannedWeekCanvas/, "preview must render the week canvas");
  assert.match(component[0], /Edit schedule/, "preview must offer the way into edit mode");
  // No Card header and no ScrollArea: those frame an editor, and this is a
  // document.
  assert.doesNotMatch(component[0], /<CardHeader|<ScrollArea/);
});

test("preview reuses the dialog's adapters rather than reimplementing them", () => {
  // SchedulePlanPreviewDialog already renders exactly this. A second adapter
  // would be a second thing to keep in step with the canvas.
  // `props.weekPattern`, not `weekPattern`: SchedulePlanPreviewDialog reads its
  // props the same way, and the point of the assertion is which value reaches
  // the adapter, not how the component spells its own prop access.
  const src = pageSource();
  assert.match(src, /plannedDaysFromWeekPattern\(props\.weekPattern\)/);
  assert.match(src, /resolveWeekPatternWindow\(props\.weekPattern\)/);
});

test("the footer is edit-only", () => {
  // "Effective from", "Generate through" and Save exist to serve saving.
  // They are the largest single block of reclaimed height.
  const src = pageSource();
  const footer = src.match(/<footer[\s\S]*?<\/footer>/);
  assert.ok(footer, "expected the footer to still exist for edit mode");
  assert.match(
    src,
    /mode === "edit" && scheduleEmployeeId \? \(\s*<footer/,
    "the footer must be gated on edit mode, not merely on a selected employee",
  );
});

test("the opening mode comes from the shared rule, not an inline ternary", () => {
  // Matched loosely on purpose: the call site passes the raw
  // `context.enabled_ssa_count` expression rather than the derived
  // `hasLiveSchedule` constant, deliberately — see the effect's comment.
  assert.match(pageSource(), /openingScheduleMode\(/);
});
