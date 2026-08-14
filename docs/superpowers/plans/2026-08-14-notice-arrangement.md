# Notice Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the notice stack off `/hr-flags` and `/hr-attendance` — one chip in each page's existing toolbar row holding a popover, the truncation fact moved to the last row of the queue list, everything else deleted.

**Architecture:** Two pure builders in `src/lib/dataHealth.ts` turn page counts into an ordered `HealthCondition[]`. A presentational `DataHealthButton` renders the leading condition plus `+N` and opens a popover whose body its caller supplies — so `/hr-flags` hands it the outage panel and `/hr-attendance` hands it the sync and closeout detail. `OutageBand` sheds its band chrome and becomes that popover body. `FlagQueueList` grows one optional prop for the terminal cap row.

**Tech Stack:** React 19, TypeScript, Tailwind v4.3, Radix Popover via `@lolbikb/dewey-ui`, `node:test` + `tsx` for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-14-notice-arrangement-design.md`

## Global Constraints

- All commands run from `/Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance` unless a step says otherwise. **Always `cd` with an absolute path in the same command as the thing you are running** — `cd` is intercepted by zoxide on this machine and a bare relative `cd` has run npm scripts in the wrong package and reported a false green.
- Python, where needed, is `python3`. There is no `python` on this machine.
- **There is no `tone` field on `HealthCondition`.** Everything that reaches the chip means "something is wrong right now"; that is the entry criterion, not a property graded afterwards. Do not add one back.
- The chip is **not rendered at all** when its condition list is empty — never present-and-empty.
- Do **not** modify any backend file, or the shape of `orphans` in the API response. The orphan counts stop being *rendered*; they keep arriving.
- Do **not** make the `Clear*` dialogs or any dev-only control available in production.
- **Do not run `npm run build` or commit `dewey_time/public/**` or `dewey_time/www/**` in tasks 1-7.** Bundles are rebuilt once at branch close; these filenames are fixed, not content-hashed, so a bundle commit per task guarantees conflicts.
- `npm run test:web` runs a glob and exits 0 when it matches nothing. **Report the actual test count** before and after, not just the exit code.
- Every task ends green on `npm run typecheck` and `npm run test:web`.
- Baseline before Task 1: **web unit 1024 pass / 0 fail**, typecheck clean.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/dataHealth.ts` | `HealthCondition`, `flagQueueHealth()`, `attendanceHealth()` — the conditions as pure data | 1 |
| `src/lib/dataHealth.test.ts` | Tests for both builders | 1 |
| `src/ui/DataHealthButton.tsx` | The chip and its popover. Knows nothing about flags or attendance | 2 |
| `src/ui/dataHealthButton.test.tsx` | Rendering tests | 2 |
| `src/ui/OutageExcusePanel.tsx` | Was `OutageBand.tsx`. The popover body for outages | 3 |
| `src/ui/outageExcusePanel.test.tsx` | Was `outageBand.test.tsx` | 3 |
| `src/ui/FlagQueueList.tsx` | Grows `truncatedTo` and the terminal row | 4 |
| `src/lib/flagQueueLabels.ts` | Gains `queueEndTruncatedNotice`; loses seven exports | 4, 5 |
| `src/ui/FlagQueuePage.tsx` | Delete the stack, mount the chip | 5 |
| `src/ui/DeviceAlerts.tsx` | Banners become popover body content | 6 |
| `src/ui/AttendanceToolbar.tsx` | Hosts the attendance chip | 6 |
| `src/ui/App.tsx` | Stops rendering banners inside `Section grow` | 6 |
| `e2e/notice-arrangement.spec.ts` | The zero-vertical-cost claim, measured | 7 |

Task order is deliberate: the cap gets its **new** home (Task 4) before its old one is deleted (Task 5), so the fact is never absent from the page between commits.

---

## Task 1: The conditions as pure data

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/dataHealth.ts`
- Create: `dewey_time/frontend/hr_attendance/src/lib/dataHealth.test.ts`

**Interfaces:**
- Consumes: `formatDurationMinutes` from `@/lib/attendanceTime` (signature: `(totalMinutes: number | null | undefined, options?: { signed?: boolean }) => string`; returns `"22h 3m"`, `"3d 4h"`, `"45m"`, or `"—"` for null).
- Produces, consumed by Tasks 2, 5 and 6:
  - `export type HealthCondition = { key: string; summary: string; short: string }`
  - `export function flagQueueHealth(input: { outageBranches: number; closeoutAlerts: number }): HealthCondition[]`
  - `export function attendanceHealth(input: { staleSyncMinutes: number | null; closeoutAlerts: number }): HealthCondition[]`

> **Deviation from the spec, deliberate:** the spec's `flagQueueHealth` signature also lists `outagePeople: number`. Nothing in the chip's label uses it — the people count belongs to the popover header, which `OutageExcusePanel` already computes for itself via `queuePeopleCount`. An unused parameter is a parameter that will drift. It is dropped.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dataHealth.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { attendanceHealth, flagQueueHealth } from "@/lib/dataHealth";

test("a healthy page produces no conditions at all", () => {
  // This is what makes the chip absent rather than present-and-empty. A chip
  // reading "0 problems" is a permanent fixture that teaches people to ignore
  // the spot it occupies.
  assert.deepEqual(flagQueueHealth({ outageBranches: 0, closeoutAlerts: 0 }), []);
  assert.deepEqual(attendanceHealth({ staleSyncMinutes: null, closeoutAlerts: 0 }), []);
});

test("the flag queue leads with outages and counts closeouts behind them", () => {
  const both = flagQueueHealth({ outageBranches: 13, closeoutAlerts: 2 });
  assert.equal(both.length, 2);
  assert.equal(both[0]!.key, "outage");
  assert.equal(both[0]!.summary, "13 branches offline");
  assert.equal(both[0]!.short, "13");
  assert.equal(both[1]!.key, "closeout");
  assert.equal(both[1]!.summary, "2 device closeouts pending");
});

test("each condition appears only when its own count is non-zero", () => {
  const outageOnly = flagQueueHealth({ outageBranches: 4, closeoutAlerts: 0 });
  assert.deepEqual(outageOnly.map((c) => c.key), ["outage"]);

  const closeoutOnly = flagQueueHealth({ outageBranches: 0, closeoutAlerts: 3 });
  assert.deepEqual(closeoutOnly.map((c) => c.key), ["closeout"]);
});

test("one of a thing reads as one of a thing", () => {
  const [outage] = flagQueueHealth({ outageBranches: 1, closeoutAlerts: 0 });
  assert.equal(outage!.summary, "1 branch offline");

  const [closeout] = flagQueueHealth({ outageBranches: 0, closeoutAlerts: 1 });
  assert.equal(closeout!.summary, "1 device closeout pending");
});

test("four-figure counts are grouped, because these are read at a glance", () => {
  const [outage] = flagQueueHealth({ outageBranches: 1005, closeoutAlerts: 0 });
  assert.equal(outage!.summary, "1,005 branches offline");
  assert.equal(outage!.short, "1,005");
});

test("stale sync says the full age, and the short form keeps only its leading unit", () => {
  // 22h 3m — the real figure from the page this replaces. The short form is
  // what a 375px row gets, where the label is the first thing to go.
  const [stale] = attendanceHealth({ staleSyncMinutes: 1323, closeoutAlerts: 0 });
  assert.equal(stale!.key, "stale-sync");
  assert.equal(stale!.summary, "Last sync 22h 3m ago");
  assert.equal(stale!.short, "22h");
});

test("the short age never loses its unit, whatever the magnitude", () => {
  // Derived from formatDurationMinutes rather than re-deriving days/hours, so
  // the two can never disagree about a boundary.
  assert.equal(attendanceHealth({ staleSyncMinutes: 45, closeoutAlerts: 0 })[0]!.short, "45m");
  assert.equal(attendanceHealth({ staleSyncMinutes: 4560, closeoutAlerts: 0 })[0]!.short, "3d");
  assert.equal(attendanceHealth({ staleSyncMinutes: 120, closeoutAlerts: 0 })[0]!.short, "2h");
});

test("zero minutes since sync is still a condition, not a missing one", () => {
  // `null` means "no sync timestamp to judge"; 0 means "synced this minute",
  // which the caller only passes when it has already decided the page is
  // stale. A falsy check here would silently drop it.
  const conditions = attendanceHealth({ staleSyncMinutes: 0, closeoutAlerts: 0 });
  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]!.summary, "Last sync 0m ago");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/lib/dataHealth.test.ts
```

Expected: FAIL at import — `@/lib/dataHealth` does not exist.

- [ ] **Step 3: Write the module**

Create `src/lib/dataHealth.ts`:

```ts
import { formatDurationMinutes } from "@/lib/attendanceTime";

/**
 * One thing that is wrong with the data behind a page, right now.
 *
 * Everything reaching this type is amber by construction — "something is wrong
 * right now" IS the entry criterion, so there is no `tone` field to grade it
 * with afterwards. Facts that are merely true about the data do not become
 * conditions: the flag queue's cap is rendered at the end of the list where it
 * is finally relevant, and the orphaned-decision counts are not rendered at
 * all.
 *
 * `detail` is deliberately absent. A ReactNode field would drag JSX into
 * src/lib and make these builders untestable as plain data; DataHealthButton's
 * caller composes the popover body instead.
 */
