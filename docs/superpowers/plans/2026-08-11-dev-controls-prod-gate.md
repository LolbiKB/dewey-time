# Dev Controls Production Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four "(dev)" controls in the HR SPA do not render in a production build.

**Architecture:** One shared constant reads Vite's dev flag; each of the four dialog components returns `null` before any hooks when it is false. Gating lives inside the components rather than at their mount sites, so a future fifth mount cannot forget it.

**Tech Stack:** React 19 + TypeScript + Vite, tested with `tsx --test` and `renderToStaticMarkup` from `react-dom/server`.

**Spec:** `docs/superpowers/specs/2026-08-11-dev-controls-prod-gate-design.md` · **Punch list:** T1-5

## Global Constraints

- **The guard must be written `import.meta.env?.DEV`, with the optional chain.** `import.meta.env` is a Vite construct and is `undefined` under `tsx --test` — verified. Written `import.meta.env.DEV`, every test that imports a gated dialog dies on `TypeError: Cannot read properties of undefined (reading 'DEV')`.
- **The guard is the first statement in each component, before any hook call.** All four call `useState` and a custom hook immediately. `IS_DEV_BUILD` is constant for the process, so returning early never changes hook order between renders of one mount.
- **The backend gate is not in scope and must not be touched.** `dev_tools._require_system_manager_for_clear()` remains the actual security boundary.
- **`schedule_change_log` — not relevant here. Do not touch backend files at all.** This plan is frontend-only.
- **Built assets are the deployed artifact and must be committed.** Frappe Cloud never builds these SPAs (private `@lolbikb/dewey-ui` dependency). Task 2 covers the rebuild.
- Frontend test baseline before this plan: run `npm run test:web` once and record the printed `# tests` count. Report changes as deltas from that number, never absolutes.
- Commit trailers on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A`.

## The four controls

| Component | File | Trigger marker in rendered HTML |
|---|---|---|
| `ClearEmployeeScheduleDialog` | `src/ui/ClearEmployeeScheduleDialog.tsx` | text `Clear schedule (dev)` |
| `ClearAllSchedulesDialog` | `src/ui/ClearAllSchedulesDialog.tsx` | text `Clear all (dev)` |
| `ClearSitePatternsDialog` | `src/ui/ClearSitePatternsDialog.tsx` | text `Wipe patterns (dev)` |
| `RunEngineDialog` | `src/ui/RunEngineDialog.tsx` | `aria-label="Run flag engine"` — an icon button with **no visible text** |

All paths are relative to `dewey_time/frontend/hr_attendance/`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/devBuild.ts` | *Create.* The single place `import.meta.env` is read. | 1 |
| `src/lib/devBuild.test.ts` | *Create.* Pins the constant falsy under the runner. | 1 |
| The four component files above | *Modify.* Early `return null`. | 1 |
| `src/ui/devControlsHidden.test.tsx` | *Create.* Four absence assertions + one control. | 1 |
| `docs/ROLLOUT_PUNCH_LIST.md` | *Modify.* Close T1-5, correct what it says the defect is. | 2 |

---

### Task 1: Gate the four controls

**Files:**
- Create: `src/lib/devBuild.ts`, `src/lib/devBuild.test.ts`, `src/ui/devControlsHidden.test.tsx`
- Modify: `src/ui/ClearEmployeeScheduleDialog.tsx`, `src/ui/ClearAllSchedulesDialog.tsx`, `src/ui/ClearSitePatternsDialog.tsx`, `src/ui/RunEngineDialog.tsx`

**Interfaces:**
- Produces: `IS_DEV_BUILD: boolean` exported from `@/lib/devBuild`. Nothing else consumes it yet.
- Consumes: `SpreadsheetImportTrigger` from `@/ui/schedule-import/SpreadsheetImportTrigger`, whose props are `{ onClick: () => void; disabled?: boolean; className?: string }`. It renders a `<Button>` containing the text `Import`. It is **not** a dev control and must keep rendering — it is the control case.

- [ ] **Step 1: Record the test baseline**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -8
```

Write the printed `# tests` number into the task report. Every later count in this task is a delta from it.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/devBuild.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { IS_DEV_BUILD } from "./devBuild";

test("IS_DEV_BUILD is false when import.meta.env is absent", () => {
  // Under `tsx --test` there is no Vite, so `import.meta.env` is undefined.
  // That is deliberate and load-bearing: it makes the test environment behave
  // exactly like a production build, which is what lets the render tests in
  // devControlsHidden.test.tsx assert absence without mocking anything.
  //
  // It is also why devBuild.ts uses `import.meta.env?.DEV`. Without the
  // optional chain this import alone would throw a TypeError.
  assert.equal(IS_DEV_BUILD, false);
});

