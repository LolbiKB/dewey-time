# Notice System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nine ad-hoc persistent notices in the HR attendance SPA with two shared primitives and one context convention, so a routine fact stops rendering as an assertive alert and a single failure stops being reported twice.

**Architecture:** Two new components in `src/components/ui/notice.tsx` — `AttentionStrip` (`role="status"`, one line at rest, detail behind a native `<details>` whose `<summary>` *is* the header row) and `FailureBlock` (`role="alert"`, occupies the region that failed). Role 1 "context" gets no component: it is a muted `<p>` passed into a slot the page already has. `components/ui/alert.tsx` is not modified and remains in use for in-dialog errors.

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS v4, shadcn/ui, `@lolbikb/dewey-ui`, lucide-react. Tests are `tsx --test` with `node:assert/strict` and `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-07-31-notice-system-design.md`

## Global Constraints

- Work from `dewey_time/frontend/hr_attendance/`. All paths below are relative to it unless stated.
- **Tests must live inside the `test:web` glob:** `src/lib`, `src/brand`, `src/pwa`, `src/components`, `src/ui`. It is a per-directory list, **not recursive**. A test placed elsewhere is silently never run and the suite still reports green. Baseline is **316 passing**; every task that adds tests must show the printed `# tests` total rise.
- **Never resolve a path from the CWD in a test.** Anchor on `import.meta.url`.
- Do **not** run `npm install`. Do **not** edit `package-lock.json`. The **only** authorised
  `package.json` change in this plan is the one-glob addition in Task 1, Step 1 — no dependency
  changes, no other script edits.
- `git add` only the files named in the task. Never `git add -A`, `.`, or `-u`.
- Do not checkout, switch, branch, stash, reset, rebase, merge, clean, or push.
- Exact ARIA roles: `AttentionStrip` → `role="status"`. `FailureBlock` → `role="alert"`. Role 1 context → **no role**.
- Copy strings are exact. Do not reword them.
- The effective date is **not** repeated in the schedule header. The `Effective from` picker owns it.
- `components/ui/alert.tsx` is **not** modified in this plan.
- The final task rebuilds and commits the bundle. Frappe Cloud cannot build this SPA — a merged PR that changes `frontend/` but not `public/hr_attendance/` ships nothing.

## File Structure

| File | Responsibility |
|---|---|
| `src/components/ui/notice.tsx` | **Create.** `AttentionStrip` + `FailureBlock`. No app-specific knowledge. |
| `src/components/ui/notice.test.tsx` | **Create.** Unit tests for both, plus the source guard in Task 5. |
| `src/ui/DeviceAlerts.tsx` | **Modify.** Both device banners become `AttentionStrip`. |
| `src/ui/App.tsx` | **Modify.** Two failure surfaces collapse to one `FailureBlock`. |
| `src/ui/WeeklySchedulePage.tsx` | **Modify.** Delete the ineligible `Alert`; move the editing notice into `PageHeader`'s `description`. |
| `src/ui/schedule-coverage/ScheduleCoveragePage.tsx` | **Modify.** Error `Alert` → `FailureBlock`. |
| `src/ui/schedule-import/UploadStep.tsx` | **Modify.** Align the inline parse-error tokens only. |
| `e2e/schedule-edit.spec.ts` | **Modify.** One assertion follows the new copy. |

## Two refinements to the spec's signatures

Found while planning; both are additive and required by real call sites.

1. `FailureBlock.cause` is `React.ReactNode`, not `string` — `App.tsx` passes guidance text *plus* a second `<span>` carrying the server detail.
2. `FailureBlock` takes `retrying?: boolean` — `App.tsx`'s existing retry shows a `Spinner` while `isRefreshing`.

---

### Task 1: The two notice primitives

**Files:**
- Create: `src/components/ui/notice.tsx`
- Test: `src/components/ui/notice.test.tsx`

