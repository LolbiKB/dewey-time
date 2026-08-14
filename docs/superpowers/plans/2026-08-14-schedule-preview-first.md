# `/hr-schedule` Preview-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `/hr-schedule` on a read-only view of the employee's schedule, put editing behind an explicit trigger, and reclaim the vertical space the always-on editing chrome costs.

**Architecture:** One piece of state, `mode: "preview" | "edit"`, defaulting to preview only when the employee already has a live schedule. Preview reuses `PlannedWeekCanvas` and `summarizeWeekPattern` exactly as `SchedulePlanPreviewDialog` already does — nothing new is written to render it. Edit mode is today's page, plus a Cancel that confirms when the form is dirty. The disable mechanism already exists: `scheduleReadOnly` is threaded through all eight edit controls and merely pinned `false`.

**Tech Stack:** React 19, TypeScript, Tailwind v4.3, Radix via `@lolbikb/dewey-ui`, `node:test` + `tsx` for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-14-schedule-preview-first-design.md`

## Global Constraints

- All commands run from `/Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance` unless a step says otherwise. **Always `cd` with an absolute path in the same command as the thing you are running** — `cd` is intercepted by zoxide on this machine and a bare relative `cd` has run npm scripts in the wrong package and reported a false green.
- Python, where needed, is `python3`. There is no `python` on this machine.
- `mode` values are exactly `"preview"` and `"edit"`. No third state, no tabs, no segmented control.
- Preview-first applies **only** when `hasLiveSchedule` is true (`(context?.enabled_ssa_count ?? 0) > 0`). An employee with no schedule opens in `edit`.
- Preview renders **no** Card header, **no** template picker, **no** footer, **no** `ScrollArea`.
- `scheduleReadOnly` stays as the disable mechanism. Do not replace it or rewire the eight controls it already gates.
- Do **not** modify `SchedulePlanPreviewDialog`, `PlannedWeekCanvas`, `WeekCanvasFrame`, or the planned-day adapters.
- Do **not** make the `Clear*` dialogs available in production.
- **Do not run `npm run build` or commit `dewey_time/public/**` or `dewey_time/www/**` in tasks 1-5.** Bundles are rebuilt once at branch close; these filenames are fixed, not content-hashed, so a bundle commit per task guarantees conflicts.
- `npm run test:web` runs a glob and exits 0 when it matches nothing. **Report the actual test count** before and after, not just the exit code.
- Every task ends green on `npm run typecheck` and `npm run test:web`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/scheduleEdit.ts` | `ScheduleMode`, `openingScheduleMode()`, `scheduleFormFingerprint()` — the mode and dirty rules as pure data | 1 |
| `src/lib/scheduleEdit.test.ts` | Tests for both | 1 |
| `src/ui/WeeklySchedulePage.tsx` | Rename, dead-code removal, layout, the mode, the dirty confirm | 2, 3, 4 |
| `src/ui/schedulePreviewFirst.test.tsx` | Rendering tests for preview vs edit and the dev-row wrapper | 3, 4 |
| `e2e/schedule-preview.spec.ts` | Mode behaviour end to end, plus the measured height saving | 5 |

---

## Task 1: The mode and dirty rules as pure functions

`WeeklySchedulePage.tsx` is 715 lines and largely unreachable by `renderToStaticMarkup` because Radix portals server-render to `null`. Both rules therefore live in `src/lib/scheduleEdit.ts` — beside `scheduleFormStateFromContext`, which builds the very state being fingerprinted — and are tested as data.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts`

**Interfaces:**
- Consumes: `ScheduleFormState` (already exported from this file: `{ shiftBlocks: ShiftBlock[]; effectiveFrom: string; generateThrough: string; limitGenerateThrough: boolean }`), and `blocksFingerprint` from `@/types/schedule`.
- Produces, all consumed by Tasks 3 and 4:
  - `export type ScheduleMode = "preview" | "edit"`
  - `export function openingScheduleMode(hasLiveSchedule: boolean): ScheduleMode`
  - `export function scheduleFormFingerprint(state: ScheduleFormState): string`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/scheduleEdit.test.ts`. Add `openingScheduleMode` and `scheduleFormFingerprint` to the existing import block from `@/lib/scheduleEdit`, and `defaultShiftProfile` from `@/types/schedule` if it is not already imported.

```ts
test("an employee with a live schedule opens in preview, one without opens in edit", () => {
  // Preview-first guards the dangerous case only. Someone with no schedule has
  // nothing to preview, and editing is the only thing they can do — an Edit
  // button in front of that is a click for nothing.
  assert.equal(openingScheduleMode(true), "preview");
  assert.equal(openingScheduleMode(false), "edit");
});

test("the form fingerprint covers every editable field, not just the blocks", () => {
  // Cancel discards all four. A fingerprint over blocks alone would call a
  // changed effective date "clean" and bin it without asking.
  const base = {
    shiftBlocks: [],
    effectiveFrom: "2026-09-01",
    generateThrough: "",
    limitGenerateThrough: false,
  };
  const baseline = scheduleFormFingerprint(base);

  assert.equal(scheduleFormFingerprint({ ...base }), baseline, "same state, same key");
  assert.notEqual(
    scheduleFormFingerprint({ ...base, effectiveFrom: "2026-09-02" }),
    baseline,
    "a changed effective date is dirty",
  );
  assert.notEqual(
    scheduleFormFingerprint({ ...base, generateThrough: "2026-12-31" }),
    baseline,
    "a changed end date is dirty",
  );
  assert.notEqual(
    scheduleFormFingerprint({ ...base, limitGenerateThrough: true }),
    baseline,
    "toggling the limit switch is dirty",
  );
});

test("the fingerprint ignores block ids, as blocksFingerprint does", () => {
  // Reseeding from the server mints new block ids for identical content. If ids
  // counted, every freshly loaded form would report itself dirty and every
  // employee switch would raise a confirm nobody caused.
  //
  // `createShiftBlock` is the exported builder — ShiftBlock.profile has five
  // required fields and there is no exported `defaultShiftProfile`.
  const state = (id: string) => ({
    shiftBlocks: [createShiftBlock({ id, days: ["MON"] })],
    effectiveFrom: "2026-09-01",
    generateThrough: "",
    limitGenerateThrough: false,
  });
  assert.notEqual(state("a").shiftBlocks[0]!.id, state("b").shiftBlocks[0]!.id);
  assert.equal(scheduleFormFingerprint(state("a")), scheduleFormFingerprint(state("b")));
});
```

Import `createShiftBlock` from `@/types/schedule` in this test file. `ShiftBlock.days` is `Weekday[]`, and `"MON"` is a member of `WEEKDAYS` — check `src/types/schedule.ts:11` for the exact literal casing if TypeScript rejects it.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/lib/scheduleEdit.test.ts
```

Expected: FAIL at import — `openingScheduleMode` and `scheduleFormFingerprint` are not exported.

If `ShiftBlock`'s `days` field rejects `["MON"]`, read the `ShiftBlock` type in `src/types/schedule.ts` and use its actual day literal. Do not cast with `as any`.

- [ ] **Step 3: Implement both**

In `src/lib/scheduleEdit.ts`, below `scheduleFormStateFromContext`:

```ts
/** Which mode the page opens in for a given employee. */
export type ScheduleMode = "preview" | "edit";