test("IS_DEV_BUILD is a boolean, not a truthy value", () => {
  // Boolean() rather than a bare read: `import.meta.env?.DEV` is `undefined`
  // here, and a component doing `if (!X) return null` on undefined works by
  // accident. Pinning the type keeps the constant honest for any future
  // consumer that renders it or compares with ===.
  assert.equal(typeof IS_DEV_BUILD, "boolean");
});
```

Create `src/ui/devControlsHidden.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SpreadsheetImportTrigger } from "@/ui/schedule-import/SpreadsheetImportTrigger";
import { ClearAllSchedulesDialog } from "@/ui/ClearAllSchedulesDialog";
import { ClearEmployeeScheduleDialog } from "@/ui/ClearEmployeeScheduleDialog";
import { ClearSitePatternsDialog } from "@/ui/ClearSitePatternsDialog";
import { RunEngineDialog } from "@/ui/RunEngineDialog";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Rendered inside TooltipProvider throughout. Nothing needs it while the guard
// holds -- each component returns null before touching a hook -- but if a guard
// is ever removed, RunEngineDialog's AppTooltip would otherwise throw for a
// missing provider. The failure should read "the button is present", which is
// the actual regression, not "context missing".
function markup(node: ReactNode) {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
}

// THE CONTROL. Every assertion below is an absence, and absence proves nothing
// if the harness renders nothing at all. This is a real, non-dev trigger from
// the same header row: it must appear.
test("the render harness works: a non-dev trigger DOES render", () => {
  const html = markup(<SpreadsheetImportTrigger onClick={() => {}} />);
  assert.match(html, />Import</);
});

test("Clear schedule (dev) does not render in a production build", () => {
  const html = markup(<ClearEmployeeScheduleDialog employee="HR-EMP-00001" />);
  assert.doesNotMatch(html, /Clear schedule \(dev\)/);
});

test("Clear all (dev) does not render in a production build", () => {
  const html = markup(<ClearAllSchedulesDialog />);
  assert.doesNotMatch(html, /Clear all \(dev\)/);
});

test("Wipe patterns (dev) does not render in a production build", () => {
  const html = markup(<ClearSitePatternsDialog />);
  assert.doesNotMatch(html, /Wipe patterns \(dev\)/);
});

test("Run flag engine (dev) does not render in a production build", () => {
  // Asserted on the aria-label: this trigger is an icon button with no visible
  // text, so matching on the "(dev)" string would only find the tooltip
  // content and would pass even if the button itself rendered.
  const html = markup(
    <RunEngineDialog employee="HR-EMP-00001" weekStart={new Date("2026-03-02T00:00:00Z")} />,
  );
  assert.doesNotMatch(html, /aria-label="Run flag engine"/);
});