**Interfaces:**
- Consumes: `@/components/ui/button` (`Button`), `@/components/ui/spinner` (`Spinner`), `lucide-react` (`ChevronRightIcon`, `CloudOffIcon`).
- Produces:
  - `AttentionStrip(props: { tone: "amber" | "accent"; icon: React.ReactNode; children: React.ReactNode; detail?: React.ReactNode; count?: number }): React.JSX.Element`
  - `FailureBlock(props: { title: string; cause?: React.ReactNode; onRetry?: () => void; retrying?: boolean }): React.JSX.Element`

- [ ] **Step 1a: Extend the `test:web` glob to cover `src/components/ui/`**

The glob is an explicit per-directory list and is **not** recursive. `src/components/*.test.tsx`
matches only files directly in `src/components/` — so a test in `src/components/ui/` is silently
never collected. That directory holds **30 components and zero tests** today, so this is a trap
for the whole directory, not just this task.

In `package.json`, add one entry to `scripts["test:web"]`, immediately after
`src/components/*.test.tsx`:

```
src/components/ui/*.test.tsx
```

The full script becomes:

```
tsx --test src/lib/*.test.ts src/brand/*.test.ts src/brand/*.test.tsx src/pwa/*.test.ts src/pwa/*.test.tsx src/components/*.test.tsx src/components/ui/*.test.tsx src/ui/*.test.tsx
```

This is the only authorised `package.json` edit in the plan. It cannot surface pre-existing
failures, because no test file exists under `src/components/ui/` yet. Do not touch
`package-lock.json`.

Run: `npm run test:web`
Expected: still **316** passing — the new glob matches nothing yet.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/notice.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";

// Role 2 is "polite". It must never interrupt a screen reader for data that is
// merely stale — that is what role="alert" would do.
test("AttentionStrip announces politely", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
});

// Without detail there is nothing to disclose, so no <details> wrapper and no
// chevron should appear at all.
test("AttentionStrip without detail renders no disclosure", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /<summary/);
});

// The whole point of the redesign: with detail present the strip is still ONE
// row at rest, because the header row itself is the <summary>. If the detail
// ever renders outside <details>, the strip has silently grown a second row.
test("AttentionStrip with detail puts the header row inside the summary", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip
      tone="accent"
      icon={<svg />}
      count={3}
      detail={<ul><li>ZK-A4-014</li></ul>}
    >
      Device closeout pending
    </AttentionStrip>
  );
  assert.match(html, /<details/);
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.match(summary, /Device closeout pending/);
  assert.match(summary, />3</);
  // the detail is NOT in the summary — it lives after it
  assert.doesNotMatch(summary, /ZK-A4-014/);
  assert.match(html, /ZK-A4-014/);
});

test("AttentionStrip omits the count slot when no count is given", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.doesNotMatch(html, /tabular-nums/);
});

// Role 3 is the one place role="alert" is correct — the user asked for
// something and it did not arrive.
test("FailureBlock announces assertively", () => {
  const html = renderToStaticMarkup(<FailureBlock title="Attendance data didn't load" />);
  assert.match(html, /role="alert"/);
  assert.match(html, /Attendance data didn&#x27;t load/);
});

// A retry button that does nothing is worse than no button, so it only renders
// when a handler is supplied.
test("FailureBlock omits the button when there is no retry handler", () => {
  const html = renderToStaticMarkup(<FailureBlock title="Coverage didn't load" />);
  assert.doesNotMatch(html, /<button/);
});

test("FailureBlock renders a retry button when given a handler", () => {
  const html = renderToStaticMarkup(
    <FailureBlock title="Attendance data didn't load" onRetry={() => {}} />
  );
  assert.match(html, /<button/);
  assert.match(html, /Retry/);
});

test("FailureBlock disables the button while retrying", () => {
  const html = renderToStaticMarkup(
    <FailureBlock title="Attendance data didn't load" onRetry={() => {}} retrying />
  );
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, />Retry</);
});