/**
 * The opening mode.
 *
 * Preview-first guards the case that can go wrong: someone with a live
 * schedule cannot nudge a block by accident. Someone with no schedule has
 * nothing to preview and editing is the only thing they can do, so an Edit
 * button in front of it would be a click that buys nothing.
 */
export function openingScheduleMode(hasLiveSchedule: boolean): ScheduleMode {
  return hasLiveSchedule ? "preview" : "edit";
}

/**
 * A stable compare key for the whole editable form.
 *
 * Cancel discards all four fields, so all four decide whether the form is
 * dirty — a key over `shiftBlocks` alone would call a changed effective date
 * clean and bin it silently. Block ids are excluded via `blocksFingerprint`:
 * reseeding from the server mints new ids for identical content, and counting
 * them would make every freshly loaded form report itself dirty.
 */
export function scheduleFormFingerprint(state: ScheduleFormState): string {
  return JSON.stringify({
    blocks: blocksFingerprint(state.shiftBlocks),
    effectiveFrom: state.effectiveFrom,
    generateThrough: state.generateThrough,
    limitGenerateThrough: state.limitGenerateThrough,
  });
}
```

Add `blocksFingerprint` to this file's existing import from `@/types/schedule`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; count up by 3 from the pre-task baseline; 0 failures. Record both counts.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.ts dewey_time/frontend/hr_attendance/src/lib/scheduleEdit.test.ts
git commit -m "feat(schedule): the mode and dirty rules as pure functions

WeeklySchedulePage is 715 lines and mostly unreachable by
renderToStaticMarkup, so both rules live beside scheduleFormStateFromContext
and are tested as data. The fingerprint covers all four editable fields, not
just the blocks: Cancel discards all four.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Tidy the page — rename, delete dead code, relocate import

No behaviour changes. Doing this before the mode lands removes the `isEditing` naming collision that would otherwise sit next to a real edit mode, and clears the layout the mode has to slot into.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/schedulePreviewFirst.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `hasLiveSchedule` replaces `isEditing` throughout the page; the dev-tools row is wrapped in a single `IS_DEV_BUILD` gate. Task 3 builds on both.

- [ ] **Step 1: Write the failing test**

Create `src/ui/schedulePreviewFirst.test.tsx`. It asserts against the file's source text, not its render: the page mounts `useCalendarEmployees` and Radix portals, so `renderToStaticMarkup` reaches almost none of it. `chromeMigration.test.tsx` uses the same source-reading approach for the same reason.

```tsx
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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/schedulePreviewFirst.test.tsx
```

Expected: FAIL on all five — `previewOnly` and `isEditing` are still present, the notice is still there, and there is no `IS_DEV_BUILD` gate.

- [ ] **Step 3: Rename and delete**

In `src/ui/WeeklySchedulePage.tsx`:

Delete the `previewOnly` line entirely and rename the constant above it:

```tsx
  const hasLiveSchedule = (context?.enabled_ssa_count ?? 0) > 0;
  const scheduleReadOnly = false;