export type HealthCondition = {
  /** Stable React key and test handle. */
  key: string;
  /** Terse form — the chip's label when this condition leads. */
  summary: string;
  /** Shorter still, for viewports below sm. Usually a bare count. */
  short: string;
};

/** Local rather than imported from flagQueueLabels: that module is
 *  flag-specific, and this one serves the attendance page too. Three lines
 *  beats a dependency that points the wrong way. */
function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * The leading unit of an age — "22h" from "22h 3m", "3d" from "3d 4h".
 *
 * Built by taking formatDurationMinutes apart rather than re-deriving
 * days/hours/minutes, so the two can never disagree about a boundary.
 */
function coarseAge(minutes: number): string {
  return formatDurationMinutes(minutes).split(" ")[0] ?? "—";
}

function closeoutCondition(count: number): HealthCondition {
  return {
    key: "closeout",
    summary: `${plural(count, "device closeout", "device closeouts")} pending`,
    short: count.toLocaleString("en-US"),
  };
}

/** `/hr-flags`. Outages lead — they are the only condition with an action
 *  behind them, so they are the one worth spending the chip's label on. */
export function flagQueueHealth(input: {
  outageBranches: number;
  closeoutAlerts: number;
}): HealthCondition[] {
  const conditions: HealthCondition[] = [];
  if (input.outageBranches > 0) {
    conditions.push({
      key: "outage",
      summary: `${plural(input.outageBranches, "branch", "branches")} offline`,
      short: input.outageBranches.toLocaleString("en-US"),
    });
  }
  if (input.closeoutAlerts > 0) conditions.push(closeoutCondition(input.closeoutAlerts));
  return conditions;
}

/** `/hr-attendance`. `staleSyncMinutes` is null when there is no staleness to
 *  report — NOT 0, which is a real age the caller has already judged stale. */