test("FailureBlock renders a ReactNode cause", () => {
  const html = renderToStaticMarkup(
    <FailureBlock
      title="Attendance data didn't load"
      cause={<><span>Confirm you have HR User access.</span><span>Detail line.</span></>}
    />
  );
  assert.match(html, /Confirm you have HR User access\./);
  assert.match(html, /Detail line\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:web`
Expected: FAIL — `Cannot find module '@/components/ui/notice'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/notice.tsx`:

```tsx
import { ChevronRightIcon, CloudOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Role 2 — attention. The data may be stale or incomplete; you might want to
 * act, but nothing is broken.
 *
 * One line at rest. When `detail` is present the header row itself becomes the
 * <summary>, so disclosing never costs a second row. Native <details> gives
 * keyboard operation and expanded-state announcement for free.
 *
 * role="status" is polite on purpose: stale device data must not interrupt a
 * screen reader mid-sentence.
 */
export function AttentionStrip(props: {
  tone: "amber" | "accent";
  icon: React.ReactNode;
  children: React.ReactNode;
  /** When present, the header row becomes a disclosure toggle. */
  detail?: React.ReactNode;
  /** Right-aligned in the header row. */
  count?: number;
}) {
  const tone =
    props.tone === "amber"
      ? "border-amber-500/25 bg-amber-500/[0.06]"
      : "border-brand-accent/30 bg-brand-accent/[0.05]";

  const head = (
    <>
      <span className="shrink-0">{props.icon}</span>
      <span className="min-w-0 flex-1 text-foreground">{props.children}</span>
      {props.count != null ? (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {props.count}
        </span>
      ) : null}
    </>
  );

  if (!props.detail) {
    return (
      <div
        role="status"
        className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm animate-in fade-in ${tone}`}
      >
        {head}
      </div>
    );
  }

  return (
    <details role="status" className={`group rounded-md border animate-in fade-in ${tone}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-sm">
        {head}
        <ChevronRightIcon
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-border/60 px-3 py-2">{props.detail}</div>
    </details>
  );
}

/**
 * Role 3 — failure. What you asked for did not load.
 *
 * Rendered in the region the missing content would have occupied, and only
 * there: a page that shows both a banner and a replaced region reports one
 * failure twice. role="alert" is correct here.
 */
export function FailureBlock(props: {
  title: string;
  cause?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-[13rem] flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.035] p-8 text-center animate-in fade-in"
    >
      <CloudOffIcon className="size-6 text-destructive/70" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{props.title}</p>
        {props.cause ? <div className="text-sm text-muted-foreground">{props.cause}</div> : null}
      </div>
      {props.onRetry ? (
        <Button variant="outline" size="sm" onClick={props.onRetry} disabled={props.retrying}>
          {props.retrying ? <Spinner className="size-3.5" /> : "Retry"}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:web`
Expected: PASS. `# tests` must read **325** (316 baseline + 9 new). A later fix round added a tenth test, so the running total from Task 2 onward is one higher than 325 + N. If it still reads 316, the file is outside the glob — stop and fix that before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json src/components/ui/notice.tsx src/components/ui/notice.test.tsx
git commit -m "feat(ui): AttentionStrip and FailureBlock notice primitives"
```

---

### Task 2: Device banners become attention strips

**Files:**
- Modify: `src/ui/DeviceAlerts.tsx:8-52`
- Test: `src/ui/deviceAlerts.test.tsx` (create)

**Interfaces:**
- Consumes: `AttentionStrip` from Task 1.
- Produces: no signature change. `DeviceCloseoutBanner({ alerts })` and `DeviceSyncStalenessBanner({ minutesSince })` keep their exact props, so `App.tsx` is untouched by this task.

**Context:** `DeviceCloseoutBanner` currently renders one `<li>` per device *inside* the banner, so a bad day pushes the week grid down by a row per device. That is the defect. `DeviceSyncStalenessBanner` is already close to right and only changes container.

- [ ] **Step 1: Write the failing test**

Create `src/ui/deviceAlerts.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeviceAlert } from "@/types/calendar";

import { DeviceCloseoutBanner, DeviceSyncStalenessBanner } from "./DeviceAlerts";

const ALERTS: DeviceAlert[] = [
  { device_sn: "ZK-A4-014", local_date: "2026-07-29", status: "deferred_offline", last_error: null },
  { device_sn: "ZK-A4-021", local_date: "2026-07-29", status: "closure_failed", last_error: "timeout" },
];

// The banner used to grow a row per device. Now the count carries the volume
// and the rows hide behind the header row, so three bad devices cost the same
// vertical space as one.
test("closeout rows are disclosed, not stacked in the header", () => {
  const html = renderToStaticMarkup(<DeviceCloseoutBanner alerts={ALERTS} />);
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.match(summary, /Device closeout pending/);
  assert.match(summary, />2</);
  assert.doesNotMatch(summary, /ZK-A4-014/);
  assert.match(html, /ZK-A4-014/);
});

test("closeout banner is polite, not assertive", () => {
  const html = renderToStaticMarkup(<DeviceCloseoutBanner alerts={ALERTS} />);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
});

// Staleness has no detail to disclose, so it must stay a plain one-line strip.
test("staleness renders a single line with no disclosure", () => {
  const html = renderToStaticMarkup(<DeviceSyncStalenessBanner minutesSince={300} />);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /Device data may be stale/);
  assert.match(html, /last sync/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:web`
Expected: FAIL — no `<summary>` in the closeout markup (it still renders a `Card` with a `<ul>`).

- [ ] **Step 3: Rewrite the two banners**

In `src/ui/DeviceAlerts.tsx`, replace the `Card`/`CardContent` imports and both component bodies. Leave `DeviceAlertRow` and everything below it untouched.

```tsx
import { formatDeviceAlertStatus } from "@/hooks/useHrAttendanceData";
import { formatBranchLabel, formatDurationMinutes } from "@/lib/attendanceTime";
import type { DeviceAlert } from "@/types/calendar";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";

import { AttentionStrip } from "@/components/ui/notice";

export function DeviceCloseoutBanner({ alerts }: { alerts: DeviceAlert[] }) {
  return (
    <AttentionStrip
      tone="accent"
      count={alerts.length}
      icon={<AlertTriangleIcon className="size-4 text-brand-accent" aria-hidden="true" />}
      detail={
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {alerts.map((alert) => (
            <li key={`${alert.device_sn}-${alert.local_date}`} className="truncate">
              <span className="font-medium text-foreground">{alert.local_date}</span>
              {" · "}
              {alert.device_sn}
              {" · "}
              {formatDeviceAlertStatus(alert.status)}
              {alert.last_error ? ` — ${alert.last_error}` : null}
            </li>
          ))}
        </ul>
      }
    >
      Device closeout pending
    </AttentionStrip>
  );
}

/**
 * Shown when no device punch has arrived for >3h. Surfaces a stalled Bridge
 * before the first UNNOTIFIED_ABSENCE flag appears.
 */
export function DeviceSyncStalenessBanner({ minutesSince }: { minutesSince: number }) {
  const ago = formatDurationMinutes(Math.round(minutesSince));
  return (
    <AttentionStrip
      tone="amber"
      icon={<ClockIcon className="size-4 text-amber-600" aria-hidden="true" />}
    >
      Device data may be stale — last sync <span className="font-medium">{ago}</span> ago
    </AttentionStrip>
  );
}
```

Then check whether `Card`/`CardContent` are still used further down the file (by `DeviceAlertRow`). Keep the import if they are, remove it if not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:web`
Expected: PASS, `# tests` **329** (326 after Task 1's fix round, + 3).

- [ ] **Step 5: Commit**

```bash
git add src/ui/DeviceAlerts.tsx src/ui/deviceAlerts.test.tsx
git commit -m "refactor(ui): device banners use AttentionStrip, closeout rows disclose"
```

---

### Task 3: One failure surface on the attendance page

**Files:**
- Modify: `src/ui/App.tsx:265-296` (delete), `src/ui/App.tsx:354-362` (replace)

**Interfaces:**
- Consumes: `FailureBlock` from Task 1.
- Produces: nothing for later tasks.

**Context and a deliberate behaviour change.** `loadError = employeesError ?? calendarError`
(`App.tsx:192`), but the card in the grid slot keys off `calendarError` alone. So the two surfaces
are not duplicates in every case: an employees-only failure shows the banner and nothing else.

Deleting the banner and leaving the card keyed on `calendarError` would therefore **silently drop
the employees-failed report**. The grid slot is instead keyed on `loadError`. This is correct on
its own terms: if the employee list did not load you cannot select anyone, so the week grid has
nothing to show.

- [ ] **Step 1: Delete the top banner**

Remove the entire `{loadError ? ( … ) : null}` block at `src/ui/App.tsx:265-296` — the `<Alert variant="destructive">` with its inline Retry button, and its two explanatory comments.

- [ ] **Step 2: Replace the grid-slot card**

At `src/ui/App.tsx:354-362`, replace the `calendarError ? <Card …>` branch:

```tsx
                  {loadError ? (
                    <FailureBlock
                      title="Attendance data didn't load"
                      cause={
                        <>
                          {hrStaff
                            ? "Confirm you have HR User access and try again."
                            : "Confirm your user is linked to an active Employee record."}
                          {/* The guidance above is a guess; the server usually knows
                              exactly what went wrong. Without this, a 500 and a bad
                              date range both read as a permission problem and send
                              HR chasing access they already have. */}
                          {loadErrorDetail ? (
                            <span className="mt-1 block text-xs opacity-90">{loadErrorDetail}</span>
                          ) : null}
                        </>
                      }
                      onRetry={() => void refetchPage()}
                      retrying={isRefreshing}
                    />
                  ) : selectedEmployee?.has_shift_assignment === false &&
```

- [ ] **Step 3: Fix the imports**

Add `import { FailureBlock } from "@/components/ui/notice";`.

Then grep the file for remaining uses of `Alert`, `AlertDescription`, `Card`, `CardContent`, `Button` and `Spinner`. `Card`/`CardContent` are still used at `:245-246`, so keep those. Remove the `Alert`/`AlertDescription` import if — and only if — no use remains. Do the same for `Button` and `Spinner`.

Run: `npx tsc --noEmit 2>&1 | grep -v TS5101`
Expected: no new errors. (`TS5101 baseUrl is deprecated` is a pre-existing, accepted baseline — ignore only that code.)

- [ ] **Step 4: Verify the suite and the rendered result**

Run: `npm run test:web`
Expected: PASS, `# tests` still **329** (this task adds no unit tests; the behaviour is covered by e2e).

Then confirm visually that one failure now produces one surface:

```bash
npx playwright test e2e/attendance.spec.ts --project=desktop
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx
git commit -m "fix(attendance): report a load failure once, in the region that failed"
```

---

### Task 4: The schedule header carries its own context

**Files:**
- Modify: `src/ui/WeeklySchedulePage.tsx:354-417`
- Modify: `e2e/schedule-edit.spec.ts:10`

**Interfaces:**
- Consumes: nothing from earlier tasks — Role 1 has no component.
- Produces: nothing for later tasks.

**Context.** `PageHeader`'s `description` prop is typed `React.ReactNode`
(`@lolbikb/dewey-ui` `index.d.ts:507-512`) and the page already passes one, so the editing notice
costs **no extra height**: the line simply says the more useful thing while editing.

The ineligible `Alert` is deleted outright. When an employee is ineligible `scheduleEmployeeId` is
`null` (`:114-118`), so the page already renders `EmptyState` with `title="Employee not eligible"`
and the same message as its description — the banner stated it a second time, above.
`weeklyScheduleIneligibleMessage` stays; `EmptyState` still calls it.

- [ ] **Step 1: Compute the description**

Immediately before the `return (` at `src/ui/WeeklySchedulePage.tsx:354`, add:

```tsx
  // PageHeader.description is a ReactNode and the page always renders one, so
  // the editing notice costs no extra height — it replaces the generic line
  // rather than adding a row. The effective date is deliberately absent: the
  // "Effective from" picker below owns it, and formats it properly.
  const headerDescription =
    isEditing && scheduleEmployeeId && !ineligibleMessage ? (
      <span className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <PencilLineIcon className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Editing {employeeLabel ?? "this employee"}&rsquo;s existing schedule — changes apply from
          the effective date.
        </span>
      </span>
    ) : (
      "Configure shared shift patterns for an employee."
    );
```

Add `PencilLineIcon` to the existing `lucide-react` import.

- [ ] **Step 2: Use it, and delete both banners**

Change the `PageHeader` prop at `:359`:

```tsx
          description={headerDescription}
```

Then delete both `Alert` blocks — `:398-404` (ineligible) and `:406-416` (editing) — leaving the
`</PageHeader>` and the actions `<div>` above them intact.

Keep the `Alert`/`AlertDescription` import: it is still used by the confirm modal at `:707`.

- [ ] **Step 3: Update the e2e assertion**

In `e2e/schedule-edit.spec.ts:10`:

```ts
    await expect(page.getByText(/Editing Jane Doe.s existing schedule/)).toBeVisible();
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v TS5101`
Expected: no new errors.

Run: `npm run test:web`
Expected: PASS, `# tests` **329** (this task adds no unit tests).

Run: `npx playwright test e2e/schedule-edit.spec.ts e2e/schedule.spec.ts --project=desktop`
Expected: PASS. Both reconcile-review assertions in `schedule-edit.spec.ts` must still pass — the confirm modal is untouched, and it is where the accurate warning lives.

- [ ] **Step 5: Commit**

```bash
git add src/ui/WeeklySchedulePage.tsx e2e/schedule-edit.spec.ts
git commit -m "fix(schedule): editing context moves into the header, ineligible duplicate deleted"
```

---

### Task 5: The remaining failure surfaces, and a guard

**Files:**
- Modify: `src/ui/schedule-coverage/ScheduleCoveragePage.tsx:101-104`
- Modify: `src/ui/schedule-import/UploadStep.tsx:116-120`
- Modify: `src/components/ui/notice.test.tsx` (append the guard)

**Interfaces:**
- Consumes: `FailureBlock` from Task 1.
- Produces: nothing.

**Context.** `useScheduleCoverage()` returns `{ unassigned, buckets, counts, isLoading, error }`
(`ScheduleCoveragePage.tsx:18`) — **no refetch**, so `FailureBlock` renders without `onRetry` and
the cause keeps the current instruction. Exposing a refetch is a worthwhile but separate change,
excluded so this lands as presentation only.

`UploadStep` is the stated exception to the Role 3 rule: the drop zone is the affordance you retry
*with*, so a block that replaces the content region would remove the way out. It stays inline and
only its tokens change.

- [ ] **Step 1: Write the failing guard test**

Add these two imports to the **existing import block** at the top of
`src/components/ui/notice.test.tsx` (not mid-file):

```tsx
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
```

Then append the constant and the test at the end of the file:

```tsx
// Resolve from this file, never the CWD — a repo-relative path passes locally
// and fails wherever the runner starts somewhere else.
const SRC = fileURLToPath(new URL("../../", import.meta.url));

// These three pages reported persistent conditions through <Alert>, whose root
// hardcodes role="alert" — an assertive live region that interrupts a screen
// reader. After the migration none of them should reach for it again.
test("migrated pages no longer import the Alert primitive", () => {
  for (const rel of [
    "ui/App.tsx",
    "ui/DeviceAlerts.tsx",
    "ui/schedule-coverage/ScheduleCoveragePage.tsx",
  ]) {
    const source = readFileSync(SRC + rel, "utf8");
    assert.doesNotMatch(
      source,
      /from "@\/components\/ui\/alert"/,
      `${rel} still imports Alert — use AttentionStrip or FailureBlock`
    );
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web`
Expected: FAIL — `ScheduleCoveragePage.tsx still imports Alert`. (`App.tsx` and `DeviceAlerts.tsx` were already cleared in Tasks 2 and 3; if either still fails here, its import cleanup was missed.)

- [ ] **Step 3: Convert the coverage error**

In `src/ui/schedule-coverage/ScheduleCoveragePage.tsx`, replace the `error ?` branch at `:101-104`:

```tsx
            ) : error ? (
              <FailureBlock title="Coverage didn't load" cause="Try refreshing the page." />
```

Add `import { FailureBlock } from "@/components/ui/notice";` and remove the
`@/components/ui/alert` import (verify no other use remains in the file first).

- [ ] **Step 4: Align the upload parse-error tokens**

In `src/ui/schedule-import/UploadStep.tsx:116-120`, change only the container classes so the
family reads as one system. The element, its placement and its text are unchanged:

```tsx
      {props.parseError ? (
        <p className="rounded-lg border border-destructive/25 bg-destructive/[0.035] px-3 py-2 text-sm text-destructive">
          {props.parseError}
        </p>
      ) : null}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit 2>&1 | grep -v TS5101`
Expected: no new errors.

Run: `npm run test:web`
Expected: PASS, `# tests` **330** (329 + 1).

Run: `npx playwright test e2e/coverage.spec.ts --project=desktop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/schedule-coverage/ScheduleCoveragePage.tsx src/ui/schedule-import/UploadStep.tsx src/components/ui/notice.test.tsx
git commit -m "refactor(ui): coverage failure uses FailureBlock, import error tokens aligned"
```

---

### Task 6: Rebuild and commit the bundle

**Files:**
- Modify: `dewey_time/public/hr_attendance/**` (generated)
- Modify: `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html` (generated)

**Interfaces:** none.

**Context.** The built assets are the deployed artifact. Frappe Cloud never builds this SPA — it
cannot, because `@lolbikb/dewey-ui` is private and a fresh `npm install` returns 401 without
`NODE_AUTH_TOKEN`. Whatever bundle is committed is what users get. Assets went un-rebuilt from #58
through #74 — four PRs of frontend work, none of it live. **The build output is a deliverable, not
a verification artifact.**

- [ ] **Step 1: Run the full suite one last time**

Run: `npm run test:web`
Expected: PASS, `# tests` **330**.

Run: `npx playwright test --project=desktop`
Expected: PASS.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: completes without error, writing `dewey_time/public/hr_attendance/`.

- [ ] **Step 3: Confirm the bundle actually contains the change**

The new copy must appear in the built JS. Run from the repo root:

```bash
grep -rl "existing schedule" dewey_time/public/hr_attendance/assets/ | head
```
Expected: at least one file. An empty result means the build did not pick up the change — do not commit, investigate first.

- [ ] **Step 4: Commit the bundle**

```bash
git add dewey_time/public/hr_attendance dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html
git commit -m "build(hr-attendance): rebuild bundle with the notice system"
```

---

## Verification checklist

- [ ] `npm run test:web` reports **330** passing, 0 failing.
- [ ] `npx playwright test` passes on both projects.
- [ ] `npx tsc --noEmit` shows no errors other than the pre-existing `TS5101`.
- [ ] No `role="alert"` outside `components/ui/alert.tsx` and `components/ui/notice.tsx`.
- [ ] A calendar failure renders exactly one surface.
- [ ] The schedule header shows no banner while editing, and the editor's first shift block is
      visible without scrolling on a 375×812 viewport.
- [ ] `dewey_time/public/hr_attendance/**` is committed and contains the new copy.