```

Rename the remaining `isEditing` references. There are eight occurrences in total: the declaration above, one in a comment near the effective-date logic, and six uses. One of those six is `isEditingNotice`, deleted in the next edit — leaving five to rename plus the comment.

Delete the `isEditingNotice` declaration:

```tsx
  const isEditingNotice = isEditing && Boolean(scheduleEmployeeId) && !ineligibleMessage;
```

And revert the Shift blocks `CardDescription` to its single line:

```tsx
                      <CardDescription>
                        {scheduleReadOnly
                          ? "Preview only — clear existing SSAs to edit."
                          : "One block per shared pattern — like Frappe Shift Schedule repeat days."}
                      </CardDescription>
```

- [ ] **Step 4: Move the import trigger and gate the dev row**

Add the gate's import beside the page's other `@/lib` imports — the page does not import it today, because the dialogs self-gate:

```tsx
import { IS_DEV_BUILD } from "@/lib/devBuild";
```

Replace the picker row and the four-button grid with:

```tsx
        <div className="flex flex-col gap-2">
          {/* Import rides in the picker's row. In production it was the only
              control in the row below — all three Clear* dialogs are dev-only
              and render null — so that row cost a full band of vertical space
              for one button. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <EmployeePicker
              size="lg"
              employees={employees}
              value={employee}
              onChange={selectEmployee}
              isLoading={employeesLoading || (employeeLoading && isScheduleLoading)}
              tail={schedulePickerTail}
              isDisabled={(candidate) => !isWeeklyScheduleEligible(candidate.employment_type)}
            />
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <SpreadsheetImportTrigger
                onClick={() => navigate("/hr-schedule/import")}
                className="w-full sm:w-auto"
              />
            </div>
          </div>

          {/* Gated HERE, not only inside each dialog. Each returns null in
              production, but an empty wrapper is still a flex child and still
              costs the parent's gap-2. */}
          {IS_DEV_BUILD ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <ClearEmployeeScheduleDialog
                employee={scheduleEmployeeId}
                employeeRow={selectedEmployee}
                employeeLabel={employeeLabel}
                triggerClassName="h-9 w-full shrink-0 sm:w-auto"
                disabled={!scheduleEmployeeId}
                onSuccess={() => void reseedFormFromServer()}
              />
              <ClearAllSchedulesDialog triggerClassName="h-9 w-full shrink-0 sm:w-auto" />
              <ClearSitePatternsDialog triggerClassName="h-9 w-full shrink-0 sm:w-auto" />
            </div>
          ) : null}
        </div>