export function attendanceHealth(input: {
  staleSyncMinutes: number | null;
  closeoutAlerts: number;
}): HealthCondition[] {
  const conditions: HealthCondition[] = [];
  if (input.staleSyncMinutes != null) {
    conditions.push({
      key: "stale-sync",
      summary: `Last sync ${formatDurationMinutes(input.staleSyncMinutes)} ago`,
      short: coarseAge(input.staleSyncMinutes),
    });
  }
  if (input.closeoutAlerts > 0) conditions.push(closeoutCondition(input.closeoutAlerts));
  return conditions;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; count up by 8 from the 1024 baseline (1032); 0 failures. Record both counts.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/src/lib/dataHealth.ts dewey_time/frontend/hr_attendance/src/lib/dataHealth.test.ts
git commit -m "feat(notices): the data-health conditions as pure data

Two builders over page counts, no tone field: everything that reaches the
chip means something is wrong right now, which is the entry criterion rather
than a property to grade afterwards. Both return [] when there is nothing to
report, which is what makes the chip absent rather than present-and-empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The chip and its popover

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/DataHealthButton.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/dataHealthButton.test.tsx`

**Interfaces:**
- Consumes: `HealthCondition` from Task 1. `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover` (a re-export shim over `@lolbikb/dewey-ui`).
- Produces, consumed by Tasks 5 and 6:
  - `export function DataHealthButton(props: { conditions: HealthCondition[]; children: ReactNode; className?: string }): ReactElement | null`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/dataHealthButton.test.tsx`. Assert against `renderToStaticMarkup`, the convention this codebase uses for presentational components.

**Radix portals server-render to `null`**, so the popover *content* is unreachable here — that is asserted end-to-end in Task 7 instead. These tests cover the trigger, which is the part with the conditional logic.

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { HealthCondition } from "@/lib/dataHealth";
import { DataHealthButton } from "@/ui/DataHealthButton";

const OUTAGE: HealthCondition = { key: "outage", summary: "13 branches offline", short: "13" };
const CLOSEOUT: HealthCondition = { key: "closeout", summary: "2 device closeouts pending", short: "2" };

function render(conditions: HealthCondition[]): string {
  return renderToStaticMarkup(
    <DataHealthButton conditions={conditions}>
      <p>detail</p>
    </DataHealthButton>,
  );
}

test("no conditions renders nothing — not an empty chip", () => {
  // The toolbar on a healthy day must look exactly as it did before this
  // component existed. An empty chip is a permanent fixture in a row that has
  // no space to spare.
  assert.equal(render([]), "");
});

test("the leading condition is the label", () => {
  const html = render([OUTAGE]);
  assert.match(html, /13 branches offline/);
});

test("the rest become a count, not a second label", () => {
  const html = render([OUTAGE, CLOSEOUT]);
  assert.match(html, /\+1/);
  // The second condition's own words stay in the popover, which this render
  // cannot reach — what matters here is that they do NOT reach the row.
  assert.doesNotMatch(html, /device closeouts pending/);
});

test("a lone condition gets no +0", () => {
  assert.doesNotMatch(render([OUTAGE]), /\+0/);
});

test("the short form is present for narrow rows, and the full one for readers", () => {
  // Below sm the visible label is the bare count; the full sentence stays in
  // the accessibility tree via sr-only so the button is never named "13".
  const html = render([OUTAGE]);
  assert.match(html, /sm:hidden/, "expected a narrow-viewport variant");
  assert.match(html, /sr-only/, "expected the full summary to survive for screen readers");
});

test("the trigger is a real button", () => {
  // It opens a popover and must be reachable by keyboard. A div with onClick
  // is not, and Radix's asChild will happily wrap whatever it is given.
  assert.match(render([OUTAGE]), /<button/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/dataHealthButton.test.tsx
```

Expected: FAIL at import — `@/ui/DataHealthButton` does not exist.

- [ ] **Step 3: Write the component**

Create `src/ui/DataHealthButton.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { HealthCondition } from "@/lib/dataHealth";
import { cn } from "@/lib/utils";

/**
 * Everything a page knows about its own data health, behind one button in a
 * row that already exists.
 *
 * The point is the vertical cost: `/hr-flags` and `/hr-attendance` both put
 * `Section grow` (min-h-0 flex-1, flex-basis 0) under their chrome, so the
 * queue and the calendar are only ever handed positive free space and every
 * pixel above them is a pixel those regions never get. A chip at the height of
 * its neighbours costs nothing, and a popover displaces no layout at all.
 *
 * Knows nothing about flags or attendance — the caller supplies the body, so
 * one page hands it the outage panel and the other hands it sync detail.
 */
export function DataHealthButton(props: {
  conditions: HealthCondition[];
  /** Popover body. Composed by the caller; see the type's doc comment. */
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const [lead, ...rest] = props.conditions;
  // Absent, not present-and-empty. Hook order is unaffected: useState above
  // runs on every render regardless of which branch follows it.
  if (!lead) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-500/25",
            "bg-amber-500/[0.06] px-2.5 text-sm text-foreground transition-colors",
            "hover:bg-amber-500/[0.12] focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring/50",
            props.className,
          )}
        >
          <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
          {/* Two visible spellings and one invisible one. Below sm the label is
              the first thing to go, because the popover is one tap away — but
              `hidden` is display:none, which removes the full sentence from the
              accessibility tree too, and a button named "13" says nothing. The
              sr-only copy carries it at exactly the widths the visible one is
              gone. */}
          <span className="hidden sm:inline">{lead.summary}</span>
          <span className="tabular-nums sm:hidden" aria-hidden="true">
            {lead.short}
          </span>
          <span className="sr-only sm:hidden">{lead.summary}</span>
          {rest.length > 0 ? (
            <span className="border-l border-amber-500/25 pl-2 text-xs tabular-nums text-muted-foreground">
              +{rest.length}
            </span>
          ) : null}
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(30rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

Expected: typecheck clean; count up by 6 from Task 1's total (1038); 0 failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/src/ui/DataHealthButton.tsx dewey_time/frontend/hr_attendance/src/ui/dataHealthButton.test.tsx
git commit -m "feat(notices): the data-health chip

One button at the height of its neighbours, so it costs no vertical space in
a row that already exists, and a popover, which displaces no layout at all.
Renders null for an empty condition list rather than an empty chip.

Below sm the visible label drops to a bare count and an sr-only copy carries
the sentence, because display:none takes the label out of the accessibility
tree too and a button named '13' says nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `OutageBand` becomes `OutageExcusePanel`

The band sheds its own section frame, headline row, Review toggle and `open` state — the popover owns disclosure now. **Everything functional survives:** the per-branch checkboxes, `outageWrite`, the day spans, the flag counts, the Device health link and the Excuse button.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/OutageExcusePanel.tsx` (from `src/ui/OutageBand.tsx`)
- Delete: `dewey_time/frontend/hr_attendance/src/ui/OutageBand.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/outageExcusePanel.test.tsx` (from `src/ui/outageBand.test.tsx`)
- Delete: `dewey_time/frontend/hr_attendance/src/ui/outageBand.test.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts` — remove `outageReviewLabel`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces, consumed by Task 5:
  - `export type OutageExcusePanelProps = { outages: OutageGroup[]; excludedBranches: ReadonlySet<string>; onToggleBranch: (groupKey: string) => void; onExcuse: (identities: string[]) => void; submitting?: boolean }`
  - `export function OutageExcusePanel(props: OutageExcusePanelProps): ReactElement | null`

Note what leaves the props: **`defaultOpen` is gone.** It existed only because `renderToStaticMarkup` cannot click and the expanded assertions had no other route to that state. With disclosure owned by the popover, the panel body is always rendered when the panel is, so tests reach it by rendering the panel directly.

- [ ] **Step 1: Port the test file**

`git mv src/ui/outageBand.test.tsx src/ui/outageExcusePanel.test.tsx`, then in the new file:

1. Change the import to `import { OutageExcusePanel } from "@/ui/OutageExcusePanel";` and rename every `<OutageBand` to `<OutageExcusePanel`.
2. **Delete every `defaultOpen` prop** — the branch list is now unconditional.
3. Delete any test asserting the collapsed state or the Review toggle. Those assert a disclosure that no longer exists in this component; the popover's own open/closed behaviour is covered end-to-end in Task 7.
4. `outageBand.test.tsx:93` and `:95` assert `/2 branches had no device data/` and `/nobody is being judged here/`. **Both must still pass** — that copy moves into the panel's header unchanged, and "nobody is being judged here" is the whole reason the outage was lifted out of the judgment queue.

Then add one test pinning what the rename is for:

```tsx
test("the panel is a popover body, not a band — no frame of its own", () => {
  // It used to be a bordered amber <section> sitting above the queue at all
  // times. Inside a popover that frame would be a second border around a
  // surface that already has one.
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <OutageExcusePanel
        outages={OUTAGES}
        excludedBranches={new Set()}
        onToggleBranch={() => {}}
        onExcuse={() => {}}
      />
    </MemoryRouter>,
  );
  assert.doesNotMatch(html, /<section/);
  assert.doesNotMatch(html, /rounded-md border border-amber/);
  // …and the work still survives the move.
  assert.match(html, /type="checkbox"|role="checkbox"/, "per-branch selection");
  assert.match(html, /href="\/hr-attendance"/, "the Device health link");
});
```

> `MemoryRouter` is required — the panel renders a `<Link>`, which throws outside a router. The existing test file already wraps for this reason; keep the wrapper.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/outageExcusePanel.test.tsx
```

Expected: FAIL at import — `@/ui/OutageExcusePanel` does not exist.

- [ ] **Step 3: Port the component**

`git mv src/ui/OutageBand.tsx src/ui/OutageExcusePanel.tsx`. Rename `OutageBandProps` → `OutageExcusePanelProps` and `OutageBand` → `OutageExcusePanel`. Then:

Replace the file's header comment's second paragraph (the one beginning "NOT an `AttentionStrip`") with:

```
 * NOT a band any more. It was a bordered amber <section> pinned above the
 * queue on every load — thirteen branches of prose to surface one occasionally
 * used action. It is now the body of the toolbar's data-health popover, which
 * displaces no layout, and the chip that opens it is only rendered when
 * devices are actually down.
```

Remove `useState` from the React import, remove `ChevronRightIcon` from the lucide import, and remove `outageReviewLabel` from the `@/lib/flagQueueLabels` import.

Delete `defaultOpen` from the props type, and delete these two lines with their comment block:

```tsx
  const [open, setOpen] = useState(props.defaultOpen ?? false);
```

Replace the whole `return (…)` body with:

```tsx
  return (
    <div aria-label={OUTAGE_BAND_LABEL}>
      <div className="flex items-start gap-2.5 border-b border-border px-3 py-2.5">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0">
          {/* queuePeopleCount, NOT coveredEmployeeCount. This parameter is
              "everyone the outage touched" and its docstring forbids the
              covered count by name: covered counts only members with an
              undecided flag, so it equals the button's number on load (making
              the word "affected" do nothing) and falls to "0 people affected"
              once the outage is excused — a false statement of history. */}
          <div className="text-sm font-medium text-foreground">
            {outageBandHeadline(props.outages.length, queuePeopleCount(props.outages))}
          </div>
          <div className="text-xs text-muted-foreground">
            {outageBandSubline(spanOf(props.outages), outageFlagCount(props.outages))}
          </div>
        </div>
      </div>

      {/* Bounded on purpose. Thirteen branches is today's real count, and an
          unbounded list would make the popover taller than the viewport. */}
      <ul className="max-h-[13rem] space-y-0.5 overflow-y-auto overscroll-contain px-3 py-2">
        {props.outages.map((group) => {
          const included = !props.excludedBranches.has(group.group_key);
          const branch = group.branch ?? UNKNOWN_BRANCH_LABEL;
          return (
            <li key={group.group_key}>
              {/* The whole row is the hit target. A bare size-4 checkbox is
                  16px, under WCAG 2.2 SC 2.5.8's 24px floor, and thirteen of
                  them in a scroller is the strongest mis-click surface here —
                  a missed toggle silently changes what the button below
                  writes, with no second confirmation inside this component. */}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 hover:bg-muted",
                  !included && "opacity-50",
                )}
              >
                <Checkbox
                  checked={included}
                  onCheckedChange={() => props.onToggleBranch(group.group_key)}
                  aria-label={outageBranchCheckboxLabel(branch)}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {branch}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {outageBranchDays(group.day_count)}
                </span>
                <span className="w-40 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {outageBranchSummary(queuePeopleCount([group]), outageFlagCount([group]))}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {OUTAGE_CEILING_NOTE}{" "}
          {/* <Link>, not <a>: /hr-attendance is a client route (main.tsx:27),
              and a bare anchor forces a full document reload that throws away
              the queue's in-flight state. */}
          <Link
            to="/hr-attendance"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {DEVICE_HEALTH_LABEL}
          </Link>
        </p>
        <Button
          size="sm"
          className="shrink-0"
          disabled={nothingToWrite || props.submitting}
          onClick={() => props.onExcuse(write.identities)}
        >
          {props.submitting
            ? OUTAGE_EXCUSING_LABEL
            : outageExcuseLabel(
                write.coveredEmployeeCount,
                write.identities.length,
                write.branchCount,
              )}
        </Button>
      </div>
    </div>
  );
```

The `hover:bg-amber-500/10` on the branch row becomes `hover:bg-muted`: inside a neutral popover there is no amber ground for an amber hover to sit on.

- [ ] **Step 4: Remove the now-unused label**

In `src/lib/flagQueueLabels.ts`, delete `outageReviewLabel` and its doc comment. Then confirm nothing else references it:

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && grep -rn "outageReviewLabel\|OutageBand" src e2e || echo "clean — no references remain"
```

Expected: `clean — no references remain`. If `OutageBand` still appears in `src/ui/FlagQueuePage.tsx`, that is Task 5's job — leave it and note it; this task must still typecheck, so update the import and JSX name at the existing mount site (`FlagQueuePage.tsx:1109`) to `OutageExcusePanel` without otherwise changing that block.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
```

Expected: typecheck clean; the count moves by however many collapsed-state tests were dropped in Step 1 minus the one added — **report the exact before/after and name each deleted test**, since this is the one task in the plan that removes coverage. 0 failures.

`e2e/flags.spec.ts:276` asserts `/1 branch had no device data/` inside the band. It will still find that text — the band is still on the page at this point in the plan; Task 5 is what moves it behind the chip.

- [ ] **Step 6: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "refactor(notices): OutageBand becomes OutageExcusePanel

It sheds the bordered amber section, the headline row's Review toggle and its
own open state — the popover it is about to live in owns disclosure. Every
functional part survives the move: the per-branch checkboxes, outageWrite, the
day spans, the flag counts, the Device health link and Excuse.

defaultOpen goes with the state. It was a test seam for renderToStaticMarkup,
which cannot click; the body is now always rendered when the panel is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The cap becomes the last row of the queue

The cap gets its new home **before** Task 5 deletes the old one, so the fact is never absent from the page between commits.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx` (the `<FlagQueueList` mount site only, around line 761)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: `dateSpanLabel(dates: string[]): string` from `@/lib/flagQueueLabels` — already exported at line 121, returns `"4 Aug – 14 Aug"` and `""` for an empty array.
- Produces, consumed by Task 5:
  - `export function queueEndTruncatedNotice(shown: number, startDate: string, endDate: string): string`
  - `FlagQueueListProps` gains `truncatedTo?: number | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/flagQueuePage.test.tsx`. It already imports `FlagQueueList` and builds queue entries; reuse whatever fixture the existing `FlagQueueList` tests in that file use rather than inventing a second one.

```tsx
test("a capped list says so at its end, where you have just run out of rows", () => {
  // Not above the list. A line reading "newest 3,445" at the top is a fact
  // read before there is any use for it; at the bottom it arrives exactly when
  // someone has worked to the end and is about to conclude the period is
  // clear, which is the only moment it changes what they do.
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <FlagQueueList
        entries={QUEUE_ENTRIES}
        range={{ startDate: "2026-08-04", endDate: "2026-08-14" }}
        outage={new Set()}
        selectedKey={null}
        expandedGroupKey={null}
        onSelect={() => {}}
        truncatedTo={3445}
      />
    </MemoryRouter>,
  );
  assert.match(html, /End of the newest 3,445 flags/);
  assert.match(html, /4 Aug – 14 Aug/);
  assert.match(html, /narrow the dates to reach them/);
});

test("the notice is the LAST thing in the list, not the first", () => {
  // Position is the entire point of this change. A test that only checks the
  // text is present would pass with it rendered above every row.
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <FlagQueueList
        entries={QUEUE_ENTRIES}
        range={{ startDate: "2026-08-04", endDate: "2026-08-14" }}
        outage={new Set()}
        selectedKey={null}
        expandedGroupKey={null}
        onSelect={() => {}}
        truncatedTo={3445}
      />
    </MemoryRouter>,
  );
  const notice = html.indexOf("End of the newest");
  const lastRowEnd = html.lastIndexOf("</button>");
  assert.ok(notice > 0, "expected the notice to render");
  assert.ok(notice > lastRowEnd, "the notice must follow the final row");
});

test("an uncapped list ends without a word about it", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <FlagQueueList
        entries={QUEUE_ENTRIES}
        range={{ startDate: "2026-08-04", endDate: "2026-08-14" }}
        outage={new Set()}
        selectedKey={null}
        expandedGroupKey={null}
        onSelect={() => {}}
      />
    </MemoryRouter>,
  );
  assert.doesNotMatch(html, /End of the newest/);
});