test("all four dev controls carry the guard, not just the ones rendered above", () => {
  // A source-text check in the idiom of dialogMigration.test.tsx. The render
  // tests prove the four behave correctly today; this one fails loudly if
  // someone adds a fifth dev control to the list without gating it, or strips
  // a guard while leaving the component returning null for another reason.
  const GATED = [
    "src/ui/ClearAllSchedulesDialog.tsx",
    "src/ui/ClearEmployeeScheduleDialog.tsx",
    "src/ui/ClearSitePatternsDialog.tsx",
    "src/ui/RunEngineDialog.tsx",
  ];
  for (const rel of GATED) {
    const src = readFileSync(resolve(PKG, rel), "utf8");
    assert.match(src, /IS_DEV_BUILD/, `${rel} imports the build guard`);
    assert.match(src, /if \(!IS_DEV_BUILD\) return null;/, `${rel} returns null in prod builds`);
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -20
```

Expected: failures — `Cannot find module './devBuild'` / `@/lib/devBuild`, and the four absence tests failing because the triggers currently render.

Confirm the four absence tests fail **for the right reason** (the trigger is present), not because rendering threw. If any reports an exception rather than a match, say so in the report before continuing.

- [ ] **Step 4: Create the shared constant**

Create `src/lib/devBuild.ts`:

```ts
/**
 * Is this a development build?
 *
 * The one place in the app that reads `import.meta.env` for this purpose, and
 * the optional chain is load-bearing rather than defensive style:
 * `import.meta.env` is a Vite construct that does NOT exist under
 * `tsx --test`, the web test runner. Written `import.meta.env.DEV`, every test
 * that imports a module guarded by this constant dies on
 * `TypeError: Cannot read properties of undefined (reading 'DEV')`.
 *
 * The useful consequence: under the test runner this reads false, so the test
 * environment behaves exactly like a production build and the guards can be
 * asserted with no mocking at all.
 *
 * Used to keep destructive "(dev)" controls out of the production HR UI
 * (T1-5). It is a UX and defence-in-depth measure, NOT a security boundary --
 * `dev_tools._require_system_manager_for_clear()` is, and it stays.
 */
export const IS_DEV_BUILD = Boolean(import.meta.env?.DEV);
```

- [ ] **Step 5: Gate the four components**

In each of the four files, add the import and make the guard the **first statement** of the component function, before any `useState` or custom-hook call.

Import line (place with the other `@/lib` imports):

```ts
import { IS_DEV_BUILD } from "@/lib/devBuild";
```

Guard, immediately after the function's opening brace. Use this exact text in all four — the source-text test matches on it:

```tsx
  if (!IS_DEV_BUILD) return null;
```

Add this comment above the guard in **`ClearAllSchedulesDialog.tsx` only**, so the reasoning lives once in the most destructive of the four rather than being copy-pasted four times:

```tsx
  // Destructive dev tooling does not ship to the production HR UI (T1-5).
  // Before any hook: IS_DEV_BUILD is constant for the process, so hook order
  // never varies between renders of one mount, and returning here avoids
  // spinning up the preview/clear hooks for a control nobody can see.
  //
  // Gated inside the component rather than at the mount site on purpose: these
  // dialogs have already moved once (the punch list cites line numbers in a
  // file where they no longer live), and a component that refuses to render
  // itself cannot be un-gated by someone adding another mount.
  //
  // This stops them RENDERING, not shipping -- the module is still statically
  // imported, so the code remains in the bundle. Getting it out would need
  // lazy imports at each mount; the goal here is that they are absent from the
  // HR UI.
```

In the other three, the bare guard line is enough — a reader who wants the reasoning finds it via `IS_DEV_BUILD`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -8
```

Expected: PASS, **+8 from the Step 1 baseline** (2 in `devBuild.test.ts`, 6 in `devControlsHidden.test.tsx`).

- [ ] **Step 7: Typecheck**

```bash
cd dewey_time/frontend/hr_attendance && npm run typecheck 2>&1 | tail -10
```

Expected: clean. `vite/client` is in tsconfig's `types`, so `import.meta.env` is typed and the optional chain is permitted.

- [ ] **Step 8: Mutation-check every guard**

Absence tests are the easiest kind to write vacuously, so prove each one bites. Remove the guard from one component at a time, run `npm run test:web`, confirm the matching test fails, then restore it.

| Guard removed from | Test that must fail |
|---|---|
| `ClearEmployeeScheduleDialog.tsx` | `Clear schedule (dev) does not render…` |
| `ClearAllSchedulesDialog.tsx` | `Clear all (dev) does not render…` |
| `ClearSitePatternsDialog.tsx` | `Wipe patterns (dev) does not render…` |
| `RunEngineDialog.tsx` | `Run flag engine (dev) does not render…` |

Then one mutation on the constant itself: change `Boolean(import.meta.env?.DEV)` to `true` and confirm **all four** absence tests fail while the control still passes. Restore.

Record each observed result in the task report. A mutation that does not fail is a finding — report it rather than moving on.

- [ ] **Step 9: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/frontend/hr_attendance/src/lib/devBuild.ts \
        dewey_time/frontend/hr_attendance/src/lib/devBuild.test.ts \
        dewey_time/frontend/hr_attendance/src/ui/devControlsHidden.test.tsx \
        dewey_time/frontend/hr_attendance/src/ui/ClearAllSchedulesDialog.tsx \
        dewey_time/frontend/hr_attendance/src/ui/ClearEmployeeScheduleDialog.tsx \
        dewey_time/frontend/hr_attendance/src/ui/ClearSitePatternsDialog.tsx \
        dewey_time/frontend/hr_attendance/src/ui/RunEngineDialog.tsx
git commit -m "fix(ui): destructive dev controls do not render in production builds

Four controls labelled (dev) rendered in the production HR UI. The backend
was already gated -- _require_system_manager_for_clear stays the real
boundary -- so this is defence in depth and UX, not a privilege fix.

The guard reads import.meta.env?.DEV. The optional chain is load-bearing:
import.meta.env does not exist under tsx --test, so the bare form would kill
every test that imports a gated dialog. It also makes the test environment
read as production, which is what lets the render tests assert absence with
no mocking.

Absence tests pass vacuously if the harness is broken, so the suite renders a
real non-dev trigger as a control, and every guard was mutation-checked.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 2: Rebuild the bundle and close the record

The built assets under `dewey_time/public/` are the deployed artifact — Frappe Cloud never builds these SPAs, because they depend on the private `@lolbikb/dewey-ui` package. A source-only commit ships nothing.

**Files:**
- Modify: `dewey_time/public/**` and `dewey_time/www/*.html` (build output — whatever `npm run build` produces)
- Modify: `docs/ROLLOUT_PUNCH_LIST.md`

**Interfaces:** None. This task consumes Task 1's source changes and produces no new API.

- [ ] **Step 1: Rebuild**

```bash
cd dewey_time/frontend/hr_attendance && npm run build 2>&1 | tail -15
```

Expected: a successful build. If it fails on a missing `@lolbikb/dewey-ui`, that is the private-registry auth problem — stop and report rather than working around it.

- [ ] **Step 2: Confirm the built bundle no longer contains the trigger labels**

```bash
cd /Users/lolbikb/projects/dewey-time
grep -rl "Clear all (dev)\|Wipe patterns (dev)\|Clear schedule (dev)" dewey_time/public/ 2>/dev/null | head
```

Expected: **no output.** The strings are inside the guarded branch, so Vite's dead-code elimination should drop them once `import.meta.env.DEV` is statically `false`.

If the strings ARE still present, that is not a failure of this plan — the spec is explicit that the guard stops rendering, not shipping, and the optional chain may block Vite's static replacement. Report what you observe, note that the runtime behaviour is still correct and covered by Task 1's tests, and continue. Do **not** start reworking the guard to chase dead-code elimination; that trade was already decided.

- [ ] **Step 3: Close T1-5 in the punch list**

In `docs/ROLLOUT_PUNCH_LIST.md`, change T1-5's `- [ ]` to `- [x]` and append after its final sentence:

```markdown
  **Fixed 2026-08-11.** All four gated on `IS_DEV_BUILD` (`src/lib/devBuild.ts`), returning `null` before any hook. `RunEngineDialog` ("Run flag engine (dev)", `AttendanceToolbar.tsx`) is included although this entry does not name it: it is labelled "(dev)", it deletes and re-inserts flags, and hiding three of four dev controls would have been an arbitrary line.

  **The entry overstates the gap, and the correction is worth keeping.** These were never ungated — `WeeklySchedulePage` already redirects non-HR-staff away entirely, and `RunEngineDialog` was already wrapped in `hrStaff`. The real defect was that the gate was set to the **wrong role**: `hr_staff` means `System Manager | HR User | HR Manager`, while executing any of these needs System Manager alone, so an HR User saw three buttons that wipe schedule data and could not use any of them. Build-gating makes the distinction moot rather than fixing it.

  The guard is written `import.meta.env?.DEV`. The optional chain is load-bearing: `import.meta.env` does not exist under `tsx --test`, so the bare form kills every test that imports a gated dialog — and with it, the test environment reads as a production build, which is what lets the render tests assert absence with no mocking. The `DEV === true` branch is deliberately not covered: nothing can set the Vite env under `tsx`, and developers see the buttons on the dev server. Claiming coverage there would be exactly the green-that-proves-nothing this list has recorded twice.

  Backend untouched — `_require_system_manager_for_clear()` remains the security boundary.
```

- [ ] **Step 4: Run the whole frontend lane once more**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3
```

Expected: same count as Task 1 Step 6, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/public dewey_time/www docs/ROLLOUT_PUNCH_LIST.md
git commit -m "build(hr): rebuild the bundle without the dev controls, close T1-5

Built assets are the deployed artifact -- Frappe Cloud never builds this SPA
because of the private @lolbikb/dewey-ui dependency -- so a source-only
commit would have shipped nothing.

Corrects what the punch-list entry says the defect was: not ungated controls,
but a gate set to hr_staff where executing needs System Manager.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

## Out of scope

- **Backend gating.** `_require_system_manager_for_clear()` is correct and is the real security boundary.
- **Removing the dialog code from the bundle.** Would need lazy imports at each mount. Step 2 of Task 2 observes whether tree-shaking happens to achieve it, but does not chase it.
- **A System Manager capability signal for the SPA.** The buttons' absence from production makes it unnecessary.