```

The inner `flex flex-wrap` around the single import button is deliberate: Task 3 adds the Edit button beside it, and a wrapper that already exists is one fewer thing for that task to restructure.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; count up by 5 from Task 1's baseline; 0 failures.

`devControlsHidden.test.tsx` must still pass untouched — it asserts the dialogs themselves render nothing in production, which this change does not affect.

- [ ] **Step 6: Run e2e**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:e2e
```

Expected: PASS. `schedule-edit.spec.ts` asserts the "Editing an existing schedule…" text that Step 3 deletes — update that assertion to target the Shift blocks card's surviving description, `One block per shared pattern`, since the editing notice is gone and Task 3 replaces the concept entirely.

- [ ] **Step 7: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "refactor(schedule): rename isEditing, drop dead previewOnly, lift import

No behaviour change. isEditing means 'has a live schedule', which becomes
actively misleading next to the edit mode landing next; previewOnly has been
declared and never read since PR #38 pinned it.

The import trigger moves into the picker's row: in production it was the only
control in the row below, since all three Clear* dialogs are dev-only. That
row is now gated at the wrapper — each dialog already returns null, but an
empty wrapper is still a flex child and still costs the parent's gap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The mode

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/schedulePreviewFirst.test.tsx`

**Interfaces:**
- Consumes: `ScheduleMode`, `openingScheduleMode` from Task 1; `hasLiveSchedule` and the picker row from Task 2.
- Produces: a `mode` state read by Task 4's dirty confirm.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/schedulePreviewFirst.test.tsx`:

```tsx
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
  const src = pageSource();
  assert.match(src, /plannedDaysFromWeekPattern\(weekPattern\)/);
  assert.match(src, /resolveWeekPatternWindow\(weekPattern\)/);
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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/schedulePreviewFirst.test.tsx
```

Expected: FAIL on all four — there is no `mode` in the page yet.

- [ ] **Step 3: Add the state and reset**

Imports to add:

```tsx
import { plannedDaysFromWeekPattern, resolveWeekPatternWindow } from "@/lib/plannedDays";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { summarizeWeekPattern } from "@/types/schedule";
import { PlannedWeekCanvas } from "@/ui/PlannedWeekCanvas";
```

`openingScheduleMode` and the `ScheduleMode` type join the existing `@/lib/scheduleEdit` import block.

Beside the page's other `useState` calls:

```tsx
  const [mode, setMode] = useState<ScheduleMode>("edit");
```

The initial value is `"edit"` only because no context has loaded yet; the effect below owns it from then on. Add this effect immediately after the existing seeding effect that keys on `context?.employee`:

```tsx
  // The mode is a property of the employee on screen, so it is re-derived
  // whenever the context that answers `hasLiveSchedule` arrives — including on
  // an employee switch, which reseeds the form in the effect above. Keyed on
  // the same `context?.employee` so the two never disagree about who is shown.
  useEffect(() => {
    if (!context) return;
    setMode(openingScheduleMode((context.enabled_ssa_count ?? 0) > 0));
  }, [context?.employee]);
```

Read `context.enabled_ssa_count` directly rather than `hasLiveSchedule`: the derived constant is not in the dependency array, and adding it would re-run the effect on every context refetch — snapping a user out of edit mode mid-edit whenever the schedule is refreshed.

- [ ] **Step 4: Render preview**

Replace the `<Section grow>` body's final branch — the one currently rendering `WeeklyScheduleAnimatedShell` with the Card — so the Card is the `edit` arm of a mode ternary:

```tsx
            <WeeklyScheduleAnimatedShell
              loading={isScheduleLoading}
              employeeKey={scheduleEmployeeId}
            >
              {mode === "preview" ? (
                <SchedulePreview
                  weekPattern={weekPattern}
                  onEdit={() => setMode("edit")}
                />
              ) : (
                <Card
                  /* …the existing Card, unchanged… */
                />
              )}
            </WeeklyScheduleAnimatedShell>
```