test("the notice is not counted as an item of the list", () => {
  // Every selectable row carries aria-setsize/aria-posinset. ARIA wants that
  // metadata all-or-none across a set, so a bare listitem here would be
  // counted by assistive tech while the authored setsize said otherwise —
  // the same reason the "show as group" caption leaves the set.
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <FlagQueueList
        entries={QUEUE_ENTRIES}
        range={{ startDate: "2026-08-04", endDate: "2026-08-14" }}
        outage={new Set()}
        selectedKey={null}
        expandedGroupKey={null}
        onSelect={() => {}}
        truncatedTo={3445}
      />
    </MemoryRouter>,
  );
  const tail = html.slice(html.indexOf("End of the newest") - 400);
  assert.match(tail, /role="presentation"/);
});
```

Also append, to `src/lib/flagQueueLabels.test.ts` (or wherever `dateSpanLabel` is tested — find it with `grep -rn "dateSpanLabel" src --include=*.test.*`):

```ts
test("the end-of-list notice names the count, the range and the lever", () => {
  assert.equal(
    queueEndTruncatedNotice(3445, "2026-08-04", "2026-08-14"),
    "End of the newest 3,445 flags. Older days in 4 Aug – 14 Aug aren't loaded — narrow the dates to reach them.",
  );
});