Add the component at the bottom of the file, beside the page's other local components:

```tsx
/**
 * The read-only week.
 *
 * Every part of this already existed inside `SchedulePlanPreviewDialog`:
 * the canvas, both adapters, and the summary. The only new thing is that it is
 * inline rather than in a modal. No Card header, no ScrollArea — those exist to
 * frame an editor, and this is a document.
 */
function SchedulePreview(props: { weekPattern: WeekPattern; onEdit: () => void }) {
  const { workDays, offDays, totalWeeklyMinutes } = summarizeWeekPattern(props.weekPattern);
  const weeklyHoursLabel =
    totalWeeklyMinutes > 0 ? formatScheduleDuration(totalWeeklyMinutes) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1">
        <PlannedWeekCanvas
          days={plannedDaysFromWeekPattern(props.weekPattern)}
          window={resolveWeekPatternWindow(props.weekPattern)}
          minDayWidth="3rem"
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {workDays} work · {offDays} off
          {weeklyHoursLabel ? ` · ${weeklyHoursLabel}/wk` : null}
        </p>
        <Button type="button" variant="outline" className="h-9" onClick={props.onEdit}>
          Edit schedule
        </Button>
      </div>
    </div>
  );
}
```

`WeekPattern` is already imported by this page as a type.

- [ ] **Step 5: Gate the footer on edit mode**

Change the footer's condition from `scheduleEmployeeId ? (` to:

```tsx
        {mode === "edit" && scheduleEmployeeId ? (
```

- [ ] **Step 6: Run the tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; count up by 5 from Task 2's baseline; 0 failures.

- [ ] **Step 7: Run e2e**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:e2e
```

Expected: `schedule-edit.spec.ts` FAILS — it opens `/hr-schedule?employee=EMP-001`, an employee with a live schedule, and immediately expects the editor's Save/Review button. That is the behaviour change, not a regression. Add a click on `Edit schedule` after the `goto` in both tests in that file, before the existing assertions:

```ts
    await page.getByRole("button", { name: "Edit schedule" }).click();
```

Re-run and expect the full suite green.

- [ ] **Step 8: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "feat(schedule): /hr-schedule opens on a read-only preview

An employee with a live schedule lands on the week as a document — canvas,
one line of facts, an Edit button — with no template picker and no footer.
An employee with no schedule still opens straight into the editor: there is
nothing to preview and editing is the only thing they can do.

Nothing new renders the preview. PlannedWeekCanvas, both planned-day adapters
and summarizeWeekPattern were already composed exactly this way inside
SchedulePlanPreviewDialog; this is the same view, inline.

The mode effect reads context.enabled_ssa_count rather than the derived
constant, so a context refetch cannot snap someone out of edit mid-edit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Cancel, and the dirty confirm

One rule the reader can hold — unsaved changes are confirmed before they are lost — covering both ways out of edit mode, through one modal.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/WeeklySchedulePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/schedulePreviewFirst.test.tsx`

**Interfaces:**
- Consumes: `scheduleFormFingerprint` from Task 1; `mode` / `setMode` from Task 3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/schedulePreviewFirst.test.tsx`:

```tsx
test("leaving edit mode is guarded by one shared dirty check, not two rules", () => {
  // Cancel and switching employee are both "leave with unsaved work". Two
  // different answers to that question is one more rule than the reader needs.
  const src = pageSource();
  assert.match(src, /scheduleFormFingerprint/, "the page must compute a dirty key");
  assert.match(src, /pendingEmployeeId/, "an employee switch must be able to wait on the confirm");
});

test("the discard confirm reuses ResponsiveModal rather than adding a component", () => {
  const src = pageSource();
  assert.match(src, /discardOpen/, "expected discard-confirm state");
  const modals = src.match(/<ResponsiveModal/g) ?? [];
  assert.ok(modals.length >= 2, "expected the save confirm plus the discard confirm");
});

test("a clean form leaves edit mode without asking", () => {
  // The common path is: pressed Edit, looked, left. A confirm there is a
  // dialog that always says the same thing, which teaches people to dismiss it.
  assert.match(
    pageSource(),
    /if \(!isDirty\)/,
    "expected an early return that skips the confirm when clean",
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/schedulePreviewFirst.test.tsx
```

Expected: FAIL on all three.

- [ ] **Step 3: Track the clean baseline**

Add a ref beside `appliedTemplateFingerprint`:

```tsx
  const seededFingerprint = useRef<string | null>(null);
```

In the existing seeding effect keyed on `context?.employee`, record the baseline as the form is seeded — the server's state is by definition clean:

```tsx
  useEffect(() => {
    if (!context) return;
    const seeded = scheduleFormStateFromContext(context);
    setShiftBlocks(seeded.shiftBlocks);
    setEffectiveFrom(seeded.effectiveFrom);
    setGenerateThrough(seeded.generateThrough);
    setLimitGenerateThrough(seeded.limitGenerateThrough);
    seededFingerprint.current = scheduleFormFingerprint(seeded);
  }, [context?.employee]);
```

Derive dirtiness:

```tsx
  const isDirty =
    seededFingerprint.current !== null &&
    scheduleFormFingerprint({
      shiftBlocks,
      effectiveFrom,
      generateThrough,
      limitGenerateThrough,
    }) !== seededFingerprint.current;
```

- [ ] **Step 4: Add the exits and the confirm**

State:

```tsx
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingEmployeeId, setPendingEmployeeId] = useState<string | null>(null);
```

The two exits, and the one place that performs the discard:

```tsx
  // Both ways out of edit mode with unsaved work funnel through one confirm.
  // `pendingEmployeeId` is what distinguishes them: null means "just leave edit
  // mode", a value means "leave, then switch to this person".
  function leaveEditMode() {
    if (!isDirty) {
      setMode("preview");
      return;
    }
    setPendingEmployeeId(null);
    setDiscardOpen(true);
  }

  function requestEmployeeChange(id: string) {
    if (!isDirty) {
      selectEmployee(id);
      return;
    }
    setPendingEmployeeId(id);
    setDiscardOpen(true);
  }

  function confirmDiscard() {
    setDiscardOpen(false);
    if (pendingEmployeeId) {
      // The seeding effect reseeds the form and the mode effect re-derives the
      // mode, so nothing else has to be undone by hand here.
      selectEmployee(pendingEmployeeId);
      setPendingEmployeeId(null);
      return;
    }
    if (context) {
      const seeded = scheduleFormStateFromContext(context);
      setShiftBlocks(seeded.shiftBlocks);
      setEffectiveFrom(seeded.effectiveFrom);
      setGenerateThrough(seeded.generateThrough);
      setLimitGenerateThrough(seeded.limitGenerateThrough);
      seededFingerprint.current = scheduleFormFingerprint(seeded);
    }
    setMode("preview");
  }
```

Point the picker at `requestEmployeeChange` instead of `selectEmployee`:

```tsx
              onChange={requestEmployeeChange}
```

Add Cancel beside Save in the footer's button group, before the Save `<Button>`:

```tsx
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9"
                  onClick={leaveEditMode}
                  disabled={applying}
                >
                  Cancel
                </Button>
```

And the confirm, beside the page's existing `ResponsiveModal`:

```tsx
      <ResponsiveModal
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        size="sm"
        title="Discard unsaved changes?"
        description="This schedule has edits that have not been saved. Discarding returns it to the version on file."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDiscard}>
              Discard changes
            </Button>
          </>
        }
      />
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
```

Expected: typecheck clean; web count up by 3 from Task 3's baseline; 0 failures; e2e green.

If `ResponsiveModal` rejects `size="sm"`, read its prop type and use the smallest it offers. Do not widen the modal to fit a size that does not exist.

- [ ] **Step 6: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "feat(schedule): Cancel discards, and confirms only when dirty

One rule for both ways out of edit mode: Cancel and switching employee are
the same question — leave with unsaved work — so they raise the same confirm
rather than answering differently. pendingEmployeeId is what tells them
apart.

A clean form leaves silently. That is the common path — pressed Edit, looked,
left — and a confirm that always says the same thing teaches people to
dismiss confirms.

Switching employee previously reseeded the form with no warning. That was
already a quiet data-loss path and gets worse once edits are deliberate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Measure the reclaimed height in a browser

The spec's ~134px desktop and ~244px phone figures are derived from class strings. Derived layout numbers on this codebase have been wrong before — the shared-picker work's chrome budget hinged on an avatar size changed later in the same design, and `--font-khmer` shipped naming a font family that did not exist. This task replaces the estimate with a measurement.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/e2e/schedule-preview.spec.ts`