test("one flag is one flag", () => {
  assert.match(queueEndTruncatedNotice(1, "2026-08-04", "2026-08-14"), /newest 1 flag\./);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/flagQueuePage.test.tsx src/lib/flagQueueLabels.test.ts
```

Expected: FAIL — `queueEndTruncatedNotice` is not exported and `truncatedTo` is not a prop.

- [ ] **Step 3: Add the label**

In `src/lib/flagQueueLabels.ts`, beside `cappedHeadline`:

```ts
/**
 * The last row of a capped queue.
 *
 * Replaces the amber strip that used to sit above the list. Same fact, and the
 * same lever named in words — but it arrives when someone has worked to the
 * bottom and is about to conclude the range is clear, rather than before they
 * have any use for it. Capping is structural at production volume and never
 * clears, so a permanent banner was a permanent lecture.
 */
export function queueEndTruncatedNotice(
  shown: number,
  startDate: string,
  endDate: string,
): string {
  const flags = shown === 1 ? "flag" : "flags";
  return (
    `End of the newest ${shown.toLocaleString("en-US")} ${flags}. ` +
    `Older days in ${dateSpanLabel([startDate, endDate])} aren't loaded — ` +
    `narrow the dates to reach them.`
  );
}
```

- [ ] **Step 4: Render the row**

In `src/ui/FlagQueueList.tsx`, add to `FlagQueueListProps`:

```tsx
  /**
   * The number of flags actually loaded, when the query hit its cap — null or
   * absent when it did not. Renders the end-of-list notice.
   */
  truncatedTo?: number | null;
```

Add `TriangleAlertIcon` to the lucide import and `queueEndTruncatedNotice` to the `@/lib/flagQueueLabels` import.

Then, inside the returned `<ul>` (the one at line ~278 with `aria-label="Flag queue"`), immediately **after** the closing `)}` of `{rows.map(…)}` and before `</ul>`:

```tsx
      {props.truncatedTo != null ? (
        // role="presentation" for the same reason the "show as group" caption
        // carries it: every selectable row authors aria-setsize/aria-posinset,
        // and ARIA wants that metadata all-or-none across a set. A bare
        // listitem here would be counted by assistive tech while the authored
        // setsize said otherwise.
        <li role="presentation">
          <div className="mt-1 flex items-start gap-2 border-t border-dashed border-border px-2.5 pt-3 text-xs text-muted-foreground">
            <TriangleAlertIcon
              className="mt-0.5 size-3.5 shrink-0 text-amber-600"
              aria-hidden="true"
            />
            <span>
              {queueEndTruncatedNotice(
                props.truncatedTo,
                props.range.startDate,
                props.range.endDate,
              )}
            </span>
          </div>
        </li>
      ) : null}
```

The early return for an empty list (`"Nothing to triage in this range."`, line ~175) is left alone: an empty list cannot be the end of the newest N of anything, and a capped query never produces one.

- [ ] **Step 5: Feed it from the page**

In `src/ui/FlagQueuePage.tsx`, at the `<FlagQueueList` mount site (around line 761, inside the `list={…}` prop of `<FlagQueueView>`), add:

```tsx
            truncatedTo={truncated ? (counts?.open ?? null) : null}
```

`truncated` is destructured at line 298 and `counts` is in scope — it is passed to `FlagQueueView` at line 722. If either name differs, use the names actually in scope rather than introducing new state; do not thread a new prop through `FlagQueueView` for this, because the list is mounted in the container, not the view.

- [ ] **Step 6: Run the tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
```

Expected: typecheck clean; count up by 6 from Task 3's total; 0 failures; e2e green.

At this point the page shows the cap **twice** — the old amber strip and the new terminal row. That is intentional and lasts exactly one commit; Task 5 removes the strip.

- [ ] **Step 7: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "feat(flag-queue): the cap says so at the end of the list

A line above the queue reading 'newest 3,445' is a fact read before there is
any use for it. At the end of the list it arrives exactly when someone has
worked to the bottom and is about to conclude the range is clear — the only
moment it changes what they do. Zero pixels either way, because it is inside
the scrolling list rather than above it.

The old amber strip is still present for one commit; it goes with the rest of
the notice stack next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `/hr-flags` — delete the stack, mount the chip

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/flagQueueBanner.test.tsx`
- Modify: `dewey_time/frontend/hr_attendance/e2e/flags.spec.ts`

**Interfaces:**
- Consumes: `flagQueueHealth` and `HealthCondition` (Task 1), `DataHealthButton` (Task 2), `OutageExcusePanel` (Task 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/flagQueuePage.test.tsx`. Source-text assertions, the convention `chromeMigration.test.tsx` uses — `FlagQueuePage.tsx` is 1,391 lines and Radix portals server-render to `null`, so most of it is out of `renderToStaticMarkup`'s reach.

```tsx
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function flagPageSource(): string {
  return readFileSync(resolve(PKG_ROOT, "src/ui/FlagQueuePage.tsx"), "utf8");
}

test("the page header is gone, and the heading is not", () => {
  // sr-only is absolutely positioned and measures zero pixels, so the space is
  // still reclaimed — but a nav tab is not a heading. chromeMigration.test.tsx
  // requires every routed page to answer "where am I".
  const src = flagPageSource();
  assert.doesNotMatch(src, /PageHeader/);
  assert.match(src, /<h1 className="sr-only">Flags<\/h1>/);
});

test("the notice stack is gone from the source, not merely hidden", () => {
  const src = flagPageSource();
  assert.doesNotMatch(src, /orphan/i, "the orphan counts leave the page entirely");
  assert.doesNotMatch(src, /CAPPED_EXPLAINER|cappedHeadline/, "the cap lives at the end of the list now");
  assert.doesNotMatch(src, /narrowRangeLabel|onNarrowRange/, "the date pickers are the narrow control");
  assert.doesNotMatch(src, /DEVICE_ALERT_EXPLAINER/);
  assert.doesNotMatch(src, /queueSplitDescription/);
});

test("the toolbar's title-protecting clamp goes with the title", () => {
  // max-w-[calc(100vw-16rem)] existed for one reason: to stop the controls
  // squeezing the PageHeader title to zero width. With no title there is
  // nothing to protect, and the clamp only costs the toolbar room.
  assert.doesNotMatch(flagPageSource(), /max-w-\[calc\(100vw-16rem\)\]/);
});

test("the chip is the only thing standing between the toolbar and the queue", () => {
  const src = flagPageSource();
  assert.match(src, /<DataHealthButton/);
  assert.match(src, /flagQueueHealth\(/);
  assert.match(src, /<OutageExcusePanel/, "the outage panel is the popover body");
  // The band no longer sits in the page's own column.
  assert.doesNotMatch(src, /<OutageBand/);
});

test("failures stay strips, because they are not data health", () => {
  // writeFailure and bulkFailure are transient consequences of something the
  // user just did. Behind a chip nobody has a reason to open, a failed write
  // is a silent one.
  const src = flagPageSource();
  assert.match(src, /props\.writeFailure \? \(/);
  assert.match(src, /props\.bulkFailure \? \(/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/flagQueuePage.test.tsx
```

Expected: FAIL on all five.

- [ ] **Step 3: Replace the header block**