**Interfaces:**
- Consumes: the mode from Tasks 3 and 4, rendered live.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

Create `e2e/schedule-preview.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/** Total laid-out height of the page's content, in CSS pixels. */
async function contentHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.body.getBoundingClientRect().height);
}

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("an employee with a live schedule lands on preview, not the editor", async ({ page }) => {
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review changes|Save schedule/ })).toHaveCount(0);
  await expect(page.getByText("Effective from")).toHaveCount(0);
});

test("Edit opens the editor, and Cancel with no changes returns silently", async ({ page }) => {
  await page.goto("/hr-schedule?employee=EMP-001");
  await page.getByRole("button", { name: "Edit schedule" }).click();

  await expect(page.getByRole("button", { name: /Review changes|Save schedule/ })).toBeVisible();
  await expect(page.getByText("Effective from")).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  // Clean form: no confirm, straight back to preview.
  await expect(page.getByText("Discard unsaved changes?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
});

test("preview is shorter than edit, and by how much", async ({ page }) => {
  // The spec derived ~134px at desktop from class strings. This records what
  // it actually is; the number in the spec is only an estimate until it agrees
  // with this one.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  const preview = await contentHeight(page);

  await page.getByRole("button", { name: "Edit schedule" }).click();
  await expect(page.getByText("Effective from")).toBeVisible();
  const edit = await contentHeight(page);

  console.log(`[measured] desktop preview ${preview}px · edit ${edit}px · saved ${edit - preview}px`);
  expect(edit).toBeGreaterThan(preview);
});

test("/hr-schedule still does not scroll sideways at 375px in either mode", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();

  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Edit schedule" }).click();
  await expect(page.getByText("Effective from")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 2: Run it and record the measured saving**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx playwright test e2e/schedule-preview.spec.ts --reporter=list
```

Expected: all pass. **Read the `[measured]` line and record the actual pixel saving in the task report** — the number is the deliverable, and "it passed" is a different claim from "it saved 134px".

`EMP-001` is the fixture employee and has a live schedule via `enabled_ssa_count`. If the first test fails because the page opens in edit, check that the stub returns a non-zero `enabled_ssa_count` for them before changing any component — the mode rule is correct and the fixture may not be.

- [ ] **Step 3: Reconcile the spec's estimate with the measurement**

Edit `docs/superpowers/specs/2026-08-14-schedule-preview-first-design.md`'s "Vertical reclaimed" table: replace the derived desktop figure with the measured one and change the sentence below it from "These are derived… not measured" to a note recording the measured value and where it is asserted. If the measurement is materially smaller than ~134px, say so plainly rather than quietly adjusting the number.

- [ ] **Step 4: Run every suite**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
cd /Users/lolbikb/projects/dewey-time && python3 -m unittest discover -s dewey_time/tests -t . 2>&1 | tail -3
```

Expected: all green. Report the web unit count, the e2e count and the Python count.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/e2e/schedule-preview.spec.ts docs/superpowers/specs/2026-08-14-schedule-preview-first-design.md
git commit -m "test(schedule): measure the height preview-first actually reclaims

The spec derived ~134px from class strings. This records what the page
actually measures at 1280 and checks neither mode scrolls sideways at 375px,
then reconciles the spec's estimate with the measured figure.

Also pins the behaviour the modes exist for: a live schedule lands on
preview with no Save button, Edit opens the editor, and Cancel on a clean
form returns without a confirm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Branch close

- [ ] Rebuild the committed bundles once — they are the deployed artifact and Frappe Cloud never builds these SPAs:

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run build
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/public dewey_time/www && git commit -m "chore(build): rebuild hr_attendance bundle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] Then use superpowers:finishing-a-development-branch. Base branch is `main`; the repo convention is a squash-merge via PR with a `(#NNN)` suffix on the title.