In `src/ui/FlagQueuePage.tsx`, replace everything from `<PageHeader` (line ~938) through its closing `</PageHeader>` (line ~1094) with:

```tsx
      {/* No PageHeader. The nav tab the reader arrived through already reads
          "Flags", and a visible title plus its description cost roughly 48px on
          the one page where vertical space converts directly into rows. The
          description is not replaced anywhere: "206 people need a decision ·
          206 rows · 262 waiting on a device fault" is three counts nobody acts
          on, and the queue below states its own size by existing.

          The heading does NOT go with it. `sr-only` is absolutely positioned
          and measures zero pixels, so the space is still reclaimed, but a nav
          tab is not a heading: it does not appear in a screen reader's heading
          list, and a route with none has no answer to "where am I".
          chromeMigration.test.tsx pins this for every route. */}
      <h1 className="sr-only">Flags</h1>

      {/* One row. The chip takes the horizontal space the title vacated, so it
          costs nothing vertically — and there is no `max-w-[calc(100vw-16rem)]`
          clamp any more, because that clamp existed solely to stop these
          controls squeezing the title to zero width. */}
      <div className="flex flex-wrap items-center gap-2">
        <DataHealthButton conditions={healthConditions}>
          <OutageExcusePanel
            outages={props.outages}
            excludedBranches={props.excludedBranches}
            onToggleBranch={props.onToggleBranch}
            onExcuse={props.onExcuseOutages}
            submitting={props.excusing}
          />
          {props.alerts && props.alerts.length > 0 ? (
            // The only way a flagless outage reaches HR. These come from Device
            // Closeout Alert, not from flags: on a deferred_offline or
            // closure_failed day the fallback path skips those employees
            // entirely, so the queue is empty for them by construction. No
            // `last_error` — it is engine text that can name a device serial,
            // and there is no device↔branch registry to make that claim true.
            <div className="border-t border-border px-3 py-2.5">
              <ul className="space-y-1">
                {props.alerts.map((alert) => (
                  <li
                    key={`${alert.branch}:${alert.local_date}`}
                    className="text-xs text-foreground"
                  >
                    {deviceAlertHeadline(alert)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DataHealthButton>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DatePickerInput
            ariaLabel={RANGE_FROM_LABEL}
            value={props.range.startDate}
            max={parseISO(props.range.endDate)}
            onChange={(value) => props.onRangeChange({ ...props.range, startDate: value })}
            className="w-36 space-y-0"
          />
          <span className="text-muted-foreground" aria-hidden="true">
            –
          </span>
          <DatePickerInput
            ariaLabel={RANGE_TO_LABEL}
            value={props.range.endDate}
            min={parseISO(props.range.startDate)}
            onChange={(value) => props.onRangeChange({ ...props.range, endDate: value })}
            className="w-36 space-y-0"
          />
          <select
            aria-label={TIER_FILTER_LABEL}
            value={props.tier ?? ""}
            onChange={(event) => props.onTierChange(parseTierParam(event.target.value))}
            className="h-10 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{TIER_FILTER_ALL_LABEL}</option>
            {TIER_VALUES.map((value) => (
              <option key={value} value={value}>
                {tierLabel(value)}
              </option>
            ))}
          </select>
          {/* The one count that was ever a control. */}
          <button
            type="button"
            aria-pressed={props.includeDecided ?? false}
            onClick={props.onToggleDecided}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
              props.includeDecided
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {DECIDED_TOGGLE_LABEL}
            <span className="tabular-nums text-foreground">{counts?.decided ?? 0}</span>
          </button>
        </div>
      </div>

      {props.rolloutBanner ? (
        // Stays a strip. A pilot period is set by configuration for weeks at a
        // time, is tone="accent" rather than amber, and is not a fact about
        // whether the data is healthy.
        <AttentionStrip
          tone="accent"
          icon={<FlaskConicalIcon className="size-4 text-brand-accent" aria-hidden="true" />}
        >
          {props.rolloutBanner}
        </AttentionStrip>
      ) : null}

      {/* Stays a strip, and stays visible. It appears only when the user has
          pressed the Decided toggle themselves, so it is a response to an
          action rather than an unsolicited notice — and without it the extra
          rows read as a bug: entries with no action left on them, in a queue
          that promises everything in it is waiting on you. */}
      {props.includeDecided ? (
        <p className="text-xs text-muted-foreground">{SHOWING_DECIDED_MESSAGE}</p>
      ) : null}
```

Above the `return (`, beside the other derived values in `FlagQueueView`, add:

```tsx
  // Withheld on a failed load, and while loading, for the same reason `counts`
  // is: react-query keeps the last good `data` when a refetch fails, so these
  // conditions can outlive the payload they came from — and the popover behind
  // this chip holds the page's largest WRITE. "Excuse 157 people" reachable
  // above "Flags didn't load" invites a mass decision over data the page has
  // just said it could not load.
  const healthConditions =
    props.isLoading || props.error
      ? []
      : flagQueueHealth({
          outageBranches: props.outages.length,
          closeoutAlerts: props.alerts?.length ?? 0,
        });
```

- [ ] **Step 4: Delete the old mounts**

Still in `src/ui/FlagQueuePage.tsx`:

1. Delete the whole `{props.isLoading || props.error ? null : (<OutageBand … />)}` block and its comment (was lines ~1096-1116).
2. Delete the whole `{props.alerts && props.alerts.length > 0 ? (<Section>…</Section>) : null}` block and its comment (was lines ~1154-1176).
3. Delete the `outagePeople` derivation and its comment (around line 918) — nothing reads it now.
4. Delete the `orphanLines` derivation and its comment (lines ~907-916).
5. Remove `onNarrowRange` from `FlagQueueViewProps` **and** from the `<FlagQueueView>` call site in the container, **and** delete the container's `handleNarrowRange` function if it has no other caller (check with grep).
6. Fix the imports: drop `PageHeader` from the `@lolbikb/dewey-ui` import; drop `TriangleAlertIcon` if the remaining strips no longer use it (they do — `writeFailure` and `bulkFailure` keep it, so verify before removing); drop `CloudOffIcon` if the alert `Section` was its only user; add `DataHealthButton`, `OutageExcusePanel`, and `flagQueueHealth`.
7. From the `@/lib/flagQueueLabels` import drop `queueSplitDescription`, `cappedHeadline`, `CAPPED_EXPLAINER`, `narrowRangeLabel`, `orphanedFlagGoneSummary`, `orphanedEvidenceChangedSummary`, `DEVICE_ALERT_EXPLAINER`. Keep `deviceAlertHeadline` — the popover still uses it.

Then delete those seven exports from `src/lib/flagQueueLabels.ts` along with their doc comments, plus `splitHead` if `queueSplitDescription` was its only caller. Verify:

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && grep -rn "queueSplitDescription\|cappedHeadline\|CAPPED_EXPLAINER\|narrowRangeLabel\|orphanedFlagGoneSummary\|orphanedEvidenceChangedSummary\|DEVICE_ALERT_EXPLAINER" src e2e || echo "clean"
```

Expected: `clean`. Any hit in a `.test.` file is a test asserting deleted copy — delete that test and **name it in the report**.

- [ ] **Step 5: Run the unit tests**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web
```

`flagQueuePage.test.tsx` and `flagQueueBanner.test.tsx` assert the header description, both orphan lines and the capped strip. Each of those tests is asserting copy this task deletes:

- `flagQueuePage.test.tsx:1217, :1244, :1247, :1251, :1252, :1272, :1286` — the orphan lines. **Delete these tests.** The counts still arrive from the API and are simply not rendered; there is nothing left to assert.
- `flagQueuePage.test.tsx:2032, :2045` — `/Showing the newest 5,000 flags/`. **Retarget** at the terminal row Task 4 added: `/End of the newest 5,000 flags/`, and the negative case at `/End of the newest/`.
- `flagQueuePage.test.tsx:1848, :1850, :1868, :1874, :1885` — the outage band's presence and its absence beside a failure/spinner. **Retarget** at the chip: `/branches offline|branch offline/` for presence, and the same for absence.

Report the count before and after and name every test deleted.

- [ ] **Step 6: Fix the e2e spec**

`e2e/flags.spec.ts:305` asserts `"3 people need a decision · 2 rows · 2 waiting on a device fault"` — the header description. **Delete that assertion**; nothing replaces it.

`e2e/flags.spec.ts:276` asserts `band.getByText(/1 branch had no device data/)`. The band is now inside a popover. Retarget:

```ts
  await page.getByRole("button", { name: /1 branch offline/ }).click();
  await expect(page.getByText(/1 branch had no device data/)).toBeVisible();
```

Then run:

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:e2e
```

Expected: green. If any other spec selects the page by its title or description, fix it the same way and name it — the plan's file list may not be exhaustive here, and a missed selector is the single most likely gap in this task.

- [ ] **Step 7: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "feat(flags): the notice stack comes off the page

Six things could stack above the queue, and Section grow below them is
flex-basis 0 — every pixel they took was a pixel the queue never got. Nobody
acted on any of them.

What is left is one chip in the row the title vacated, holding a popover with
the outage detail, the per-branch checkboxes and the Excuse write. The cap
moved to the end of the list last commit. The orphan counts, the narrow-range
buttons, the device-alert explainer and the PageHeader are deleted; the
max-w-[calc(100vw-16rem)] clamp goes with the title it existed to protect.

Failures stay strips: a failed write behind a chip nobody opens is a silent
one. So does the decided-rows notice, which answers an action the user took.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `/hr-attendance` — the chip in the toolbar

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/DeviceAlerts.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/AttendanceToolbar.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/App.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/deviceAlerts.test.tsx`

**Interfaces:**
- Consumes: `attendanceHealth` (Task 1), `DataHealthButton` (Task 2).
- Produces: nothing later tasks depend on.

> **A tone change falls out of this task.** `DeviceCloseoutBanner` is currently
> `tone="accent"` — the brand orange that `src/brand/tokens.css` reserves for
> the *urgent* signal — while `DeviceSyncStalenessBanner` is amber. Merged into
> one chip they share amber, which is the right one of the two: a pending
> closeout is a data-freshness problem, not an urgent-action one. This is
> deliberate, not an oversight; do not reintroduce the accent.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/deviceAlerts.test.tsx`. Two of these read source text, so the
file needs imports it does not have yet — add them at the top:

```tsx
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
```

and add `DeviceHealthDetail` to the existing `@/ui/DeviceAlerts` import.

```tsx
test("the device banners are no longer AttentionStrips above the calendar", () => {
  // They rendered INSIDE Section grow (App.tsx), directly above the week view,
  // so they ate the calendar's height rather than the page's.
  const src = readFileSync(resolve(PKG_ROOT, "src/ui/App.tsx"), "utf8");
  assert.doesNotMatch(src, /DeviceCloseoutBanner|DeviceSyncStalenessBanner/);
});

test("the toolbar carries the chip instead", () => {
  const src = readFileSync(resolve(PKG_ROOT, "src/ui/AttendanceToolbar.tsx"), "utf8");
  assert.match(src, /<DataHealthButton/);
  assert.match(src, /attendanceHealth\(/);
});

test("the popover body still names every pending closeout", () => {
  const html = renderToStaticMarkup(
    <DeviceHealthDetail
      alerts={[
        { device_sn: "SN-1", local_date: "2026-08-12", status: "deferred_offline", branch: "BRANCH-A", last_error: null },
        { device_sn: "SN-2", local_date: "2026-08-13", status: "closure_failed", branch: "BRANCH-B", last_error: null },
      ]}
      staleSyncMinutes={1323}
    />,
  );
  assert.match(html, /SN-1/);
  assert.match(html, /SN-2/);
  assert.match(html, /22h 3m/);
});

test("the detail renders nothing it was not given", () => {
  const html = renderToStaticMarkup(
    <DeviceHealthDetail alerts={[]} staleSyncMinutes={null} />,
  );
  assert.doesNotMatch(html, /last sync/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsx --test src/ui/deviceAlerts.test.tsx
```

Expected: FAIL — `DeviceHealthDetail` does not exist.

- [ ] **Step 3: Replace the two banners with one popover body**

In `src/ui/DeviceAlerts.tsx`, delete `DeviceCloseoutBanner` and `DeviceSyncStalenessBanner` entirely (and the `AttentionStrip`, `AlertTriangleIcon` and `ClockIcon` imports if nothing else in the file uses them — `DeviceAlertRow` stays and uses neither). Add:

```tsx
/**
 * The attendance page's data-health popover body.
 *
 * Both banners this replaces rendered inside `Section grow`, directly above the
 * week view — so they took their height from the calendar rather than from the
 * page. Same facts, no layout cost.
 */
export function DeviceHealthDetail(props: {
  alerts: DeviceAlert[];
  /** Null when there is no staleness to report. */
  staleSyncMinutes: number | null;
}) {
  return (
    <div className="px-3 py-2.5 text-sm">
      {props.staleSyncMinutes != null ? (
        <p className="text-foreground">
          Device data may be stale — last sync{" "}
          <span className="font-medium">
            {formatDurationMinutes(Math.round(props.staleSyncMinutes))}
          </span>{" "}
          ago
        </p>
      ) : null}
      {props.alerts.length > 0 ? (
        <ul
          className={cn(
            "space-y-1.5 text-xs text-muted-foreground",
            props.staleSyncMinutes != null && "mt-2 border-t border-border pt-2",
          )}
        >
          {props.alerts.map((alert) => (
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
      ) : null}
    </div>
  );
}
```

Add `cn` to the imports from `@/lib/utils`.

- [ ] **Step 4: Mount the chip in the toolbar**

`AttendanceToolbar` needs the two counts. Add to its props type:

```tsx
  /** Minutes since the last device punch, or null when not stale. */
  staleSyncMinutes: number | null;
  /** Device Closeout Alerts for the week on screen. */
  deviceAlerts: DeviceAlert[];
```

In `src/ui/AttendanceToolbar.tsx`, inside the `<header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">` (line 60), after the bordered picker box's closing `</div>` and before the week-nav group, insert:

```tsx
      {/* Rides in the gap sm:justify-between already leaves between the picker
          block and the week nav, so it costs no vertical space. Renders null
          when both counts are clean, which is the ordinary day. */}
      <DataHealthButton
        conditions={attendanceHealth({
          staleSyncMinutes: props.staleSyncMinutes,
          closeoutAlerts: props.deviceAlerts.length,
        })}
      >
        <DeviceHealthDetail
          alerts={props.deviceAlerts}
          staleSyncMinutes={props.staleSyncMinutes}
        />
      </DataHealthButton>
```

- [ ] **Step 5: Stop rendering the banners in `Section grow`**

In `src/ui/App.tsx`, delete these lines (around 328-333):

```tsx
                {weekDeviceAlerts.length > 0 ? (
                  <DeviceCloseoutBanner alerts={weekDeviceAlerts} />
                ) : null}
                {syncStaleness.stale && syncStaleness.minutesSince != null ? (
                  <DeviceSyncStalenessBanner minutesSince={syncStaleness.minutesSince} />
                ) : null}
```

Remove the `DeviceCloseoutBanner, DeviceSyncStalenessBanner` import (line 39). Then pass the counts to the toolbar, beside its other props (around line 315):

```tsx
                weekFlagCounts={weekFlagCounts}
                deviceAlerts={weekDeviceAlerts}
                staleSyncMinutes={
                  syncStaleness.stale ? (syncStaleness.minutesSince ?? null) : null
                }
```

The `stale ? … : null` collapse is the contract `attendanceHealth` documents: **null means "nothing to report", not "zero minutes"**. Passing `minutesSince` unconditionally would light the chip on every healthy page load.

- [ ] **Step 6: Run everything**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
```

Expected: typecheck clean; count up by 4 from Task 5's total; 0 failures; e2e green.

`deviceAlerts.test.tsx:37` asserts `/Device data may be stale/`. That copy survives in `DeviceHealthDetail`, but the test renders `DeviceSyncStalenessBanner`, which no longer exists — **retarget it at `DeviceHealthDetail`.** Any `AttendanceToolbar` test will now need the two new required props; add them rather than making the props optional, because a caller that forgets them should not silently get a chip-free toolbar.

- [ ] **Step 7: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add -A dewey_time/frontend/hr_attendance
git commit -m "feat(attendance): the device banners move into a toolbar chip

Both rendered inside Section grow, directly above the week view, so they took
their height from the calendar rather than from the page. They are now one
chip in the gap sm:justify-between already leaves in the toolbar, with the
same facts in its popover.

staleSyncMinutes is null when there is nothing to report rather than 0 —
0 is a real age the caller has already judged stale, and a falsy check would
drop it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Measure the zero-cost claim in a browser

The whole design rests on one assertion: the chip costs no vertical space because the row was already there. This repo has twice published derived layout figures that a browser then contradicted — the shared picker's chrome budget hinged on an avatar size changed later in the same design, and `--font-khmer` shipped naming a font family that did not exist. So the claim is measured or it is not made.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/e2e/notice-arrangement.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-14-notice-arrangement-design.md`

**Interfaces:**
- Consumes: the chip and both pages, rendered live.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

Create `e2e/notice-arrangement.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/** Height of the page's first chrome row, in CSS pixels. */
async function toolbarHeight(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);
}

test("an outage puts a chip in the flags toolbar and no band above the queue", async ({ page }) => {
  await stubFrappe(page);
  await page.goto("/hr-flags");

  const chip = page.getByRole("button", { name: /branch(es)? offline/ });
  await expect(chip).toBeVisible();
  // The band's own text must not be on the page until the chip is opened.
  await expect(page.getByText(/had no device data/)).toHaveCount(0);

  await chip.click();
  await expect(page.getByText(/had no device data/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Excuse/ })).toBeVisible();
  await expect(page.getByText(/nobody is being judged here/)).toBeVisible();
});

for (const width of [1280, 375]) {
  test(`the flags chip costs no vertical space at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    // With an outage — the chip is present.
    await stubFrappe(page);
    await page.goto("/hr-flags");
    await expect(page.getByRole("button", { name: /branch(es)? offline/ })).toBeVisible();
    const withChip = await toolbarHeight(page, '[data-testid="flag-toolbar"]');

    // Without one — the chip is not rendered at all.
    await stubFrappe(page, { outages: [] });
    await page.goto("/hr-flags");
    await expect(page.getByRole("button", { name: /branch(es)? offline/ })).toHaveCount(0);
    const withoutChip = await toolbarHeight(page, '[data-testid="flag-toolbar"]');

    console.log(`[measured] flags toolbar @${width}: with chip ${withChip}px · without ${withoutChip}px`);
    expect(withChip).toBe(withoutChip);
  });
}
```

Two supporting edits this spec needs.

**First**, add `data-testid="flag-toolbar"` to the toolbar `<div className="flex flex-wrap items-center gap-2">` Task 5 created.

**Second**, `stubFrappe` needs an outage-free variant. It already takes overrides — `FrappeStubOverrides` at `e2e/fixtures.ts:382`, with `coverage`, `enrollment` and `employeeName` members — and the flag queue is served at line 454 by `message = flagQueuePayload();`. Add a fourth member:

```ts
  /**
   * Outage groups for the flag queue, when a test needs a queue without one.
   * Omitted, the payload's own outage stands — which is what every other flag
   * spec relies on.
   */
  flagQueueOutages?: OutageGroup[];
```

and thread it through:

```ts
    } else if (p.includes("get_flag_queue")) {
      message = flagQueuePayload(overrides.flagQueueOutages);
    }
```

giving `flagQueuePayload` an optional parameter that replaces the `outages` array when supplied and leaves it untouched when not. Import `OutageGroup` from `@/lib/flagQueuePartition`. **Do not change the default payload** — `e2e/flags.spec.ts` asserts against its single outage, and a changed default would break specs this plan has already fixed once.

- [ ] **Step 2: Run it and read the measurement**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx playwright test e2e/notice-arrangement.spec.ts --reporter=list
```

Expected: all pass. **Read the `[measured]` lines and record both numbers in the task report** — "it passed" is a different claim from "the row is 44px with and without".

**If the 375px case fails**, the chip is adding a wrap line. The spec states the retreat rather than leaving it to be invented:

1. First, drop the chevron and the `+N` at that width — add `hidden sm:inline` to both spans in `DataHealthButton`. Re-run.
2. If it still fails, the phone keeps one extra wrap line. **Say so plainly**, record the actual figure, and correct the spec in Step 3 rather than quietly loosening the assertion to `toBeLessThanOrEqual`.

- [ ] **Step 3: Reconcile the spec with the measurement**

Edit `docs/superpowers/specs/2026-08-14-notice-arrangement-design.md`. In the **Testing** section, replace the paragraph beginning "E2E — the vertical claim is measured, not asserted" with the measured figures at both widths, and state which of the three 375px outcomes actually happened. If the chip is not free on a phone, change the design's "costs **zero** vertical pixels" claim to name the exception.

- [ ] **Step 4: Run every suite**

```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run typecheck && npm run test:web && npm run test:e2e
cd /Users/lolbikb/projects/dewey-time && python3 -m unittest discover -s dewey_time/tests -t . 2>&1 | tail -3
```

Expected: all green. Report the web unit count, the e2e count and the Python count.

- [ ] **Step 5: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time && git add dewey_time/frontend/hr_attendance/e2e/notice-arrangement.spec.ts dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx dewey_time/frontend/hr_attendance/e2e/fixtures.ts docs/superpowers/specs/2026-08-14-notice-arrangement-design.md
git commit -m "test(notices): measure the chip's vertical cost instead of asserting it

The design rests on one claim — the chip is free because the row was already
there. This measures the toolbar's height with and without it at 1280 and
375, and reconciles the spec with what came back.

Also pins the behaviour: an outage shows a chip and no band, opening it
reveals Excuse and the 'nobody is being judged here' framing, and a healthy
queue has no chip at all.

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

Verify the source reached it before committing: the shipped `index.js` should carry `branches offline` and should **not** carry `no longer have a matching flag` or `Older days in this range aren't loaded`.

- [ ] Then use superpowers:finishing-a-development-branch. Base branch is `main`; the repo convention is a squash-merge via PR with a `(#NNN)` suffix on the title.
