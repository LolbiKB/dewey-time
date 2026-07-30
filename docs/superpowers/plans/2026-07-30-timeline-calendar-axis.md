# Timeline Calendar Axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the check-in/out timeline a labelled hour axis on a scale that stays put between weeks and between employees, the way a calendar app does.

**Architecture:** The vertical window is derived from the week's *assigned shift* bounds (padded an hour, quantized to whole hours) instead of from its punches, so a stray punch widens the axis by one labelled hour rather than re-scaling all seven days. A new pure module computes hour ticks; a new presentational module renders the gutter and gridlines. Both existing surfaces — the desktop week grid and the phone day view — gain a gutter column and render the same `DayTimeline` track underneath.

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS v4, `tsx --test` + `node:assert/strict`, `renderToStaticMarkup` for render assertions.

**Spec:** `docs/superpowers/specs/2026-07-30-timeline-calendar-axis-design.md` — read it before Task 1. It records *why* several of these choices are what they are, including two rejected earlier drafts that must not be reintroduced.

**Package root:** all paths below are relative to `dewey_time/frontend/hr_attendance/` unless they start with `dewey_time/`.

## Global Constraints

- **The unit gate is `npm run test:web`, run from `dewey_time/frontend/hr_attendance`.** Baseline before any change: **242 tests, 0 failures, ~6.2s**. Every task pastes the actual counts. Never describe a run you did not do.
- **`npm run test`, `npm run typecheck`, and `npm run lint` do not exist.** `package.json` has only `dev`, `build`, `preview`, `test:web`, `test:e2e`. Calling one fails with "Missing script".
- **`npx tsc --noEmit` is already red on `main`** — exit 2, `tsconfig.json(15,5): error TS5101: Option 'baseUrl' is deprecated`. That one line is the accepted baseline. Do not use `tsc` as a pass/fail gate, and **do not edit `tsconfig.json`** as a side effect of any task.
- **A green CI `Frontend` check is not evidence.** Its `npm install` step is `continue-on-error: true`, so a failed private-package fetch skips `test:web` and still reports green.
- **`test:web`'s glob is seven literal patterns.** Covered: `src/lib/*.test.ts`, `src/brand/*.test.{ts,tsx}`, `src/pwa/*.test.{ts,tsx}`, `src/components/*.test.tsx`, `src/ui/*.test.tsx`. **Not covered:** `src/ui/*.test.ts`, `src/lib/*.test.tsx`, anything under `src/hooks/`. A test file placed outside the covered set silently never runs.
- **Nothing typechecks or lints this package**, and `noUnusedLocals` is unset. A missed dead import ships. Where a task lists orphans, work the list — do not substitute "remove unused imports".
- **No new named CSS rules.** Tailwind utilities only. A named class in `src/brand/base.css` pulls in the `offSiteSegment.test.tsx:127-140` convention of asserting rules off disk, which this work does not need.
- **Axis chrome is `aria-hidden` and tooltip-free.** `WeekDayView.test.tsx:42` renders `WeekDayView` with no `TooltipProvider`; anything wrapped in `AppTooltip` throws there.
- **`DayTimeline.test.tsx:13-25` asserts full `class="…"` attribute strings** via `html.includes`. Style changes are safe; adding *any* class to a segment or gap band breaks four tests.
- **Build exactly once, in Task 8.** `vite.config.ts` sets `emptyOutDir: true` and `scripts/copy-html-entry.mjs` stamps a fresh timestamp into `assets/build-id.txt` on every invocation, so a second "just checking" build is pure churn.
- **Git discipline:** `git add` only the named paths for your task. Never `-A`, `.`, or `-u`. Never checkout/switch/branch/stash/reset/rebase/merge/clean/push. Never touch the stash list. No `npm install`, no edits to `package.json` or `package-lock.json`.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC
  ```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/weekTimelineWindow.ts` | modify | Derive the axis window. Split collectors; new shift-derived rule. |
| `src/lib/weekTimelineWindow.test.ts` | modify | **Exists.** Rewrite the 08:00–18:00 case; keep the `canvasHeightPct` guard. |
| `src/lib/attendancePunches.ts` | modify | Delete `computeWeekTimelineWindow` + `DEFAULT_TIMELINE_FALLBACK_WINDOW`. |
| `src/lib/attendancePunches.test.ts` | modify | Delete their one test block and the named import. |
| `src/ui/weekTimelineScroll.test.tsx` | modify | Re-fixture so it stops being a tautology under the new rule. |
| `src/lib/timelineAxis.ts` | **create** | Pure: `AxisWindow`, `hourTicks`, `hourLabel`, `pctOfWindow`. |
| `src/lib/timelineAxis.test.ts` | **create** | Unit tests for the above. |
| `src/ui/TimelineAxis.tsx` | **create** | Presentational: `HourGrid`, `HourGutter`. |
| `src/ui/DayTimeline.tsx` | modify | Delete `dense`; band floor; segment cap; `HourGrid`; now-line. |
| `src/ui/DayTimeline.test.tsx` | modify | Delete the dense test, helper, docblock, consts. |
| `src/lib/shiftTimeline.ts` | modify | Delete `computeDaySpan` (orphaned by the dense removal). |
| `src/ui/WeekView.tsx` | modify | Gutter column; drop `dense`; pass `now`. |
| `src/ui/WeekDayView.tsx` | modify | Gutter column; drop `dense`; pass `now`. |
| `src/ui/AttendanceLoading.tsx` | modify | Gutter column in the skeleton, so load does not jump. |
| `src/ui/App.tsx` | modify | Create and pass the single `now`. |
| `src/ui/timelineAxis.test.tsx` | **create** | Render tests for gutter, gridlines, now-line. |
| `dewey_time/public/hr_attendance/**` | rebuild | The deployed artefact. Task 8 only. |
| `dewey_time/www/hr-{attendance,schedule}.html` | rebuild | Entry HTML. Task 8 only. |

**Task dependency order.** Tasks 4→5→6→7 touch overlapping regions of `DayTimeline.tsx` and must run in sequence. Tasks 1–3 are independent of 4–7. Task 8 is strictly last and runs once.

---

### Task 1: The shift-derived window

**Files:**
- Modify: `src/lib/weekTimelineWindow.ts` (whole file)
- Test: `src/lib/weekTimelineWindow.test.ts` (exists — 38 lines, 2 tests)

**Interfaces:**
- Consumes: `parseTimeToMinutes`, `minutesFromDateTime` from `@/lib/attendanceTime`; `Day` from `@/types/calendar`.
- Produces: `resolveWeekTimelineWindow(weekDates, daysByDate): WeekTimelineWindow` (unchanged signature); new exports `collectShiftBounds`, `collectWideningMinutes`, `FALLBACK_START_MIN`, `FALLBACK_END_MIN`. `WeekTimelineWindow` keeps its `{startMin, endMin, spanMinutes}` shape — later tasks and `useWeekTimelineWindow` depend on it.

**Context:** `collectWeekTimelineMinutes` currently pushes shift start/end into the *same* flat array as punch minutes, with no `end > start` check. If the new rule reuses it for the widening phase, an overnight shift's bounds re-enter through the back door and the exclusion is undone. That is why this task splits it into two functions rather than adding a filter.

- [ ] **Step 1: Rewrite the failing tests**

Replace the whole of `src/lib/weekTimelineWindow.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectShiftBounds,
  collectWideningMinutes,
  resolveWeekTimelineWindow,
} from "./weekTimelineWindow";
import type { Day } from "../types/calendar";

const D = (iso: string) => new Date(`${iso}T00:00:00`);
const WEEK = [D("2026-07-13")];

/** One day, with an optional assigned shift and optional bare punches. */
function day(
  date: string,
  shift: { start: string; end: string } | null,
  punches: string[] = [],
): Day {
  return {
    date,
    shift: shift
      ? { shift_assigned: true, start_time: shift.start, end_time: shift.end }
      : { shift_assigned: false },
    checkins: punches.map((t) => ({ time: `${date} ${t}` })),
  } as unknown as Day;
}

function windowOf(
  shift: { start: string; end: string } | null,
  punches: string[] = [],
): { startMin: number; endMin: number; spanMinutes: number } {
  const date = "2026-07-13";
  return resolveWeekTimelineWindow(WEEK, new Map([[date, day(date, shift, punches)]]));
}

const H = (h: number) => h * 60;

test("collectShiftBounds takes shift start/end only, and skips overnight", () => {
  const date = "2026-07-13";
  const normal = new Map([[date, day(date, { start: "08:00:00", end: "17:00:00" }, ["09:15:00"])]]);
  assert.deepEqual(collectShiftBounds(WEEK, normal), [H(8), H(17)], "no punch minutes here");

  const overnight = new Map([[date, day(date, { start: "22:00:00", end: "06:00:00" })]]);
  assert.deepEqual(collectShiftBounds(WEEK, overnight), [], "end <= start is excluded");
});

test("collectWideningMinutes takes observed minutes only, never shift bounds", () => {
  const date = "2026-07-13";
  const days = new Map([[date, day(date, { start: "08:00:00", end: "17:00:00" }, ["09:15:00"])]]);
  const mins = collectWideningMinutes(WEEK, days);
  assert.ok(mins.includes(H(9) + 15), "includes the checkin");
  assert.ok(!mins.includes(H(8)), "must NOT include shift start — that is collectShiftBounds' job");
  assert.ok(!mins.includes(H(17)), "must NOT include shift end");
});

test("an 08:00-17:00 week yields 07:00-18:00", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" });
  assert.equal(w.startMin, H(7));
  assert.equal(w.endMin, H(18));
  assert.equal(w.spanMinutes, H(11));
});

test("no shift assigned falls back to 06:00-20:00", () => {
  const w = windowOf(null);
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
  assert.equal(w.spanMinutes, H(14));
  assert.equal(
    (w as Record<string, unknown>).canvasHeightPct,
    undefined,
    "no canvas height: the axis is scaled to fit, never scrolled",
  );
});

test("punches inside the fallback do not move it", () => {
  const w = windowOf(null, ["09:15:00", "16:40:00"]);
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
});

test("an early punch widens the axis by whole hours, it does not re-derive it", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" }, ["05:20:00"]);
  assert.equal(w.startMin, H(5), "05:20 floors to 05:00");
  assert.equal(w.endMin, H(18), "the other end is untouched");
});

test("a late punch widens to midnight and never past it", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" }, ["23:30:00"]);
  assert.equal(w.startMin, H(7));
  assert.equal(w.endMin, H(24));
});

test("a just-after-midnight punch clamps at 00:00, never negative", () => {
  const w = windowOf({ start: "08:00:00", end: "17:00:00" }, ["00:05:00"]);
  assert.equal(w.startMin, 0);
});

test("an overnight shift falls back rather than stretching the axis to 06:00-22:00", () => {
  // The whole reason collectShiftBounds and collectWideningMinutes are separate:
  // fold the bounds back into the widening pass and this returns 06:00-22:00.
  const w = windowOf({ start: "22:00:00", end: "06:00:00" });
  assert.equal(w.startMin, H(6));
  assert.equal(w.endMin, H(20));
});

test("a mixed week spans every assigned shift", () => {
  const days = new Map([
    ["2026-07-13", day("2026-07-13", { start: "06:00:00", end: "14:00:00" })],
    ["2026-07-14", day("2026-07-14", { start: "12:00:00", end: "20:00:00" })],
  ]);
  const w = resolveWeekTimelineWindow([D("2026-07-13"), D("2026-07-14")], days);
  assert.equal(w.startMin, H(5));
  assert.equal(w.endMin, H(21));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:web`
Expected: failures in `weekTimelineWindow.test.ts` — `collectShiftBounds` / `collectWideningMinutes` are not exported yet, and the fallback is still 08:00–18:00. Every other file still passes.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `src/lib/weekTimelineWindow.ts` with:

```ts
import { format } from "date-fns";

import { minutesFromDateTime, parseTimeToMinutes } from "@/lib/attendanceTime";
import type { Day } from "@/types/calendar";

export type WeekTimelineWindow = {
  startMin: number;
  endMin: number;
  spanMinutes: number;
};

/**
 * The window for an employee with no schedule to derive one from — clock-based
 * staff, or a week with no Shift Assignment. A plain working day.
 */
export const FALLBACK_START_MIN = 6 * 60;
export const FALLBACK_END_MIN = 20 * 60;

/** Breathing room either side of the scheduled day, before hour-quantization. */
const PAD_MIN = 60;

/**
 * The scheduled bounds the axis is derived FROM.
 *
 * Overnight shifts (end <= start) are excluded on purpose. Minute-of-day cannot
 * express 22:00->06:00 as a range, and admitting those two numbers would widen
 * the window to 06:00-22:00 and flatten every other day in the week.
 */
export function collectShiftBounds(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): number[] {
  const mins: number[] = [];
  for (const d of weekDates) {
    const shift = daysByDate.get(format(d, "yyyy-MM-dd"))?.shift;
    if (!shift?.shift_assigned) continue;
    const start = parseTimeToMinutes(shift.start_time ?? null);
    const end = parseTimeToMinutes(shift.end_time ?? null);
    if (start == null || end == null || end <= start) continue;
    mins.push(start, end);
  }
  return mins;
}

/**
 * The observed minutes the axis is WIDENED BY, so nothing recorded can fall
 * outside the visible range.
 *
 * Deliberately excludes shift start/end: those belong to collectShiftBounds,
 * which is where the overnight guard lives. Folding them in here would re-admit
 * exactly the bounds that guard just excluded — the reason these are two
 * functions and not one.
 */
export function collectWideningMinutes(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): number[] {
  const mins: number[] = [];
  const push = (m: number | null) => {
    if (m != null) mins.push(m);
  };
  for (const d of weekDates) {
    const info = daysByDate.get(format(d, "yyyy-MM-dd"));
    for (const c of info?.checkins ?? []) push(minutesFromDateTime(c.time));
    push(minutesFromDateTime(info?.first_in));
    push(minutesFromDateTime(info?.last_out));
    const shift = info?.shift;
    if (shift?.shift_assigned) {
      push(parseTimeToMinutes(shift.lunch_start ?? null));
      push(parseTimeToMinutes(shift.lunch_end ?? null));
    }
  }
  return mins;
}

/**
 * The shared vertical axis, used by both the week grid and the phone day view.
 *
 * Derived from the week's assigned shifts, not its punches. Punches still widen
 * it — nothing recorded can be hidden — but they no longer define it, so one
 * stray 05:20 punch moves the axis by a labelled hour instead of re-scaling all
 * seven days. Schedules are assigned and stable; punches are noisy.
 *
 * Quantized to whole hours so the gridlines always land on an hour, which is
 * what makes the gutter's labels trustworthy.
 *
 * The axis always fits its container — there is no canvas taller than the
 * viewport and therefore no scrolling (see #78, and weekTimelineScroll.test.tsx).
 */
export function resolveWeekTimelineWindow(
  weekDates: Date[],
  daysByDate: Map<string, Day>,
): WeekTimelineWindow {
  const bounds = collectShiftBounds(weekDates, daysByDate);

  let startMin = FALLBACK_START_MIN;
  let endMin = FALLBACK_END_MIN;
  if (bounds.length) {
    startMin = Math.floor((Math.min(...bounds) - PAD_MIN) / 60) * 60;
    endMin = Math.ceil((Math.max(...bounds) + PAD_MIN) / 60) * 60;
  }

  for (const m of collectWideningMinutes(weekDates, daysByDate)) {
    if (m < startMin) startMin = Math.floor(m / 60) * 60;
    if (m > endMin) endMin = Math.ceil(m / 60) * 60;
  }

  startMin = Math.max(0, startMin);
  endMin = Math.min(24 * 60, endMin);
  return { startMin, endMin, spanMinutes: endMin - startMin };
}
```

Note `collectWeekTimelineMinutes` is gone. Task 2 removes the now-dead helper it used to call.

- [ ] **Step 4: Run the tests**

Run: `npm run test:web`
Expected: `weekTimelineWindow.test.ts` passes. `attendancePunches.test.ts` still passes (untouched). Paste the totals.

- [ ] **Step 5: Commit**

```bash
git add src/lib/weekTimelineWindow.ts src/lib/weekTimelineWindow.test.ts
git commit -m "feat(hr-attendance): derive the timeline axis from assigned shifts, not punches"
```

---

### Task 2: Retire the superseded window helper

**Files:**
- Modify: `src/lib/attendancePunches.ts` (delete lines ~605–626)
- Modify: `src/lib/attendancePunches.test.ts` (delete one import entry and one test block)
- Modify: `src/ui/weekTimelineScroll.test.tsx` (re-fixture)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. This task only removes.

**Context:** Task 1 removed the last production caller of `computeWeekTimelineWindow`. Two traps here. First, `:218` and `:221` are two *call sites inside one `test()`* spanning `:214-227` — there is no second test to find. Second, the named import at `attendancePunches.test.ts:10` must go too; nothing typechecks this package, so a stale import surfaces only as a test-time failure.

`computeDayTimeWindow` (same file, just below) is a **different function** and stays — `DayTimeline.tsx:305` still uses it.

- [ ] **Step 1: Delete the dead exports**

In `src/lib/attendancePunches.ts`, delete `DEFAULT_TIMELINE_FALLBACK_WINDOW` and `computeWeekTimelineWindow` in full — from the `export const DEFAULT_TIMELINE_FALLBACK_WINDOW = {` line through the closing `}` of `computeWeekTimelineWindow`, including their doc comments. Stop before `export function computeDayTimeWindow(`.

- [ ] **Step 2: Delete their test and import**

In `src/lib/attendancePunches.test.ts`:
- remove `computeWeekTimelineWindow,` from the named-import list (line ~10);
- delete the entire `test("week timeline window is an axis range only — a wide span widens it, it does not overflow", …)` block (lines ~214–227).

- [ ] **Step 3: Re-fixture the scroll regression test**

`weekTimelineScroll.test.tsx` builds `NARROW` (09:00–17:00) and `WIDE` (06:00–20:00) fixtures that are both `shift_assigned: false`. Under the new rule both resolve to the *same* 06:00–20:00 fallback, so every assertion passes while discriminating nothing — green, and testing nothing.

Give the fixtures assigned shifts so they resolve to different windows again. In `src/ui/weekTimelineScroll.test.tsx`, replace the `weekOf` helper with:

```tsx
/**
 * `from`–`to` every day, as an assigned shift plus matching punches.
 *
 * The shift is what makes this discriminating: the axis is derived from
 * assigned shift bounds, so NARROW and WIDE must resolve to genuinely
 * different windows (08:00–18:00 vs 05:00–21:00). Left as bare punches on
 * `shift_assigned: false`, both collapse onto the same fallback window and
 * every assertion below passes without proving anything.
 */
function weekOf(from: string, to: string): Map<string, Day> {
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: { shift_assigned: true, start_time: from, end_time: to },
          checkins: [
            { time: `${date} ${from}`, custom_device_branch: "HQ" },
            { time: `${date} ${to}`, custom_device_branch: "HQ" },
          ],
        } satisfies Day,
      ];
    }),
  );
}
```

Leave everything else in the file alone. Its real invariants — no `overflow-y-auto` / `overflow-auto`, and no `height:` percentage over 100 — are exactly what must keep holding.

- [ ] **Step 4: Prove the re-fixture discriminates**

Add this test at the end of `src/ui/weekTimelineScroll.test.tsx`:

```tsx
test("the two fixtures resolve to different windows, or this file proves nothing", () => {
  // Guards the tautology this test previously became: with shift_assigned:false
  // on both fixtures, NARROW and WIDE landed on the same fallback window and
  // every assertion above passed while discriminating nothing.
  const narrow = resolveWeekTimelineWindow(WEEK, NARROW);
  const wide = resolveWeekTimelineWindow(WEEK, WIDE);
  assert.notDeepEqual(
    { s: narrow.startMin, e: narrow.endMin },
    { s: wide.startMin, e: wide.endMin },
  );
});
```

and add the import at the top of the file:

```tsx
import { resolveWeekTimelineWindow } from "../lib/weekTimelineWindow";
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:web`
Expected: all green, total one test lower than Task 1's count for the deleted block and one higher for the added guard. Paste the totals.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendancePunches.ts src/lib/attendancePunches.test.ts src/ui/weekTimelineScroll.test.tsx
git commit -m "refactor(hr-attendance): retire the punch-derived window helper"
```

---

### Task 3: The pure axis module

**Files:**
- Create: `src/lib/timelineAxis.ts`
- Test: `src/lib/timelineAxis.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type AxisWindow = { startMin: number; endMin: number }`; `hourTicks(startMin, endMin): number[]`; `hourLabel(min): string`; `pctOfWindow(min, window): number`. Tasks 6 and 7 import all four.

**Context:** Two incompatible window shapes already exist — `WeekTimelineWindow` is `{startMin, endMin, spanMinutes}` while `DayDayTrack`'s internal memo returns `{startMin, endMin, span}` and can be `null`. `AxisWindow` is the narrow common shape both structurally satisfy, and `pctOfWindow` derives the span itself rather than reading either field name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/timelineAxis.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { hourLabel, hourTicks, pctOfWindow } from "./timelineAxis";

const H = (h: number) => h * 60;

test("hourTicks marks every whole hour inclusive of both bounds", () => {
  const ticks = hourTicks(H(7), H(18));
  assert.equal(ticks.length, 12);
  assert.equal(ticks[0], H(7));
  assert.equal(ticks[ticks.length - 1], H(18), "the terminal tick renders; it closes the axis");
});

test("hourTicks steps to 2h only once the window exceeds 17h", () => {
  // The boundary itself, both sides — 20px/hour is where hourly labels collide.
  const at17 = hourTicks(H(5), H(22));
  assert.equal(at17[1]! - at17[0]!, 60, "exactly 17h still steps hourly");

  const at18 = hourTicks(H(5), H(23));
  assert.equal(at18[1]! - at18[0]!, 120, "18h steps two-hourly");
});

test("the 2h step is phased from the first whole hour, not from even clock hours", () => {
  const ticks = hourTicks(H(5), H(23));
  assert.deepEqual(ticks.slice(0, 3), [H(5), H(7), H(9)], "05, 07, 09 — not 06, 08, 10");
});

test("hourTicks handles bounds that are not hour-aligned", () => {
  // The window is hour-quantized in practice, but this must not assume it.
  const ticks = hourTicks(430, 1085);
  assert.equal(ticks[0], H(8), "first whole hour at or after 07:10");
  assert.equal(ticks[ticks.length - 1], H(18), "last whole hour at or before 18:05");
  assert.ok(ticks.every((m) => m >= 430 && m <= 1085), "no tick outside the window");
});

test("hourTicks returns nothing for an empty or inverted window", () => {
  assert.deepEqual(hourTicks(H(9), H(9)), []);
  assert.deepEqual(hourTicks(H(18), H(7)), []);
});

test("hourLabel reads as a clock, including the two cases naive maths gets wrong", () => {
  assert.equal(hourLabel(H(7)), "7 AM");
  assert.equal(hourLabel(H(11)), "11 AM");
  assert.equal(hourLabel(H(23)), "11 PM");
  // `% 12` gives 0 for both of these.
  assert.equal(hourLabel(0), "12 AM");
  assert.equal(hourLabel(H(12)), "12 PM");
  // Reachable: a 23:30 punch widens endMin to 24:00, and that tick is labelled.
  assert.equal(hourLabel(H(24)), "12 AM");
});

test("pctOfWindow maps the window onto 0-100", () => {
  const w = { startMin: H(7), endMin: H(19) };
  assert.equal(pctOfWindow(H(7), w), 0);
  assert.equal(pctOfWindow(H(19), w), 100);
  assert.equal(pctOfWindow(H(13), w), 50);
});

test("pctOfWindow does not divide by zero", () => {
  assert.equal(pctOfWindow(H(9), { startMin: H(9), endMin: H(9) }), 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web`
Expected: FAIL — `Cannot find module './timelineAxis'`.

- [ ] **Step 3: Write the module**

Create `src/lib/timelineAxis.ts`:

```ts
/**
 * The vertical axis shared by the week grid and the phone day view.
 *
 * Pure on purpose: two window shapes exist in this package
 * (`WeekTimelineWindow` carries `spanMinutes`, `DayDayTrack`'s internal memo
 * carries `span` and may be null), and neither should leak into the axis chrome.
 * `AxisWindow` is the narrow shape both satisfy structurally.
 */
export type AxisWindow = { startMin: number; endMin: number };

/** Above this many hours, hourly labels collide (~20px/hour) and the step doubles. */
const HOURLY_STEP_MAX_HOURS = 17;

/**
 * Whole-hour marks inside the window, inclusive of an exact hit on either bound.
 *
 * The two-hour step is phased from the first whole hour at or after `startMin`
 * rather than aligned to even clock hours — one rule, so a 05:00 window reads
 * 05, 07, 09 and never silently drops its own first line.
 */
export function hourTicks(startMin: number, endMin: number): number[] {
  if (!(endMin > startMin)) return [];
  const stepMin = (endMin - startMin) / 60 > HOURLY_STEP_MAX_HOURS ? 120 : 60;
  const out: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += stepMin) out.push(m);
  return out;
}

/**
 * `"7 AM"`, `"12 PM"`. The `% 24` is load-bearing: a late punch widens the
 * window's end to 1440, that tick is labelled, and a bare `Math.floor(min / 60)`
 * would render it "24".
 */
export function hourLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${suffix}`;
}

/** The single place a minute becomes a vertical percentage for axis chrome. */
export function pctOfWindow(min: number, window: AxisWindow): number {
  const span = window.endMin - window.startMin;
  if (span <= 0) return 0;
  return ((min - window.startMin) / span) * 100;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:web`
Expected: PASS, 8 new tests. Paste the totals.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timelineAxis.ts src/lib/timelineAxis.test.ts
git commit -m "feat(hr-attendance): pure hour-tick maths for the timeline axis"
```

---

### Task 4: Delete the dead `dense` mode

**Files:**
- Modify: `src/ui/DayTimeline.tsx`
- Modify: `src/ui/DayTimeline.test.tsx`
- Modify: `src/lib/shiftTimeline.ts` (delete `computeDaySpan`)
- Modify: `src/ui/WeekView.tsx` (drop `dense={false}`)
- Modify: `src/ui/WeekDayView.tsx` (drop `dense={false}`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DayCell` and `DayDayTrack` lose their `dense` prop. `renderTimelineBand` loses its fifth parameter (`useWeekWindow: boolean`) and always uses the week window. Tasks 5–7 edit this file afterwards and assume `dense` is already gone.

**Context:** No production call site passes `dense={true}`. The mode carries a second full-day scale, a separate span path, a 3-segment cap, and a boolean threaded through `renderTimelineBand` — a branch inside every function the later tasks touch. Nothing typechecks or lints this package, so the orphan list below is the whole safety net: work it item by item.

**Three imports look dead and are not. Do not remove them, and do not remove the lib functions:**

| import | why it stays |
|---|---|
| `formatCheckinTime` | live at `:350` in `openSessionLabel`, used by the non-dense open-session band at `:419` |
| `hasTimelineErrorPunches` | becomes production-unused, but `attendancePunches.test.ts:262` still exercises the lib function. Remove **only** the `DayTimeline.tsx:20` import. |
| `clipScheduledBandToFuture` | the `DayTimeline.tsx:32` import is already dead (pre-existing, unrelated to `dense`), but the function is live at `shiftTimeline.ts:176` with four tests. Remove **only** the import. |

- [ ] **Step 1: Delete the dense branches in `DayTimeline.tsx`**

Work this list:

1. `DayCell` props: delete `dense: boolean;`.
2. `DayCell`: delete the whole `{props.dense ? ( … ) : null}` header block (date number, error pip, "Inspect" hover) and collapse the wrapper to `<div className="grid h-full gap-2 grid-rows-[1fr]">`.
3. `DayCell`: delete the now-orphaned `shiftEndMin` and `hasErrorPunch` consts, and the `hasTimelineErrorPunches` import.
4. `DayCell`: collapse `props.dense ? "h-full" : "h-full"` to `"h-full"`.
5. `DayCell`: in the holiday branch, collapse `props.dense ? "" : "min-h-0 h-full"` to `"min-h-0 h-full"`.
6. `DayCell`: delete `dense={props.dense}` and `lastOut={props.info?.last_out ?? null}` from the `<DayDayTrack …>` call.
7. `DayDayTrack` props: delete `dense: boolean;` and `lastOut: string | null;`.
8. `DayDayTrack`: delete `const span = computeDaySpan(props.firstIn, props.lastOut);` and the `computeDaySpan` import. Keep `props.firstIn` — `computeLateness` uses it.
9. `DayDayTrack`: in the `window` memo, delete the `if (props.dense) return null;` line and the `props.dense` dependency.
10. `DayDayTrack`: delete `pctFromMinuteDay` entirely.
11. `renderTimelineBand`: drop the `useWeekWindow` parameter; `topPct`/`bottomPct` always use `pctFromMinute`; `topStyle`/`heightStyle` become plain `` `${topPct}%` `` and `` `${heightPct}%` `` (the `calc(… + 8px)` / `calc(… - 16px)` forms were dense-only). Update all four call sites to pass four arguments.
12. `DayDayTrack`: delete the `{props.dense && span && segments.length === 0 ? (…) : null}` block.
13. `DayDayTrack`: the track div's `props.dense ? "" : "min-h-0 flex-1"` collapses to `"min-h-0 flex-1"`, and its `style={props.dense ? { height: 96 } : undefined}` is deleted.
14. `segments.slice(0, props.dense ? 3 : 6)` → `segments.slice(0, 6)`. **Task 5 removes the cap entirely — leave it as `6` here** so this task stays a pure deletion.
15. The two `!props.dense &&` guards in the segment label block become unconditional.
16. Remove the `clipScheduledBandToFuture` import (dead already).

- [ ] **Step 2: Drop `dense={false}` from both call sites**

Delete the `dense={false}` line from the `<DayCell …>` call in `src/ui/WeekView.tsx` and in `src/ui/WeekDayView.tsx`. Change nothing else in either file — `WeekDayView.test.tsx:93-100` asserts on that file's raw source text and must still match `/DayCell/`, `/useWeekTimelineWindow/`, `/DayChips/`, `/stepDay/`, and must not contain the literal `overflow-x-auto`.

- [ ] **Step 3: Delete `computeDaySpan`**

In `src/lib/shiftTimeline.ts`, delete `computeDaySpan` and its doc comment. It has no other consumers and no tests. Then remove whichever of `minutesSinceMidnight` / `parseDateTimeLocal` its removal orphans from that file's import block — **keep `clamp`**, which other functions use. Leave the file's three other pre-existing dead exports (`computeExpectedWindowPct`, `computeLunchWindowPct`, `computeExpectedMinutes`) alone; they are out of scope.

- [ ] **Step 4: Delete the dense tests**

In `src/ui/DayTimeline.test.tsx`, delete — this is one test, not two; `:114` is a docblock line:

- the consts `DENSE_WORKED_SPAN` and `DENSE_OFF_SHIFT_SPAN` (`:22-25`);
- the docblock and the `renderDenseDay` helper (`:113-139`);
- the single `test("the dense span follows the same rule as the full timeline", …)` (`:141-144`);
- the now-unused `import { DayCell }` (`:6`).

Delete, do not adapt. Adapting keeps a scale that no longer exists.

- [ ] **Step 5: Run the tests**

Run: `npm run test:web`
Expected: all green, one test fewer than Task 2's count. If anything fails with "is not defined" or "is not a function", an orphan was over-deleted — check the three-import table above first. Paste the totals.

- [ ] **Step 6: Grep for stragglers**

Run: `grep -rn "dense\|pctFromMinuteDay\|computeDaySpan\|useWeekWindow" src`
Expected: no matches. Anything found is a missed branch — nothing else in the toolchain will tell you.

- [ ] **Step 7: Commit**

```bash
git add src/ui/DayTimeline.tsx src/ui/DayTimeline.test.tsx src/lib/shiftTimeline.ts src/ui/WeekView.tsx src/ui/WeekDayView.tsx
git commit -m "refactor(hr-attendance): delete the dead dense timeline mode"
```

---

### Task 5: Stop the bands lying about duration

**Files:**
- Modify: `src/ui/DayTimeline.tsx`

**Interfaces:**
- Consumes: `renderTimelineBand` as Task 4 left it (four parameters).
- Produces: nothing new.

**Context:** `renderTimelineBand` floors every band at 2% of the window — about 9px at 07:00–18:00, i.e. ~14 minutes of apparent time. Harmless while the axis is unreadable; a visible lie once hours are labelled.

Two consequences to expect rather than discover. First, the `if (heightPct <= 0) return null` guard immediately below is **dead today** because `Math.max(2, …)` precedes it; removing the floor makes it live again, which is intended — it legitimately drops zero-length and inverted intervals. Second, `gaps.map` and `segments.map` compute their heights inline and have **no floor at all**; they keep none. Two floor policies is the correct outcome here, because those bands come from real punch pairs and should be free to render sub-1%. Do not unify them.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/DayTimeline.test.tsx`:

```tsx
/**
 * An 08:00–17:00 scheduled week worked 08:00–16:50, leaving ten unworked
 * minutes at the end of the shift.
 *
 * That 16:50–17:00 remainder becomes a `missingExpected` interval, which is
 * one of the three band kinds that actually flow through `renderTimelineBand`
 * (with `scheduledFuture` and `openSession`). This matters: an unworked notch
 * in the MIDDLE of the day would instead be classified as a gap and rendered
 * by `gaps.map`, which has no floor and never touches the code under test.
 *
 * The window is 07:00–18:00 = 660 minutes, so ten minutes is 1.515% — under
 * the old 2% floor, which is exactly the case that used to be inflated.
 * The dates are in the past, so `missingExpectedMaxEndMin` returns null and
 * the band is not clipped to the current hour.
 */
function shortMissingWeek(): Map<string, Day> {
  const punch = (date: string, time: string) => ({
    time: `${date} ${time}`,
    custom_device_branch: "HQ",
  });
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT",
            start_time: "08:00:00",
            end_time: "17:00:00",
          },
          checkins: [punch(date, "08:00:00"), punch(date, "16:50:00")],
          first_in: `${date} 08:00:00`,
          last_out: `${date} 16:50:00`,
          gross_minutes: 530,
        } satisfies Day,
      ];
    }),
  );
}

function renderShortMissing(): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={shortMissingWeek()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

test("a short band renders at its true height, not inflated to 2% of the window", () => {
  // 16:50-17:00 is 10 minutes of a 660-minute axis = 1.515%. The old
  // Math.max(2, …) floor drew it at exactly 2% — a confident claim of 13
  // minutes. Harmless while the axis was unreadable; a visible lie once the
  // hours beside it are labelled.
  const html = renderShortMissing();
  assert.match(html, /height:\s*1\.51/, "the 10-minute band must render at its true 1.51%");
  assert.doesNotMatch(html, /height:\s*2%/, "an exactly-2% band means the old floor survives");
  assert.match(html, /min-height:\s*3px/, "…and keeps a pixel floor so it stays visible");
});
```

**Verify the fixture bites before trusting the test.** Run it against the
*unmodified* `renderTimelineBand` first: it must fail on the `1.51` assertion
with a `2%` height in the markup. If it fails some other way — or passes —
the fixture is not producing a `missingExpected` band and the test proves
nothing. Check `awayIntervals`: any gap between segments is subtracted from
`missingExpected` before it renders.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web`
Expected: FAIL on the `min-height` assertion.

- [ ] **Step 3: Replace the floor**

In `renderTimelineBand`:

```tsx
    const heightPct = bottomPct - topPct;
    if (heightPct <= 0) return null;
```

and on the rendered `div`:

```tsx
          style={{ top: `${topPct}%`, height: `${heightPct}%`, minHeight: 3 }}
```

- [ ] **Step 4: Remove the segment cap**

`segments.slice(0, 6)` → `segments`. Delete the `.slice(…)` call entirely.

Eight absolutely-positioned divs cost nothing and segments never overlap in time, so there is nothing to protect against. A `"+N more"` marker was considered and rejected: it would sit inside `DayCell`'s root `<button>` and change that button's accessible name, which `e2e/attendance.spec.ts:20` selects on.

- [ ] **Step 5: Test the cap removal**

Add to `src/ui/DayTimeline.test.tsx`:

```tsx
/**
 * One scheduled day carrying `pairs` non-overlapping worked segments — eight
 * 30-minute stints from 08:00, each separated by a 30-minute gap.
 */
function manySegmentDay(pairs: number): Map<string, Day> {
  const date = format(WEEK[0]!, "yyyy-MM-dd");
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
  const checkins = Array.from({ length: pairs }, (_, i) => {
    const start = 8 * 60 + i * 60;
    return [
      { time: `${date} ${hhmm(start)}`, custom_device_branch: "HQ" },
      { time: `${date} ${hhmm(start + 30)}`, custom_device_branch: "HQ" },
    ];
  }).flat();
  return new Map([
    [
      date,
      {
        date,
        shift: {
          shift_assigned: true,
          shift_type: "FT",
          start_time: "08:00:00",
          end_time: "17:00:00",
        },
        checkins,
        first_in: checkins[0]!.time,
        last_out: checkins[checkins.length - 1]!.time,
        gross_minutes: pairs * 30,
      } satisfies Day,
    ],
  ]);
}

test("every segment renders — there is no silent truncation at six", () => {
  // On a labelled axis a dropped 7th segment reads as an unexplained absence
  // rather than as truncation, which is why the cap went rather than gaining
  // a "+N more" marker.
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={manySegmentDay(8)}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  const bands = html.match(new RegExp(WORKED_SEGMENT.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g")) ?? [];
  assert.equal(bands.length, 8, `expected 8 worked segments, found ${bands.length}`);
});
```

`WORKED_SEGMENT` is the exact-class constant already at the top of that file.

- [ ] **Step 6: Run the tests**

Run: `npm run test:web`
Expected: all green, two tests more than Task 4's count. Paste the totals.

- [ ] **Step 7: Commit**

```bash
git add src/ui/DayTimeline.tsx src/ui/DayTimeline.test.tsx
git commit -m "fix(hr-attendance): bands stop inflating short intervals and stop truncating at six"
```

---

### Task 6: The gutter and the gridlines

**Files:**
- Create: `src/ui/TimelineAxis.tsx`
- Modify: `src/ui/DayTimeline.tsx` (insert `HourGrid`, delete the hairline)
- Modify: `src/ui/WeekView.tsx` (gutter column, both grids)
- Modify: `src/ui/WeekDayView.tsx` (gutter column)
- Modify: `src/ui/AttendanceLoading.tsx` (gutter column in the skeleton)
- Test: `src/ui/timelineAxis.test.tsx` (create)

**Interfaces:**
- Consumes: `AxisWindow`, `hourTicks`, `hourLabel`, `pctOfWindow` from `@/lib/timelineAxis` (Task 3); `useWeekTimelineWindow` as it already is.
- Produces: `HourGrid({ window })`, `HourGutter({ window })`. Task 7 renders the now-line into the same track.

**Context:** `HourGrid` must be the **first DOM child** of the track div — exactly the slot the deleted hairline occupies. Nothing in `DayTimeline.tsx` sets a z-index (grep `z-10`, `z-[`: zero hits), so stacking is pure DOM order; inserted anywhere later it paints over the punch bands.

The gutter is a grid column, so it must align vertically with the track inside `DayCell`. `DayCell`'s root button has `p-3`, and the track fills the remaining height — hence `py-3` on the gutter.

- [ ] **Step 1: Write the failing render tests**

Create `src/ui/timelineAxis.test.tsx`, following the `offSiteSegment.test.tsx` idiom:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

/** An 08:00–17:00 assigned week, so the axis resolves to 07:00–18:00. */
function week(): Map<string, Day> {
  return new Map(
    WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT",
            start_time: "08:00:00",
            end_time: "17:00:00",
          },
          checkins: [
            { time: `${date} 08:00:00`, custom_device_branch: "HQ" },
            { time: `${date} 17:00:00`, custom_device_branch: "HQ" },
          ],
        } satisfies Day,
      ];
    }),
  );
}

const common = {
  weekDates: WEEK,
  daysByDate: week(),
  alertsByDate: new Map(),
  syncByDate: new Map(),
  onInspectDay: () => {},
  onInspectFlag: () => {},
};

const desktop = () =>
  renderToStaticMarkup(
    <TooltipProvider>
      <WeekView {...common} />
    </TooltipProvider>,
  );

const phone = () =>
  renderToStaticMarkup(
    <TooltipProvider>
      <WeekDayView {...common} />
    </TooltipProvider>,
  );

test("the gutter labels every hour of the derived window", () => {
  const html = desktop();
  for (const label of ["7 AM", "8 AM", "12 PM", "5 PM", "6 PM"]) {
    assert.ok(html.includes(label), `gutter is missing ${label}`);
  }
  assert.ok(!html.includes("6 AM"), "06:00 is outside a 07:00-18:00 window");
});

test("the phone surface labels the same hours as the week grid", () => {
  // A separate call site: TypeScript catches a missing prop declaration but not
  // a forgotten pass-down, which is exactly how this kind of gap ships.
  const html = phone();
  for (const label of ["7 AM", "12 PM", "6 PM"]) {
    assert.ok(html.includes(label), `phone gutter is missing ${label}`);
  }
});

test("hour lines render behind the bands, and the fake 50% hairline is gone", () => {
  const html = desktop();
  assert.ok(/bg-border(?![-/\w])/.test(html), "expected hour lines");
  assert.ok(
    !html.includes("calc(50% - 0.5px)"),
    "the decorative mid-width hairline reads as a false axis once real gridlines exist",
  );
});

test("axis chrome is hidden from assistive tech", () => {
  // It is decoration duplicating information the bands' tooltips already carry.
  assert.ok(desktop().includes('aria-hidden="true"'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web`
Expected: FAIL — no gutter labels in the markup, and the hairline is still present.

- [ ] **Step 3: Write the axis components**

Create `src/ui/TimelineAxis.tsx`:

```tsx
import { hourLabel, hourTicks, pctOfWindow, type AxisWindow } from "@/lib/timelineAxis";
import { cn } from "@/lib/utils";

/**
 * Hour lines, drawn inside a day track BEHIND the punch bands.
 *
 * Must be the first child of the track: nothing in DayTimeline sets a z-index,
 * so stacking is DOM order and a later insertion paints over the bands.
 */
export function HourGrid(props: { window: AxisWindow | null }) {
  if (!props.window) return null;
  const window = props.window;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {hourTicks(window.startMin, window.endMin).map((m) => (
        <div
          key={m}
          className="absolute inset-x-0 h-px bg-border"
          style={{ top: `${pctOfWindow(m, window)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The labelled time column.
 *
 * `py-3` matches DayCell's `p-3`, which is what puts each label on its line.
 * No tooltips: WeekDayView.test.tsx renders without a TooltipProvider.
 */
export function HourGutter(props: { window: AxisWindow | null; className?: string }) {
  return (
    <div className={cn("relative shrink-0 py-3 pr-1.5", props.className)} aria-hidden="true">
      <div className="relative h-full">
        {props.window
          ? hourTicks(props.window.startMin, props.window.endMin).map((m) => (
              <div
                key={m}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium tabular-nums text-muted-foreground/70"
                style={{ top: `${pctOfWindow(m, props.window!)}%` }}
              >
                {hourLabel(m)}
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Insert the grid and delete the hairline**

In `src/ui/DayTimeline.tsx`, add the import:

```tsx
import { HourGrid } from "@/ui/TimelineAxis";
```

Then, in `DayDayTrack`'s track div:

1. **Delete** the hairline entirely — `<div className="absolute inset-y-2 w-px bg-border/60" style={{ left: "calc(50% - 0.5px)" }} />`.
2. **Insert** `<HourGrid window={window} />` as the **first** child of that div, above the `{!onShift && props.checkins.length === 0 ? … : null}` empty state.

Order matters and nothing enforces it: there are no z-indexes in this file, so a later insertion paints over the punch bands.

`window` is `DayDayTrack`'s existing memo, of shape `{startMin, endMin, span} | null`. It satisfies `AxisWindow` structurally — the extra `span` field is fine because excess-property checking applies only to object literals, not to a variable — and `HourGrid` renders nothing when it is null.

- [ ] **Step 5: Add the gutter column to both surfaces**

In `src/ui/WeekView.tsx`, add `import { HourGutter } from "@/ui/TimelineAxis";`, then:

- header grid: `grid-cols-[repeat(7,minmax(8rem,1fr))]` → `grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]`, and insert `<div aria-hidden="true" />` as its first child so the columns line up with the body;
- timeline grid: same template change, with `<HourGutter window={weekWindow} />` as its first child.

In `src/ui/WeekDayView.tsx`, add the same import, then change `<div className="grid h-full [&>button]:border-0">` to `<div className="grid h-full grid-cols-[3.5rem_1fr] [&>button]:border-0">` and insert `<HourGutter window={weekWindow} />` before `<DayCell …>`.

Keep the existing comment above that div. The single-column `grid` is load-bearing (issue #71: `DayCell`'s root is an inline-level `<button>` that collapses to a sliver in a block wrapper); `grid-cols-[3.5rem_1fr]` preserves the stretch by the same mechanism.

- [ ] **Step 6: Match the loading skeleton**

In `src/ui/AttendanceLoading.tsx`, change both `grid-cols-[repeat(7,minmax(8rem,1fr))]` occurrences (`:64` and `:79`) to `grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]` and add a leading `<div aria-hidden="true" />` to each. Without this the layout jumps horizontally every time data replaces the skeleton.

- [ ] **Step 7: Run the tests**

Run: `npm run test:web`
Expected: all green, four tests more than Task 5's count. `weekTimelineScroll.test.tsx` must still pass — if it reports a `height:` over 100%, the axis chrome is emitting a height percentage where it should emit `top`. Paste the totals.

- [ ] **Step 8: Commit**

```bash
git add src/ui/TimelineAxis.tsx src/ui/timelineAxis.test.tsx src/ui/DayTimeline.tsx src/ui/WeekView.tsx src/ui/WeekDayView.tsx src/ui/AttendanceLoading.tsx
git commit -m "feat(hr-attendance): labelled hour gutter and gridlines on the timeline"
```

---

### Task 7: The now-line

**Files:**
- Modify: `src/ui/DayTimeline.tsx`
- Modify: `src/ui/WeekView.tsx`, `src/ui/WeekDayView.tsx`, `src/ui/App.tsx` (thread `now`)
- Test: `src/ui/timelineAxis.test.tsx` (extend)

**Interfaces:**
- Consumes: `DayDayTrack`'s existing local `pctFromMinute` — nothing new from `@/lib/timelineAxis`.
- Produces: an optional `now?: Date` prop on `WeekView`, `WeekDayView`, `DayCell`, and a `now`/`today` pair on `DayDayTrack`.

**Context:** `now` is a prop rather than a `new Date()` inside the component, matching `checkDeviceSyncStaleness(deviceSync, now)`, which takes it explicitly "so the function is unit-testable without mocking Date".

It is **optional**, defaulting to `new Date()` at the component boundary. Making it required would force edits to three regression test files for no benefit — their fixtures are all dated 2026-07-13..19, so no column is ever "today" and no now-line renders there regardless.

Three decisions already made in the spec, not to be revisited here:

- `isToday` stays as it is. The existing `isSameDay(d, new Date())` checks are not rewritten to consume `now`.
- `now` is **not** threaded into `deriveScheduledFutureIntervals`, `missingExpectedMaxEndMin`, or `classifyUnpairedPresentations`. All three accept an optional `now` and default internally. Threading them is a real improvement and a separate change.
- There is no ticking clock and this does not add one. `now` is evaluated at render.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/timelineAxis.test.tsx`:

```tsx
/**
 * A week containing the real today, because `isToday` is still
 * `isSameDay(d, new Date())` — deliberately not rewritten to consume `now`
 * (see the spec's §5.3). Only the *position* of the line is injected.
 *
 * This is not date-dependent: every day of the fixture carries the same
 * 08:00–17:00 shift, so the window is 07:00–18:00 whatever today happens to be.
 */
const TODAY = new Date();
const LIVE_WEEK = Array.from(
  { length: 7 },
  (_, i) => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - 3 + i),
);

function liveWeekDays(): Map<string, Day> {
  return new Map(
    LIVE_WEEK.map((d) => {
      const date = format(d, "yyyy-MM-dd");
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT",
            start_time: "08:00:00",
            end_time: "17:00:00",
          },
          checkins: [
            { time: `${date} 08:00:00`, custom_device_branch: "HQ" },
            { time: `${date} 17:00:00`, custom_device_branch: "HQ" },
          ],
        } satisfies Day,
      ];
    }),
  );
}

const AT = (h: number, m: number) =>
  new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), h, m);

function desktopAt(now: Date): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={LIVE_WEEK}
        daysByDate={liveWeekDays()}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        now={now}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
}

test("the now-line renders once, on today's column only", () => {
  const marks = desktopAt(AT(13, 20)).match(/bg-destructive\/70/g) ?? [];
  assert.equal(marks.length, 1, "one column is today, so exactly one line");
});

test("no now-line when the clock is outside the window", () => {
  // The silent-failure case: pctFromMinute clamps to [0,100], so forgetting the
  // suppression check yields a plausible line pinned to the top edge — a
  // confident 07:00 reading at 03:00 — rather than anything visibly broken.
  assert.ok(!/bg-destructive\/70/.test(desktopAt(AT(3, 0))), "03:00 is before a 07:00 window");
  assert.ok(!/bg-destructive\/70/.test(desktopAt(AT(22, 0))), "22:00 is after an 18:00 window");
});
```

No `today` prop is added. `isToday` keeps its own `new Date()`, so the fixture week is built around the real current date and only the line's *position* is injected — which is what makes these two tests deterministic on any day of the year.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web`
Expected: FAIL — no `bg-destructive/70` in the markup.

- [ ] **Step 3: Thread `now` down**

Add `now?: Date;` to `WeekViewProps` and `WeekDayViewProps`, and to `DayCell`'s props. Pass it through to `DayDayTrack`, which also needs `today?: boolean` — `DayCell` has `today` but does not currently forward it.

In `src/ui/App.tsx`, pass `now={new Date()}` to both `<WeekDayView …>` and `<WeekView …>`.

- [ ] **Step 4: Render the line**

In `DayDayTrack`, after the `window` memo:

```tsx
  const nowMin = useMemo(() => {
    const d = props.now ?? new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, [props.now]);
```

and as the child immediately after `<HourGrid …>`:

```tsx
        {/* Explicit bounds check, not a consequence of the pct maths: pctFromMinute
            clamps to [0,100], so omitting this renders a plausible line pinned to an
            edge — a confident 07:00 reading at 03:00 — instead of nothing. */}
        {props.today && window && nowMin >= window.startMin && nowMin <= window.endMin ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10"
            style={{ top: `${pctFromMinute(nowMin)}%` }}
            aria-hidden="true"
          >
            <div className="absolute -left-0.5 -top-[3px] size-1.5 rounded-full bg-destructive" />
            <div className="h-px bg-destructive/70" />
          </div>
        ) : null}
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:web`
Expected: all green, two tests more than Task 6's count. Paste the totals.

- [ ] **Step 6: Commit**

```bash
git add src/ui/DayTimeline.tsx src/ui/WeekView.tsx src/ui/WeekDayView.tsx src/ui/App.tsx src/ui/timelineAxis.test.tsx
git commit -m "feat(hr-attendance): mark the current time on today's timeline column"
```

---

### Task 8: Build and commit the deployed assets

**Files:**
- Modify: `dewey_time/public/hr_attendance/**`
- Modify: `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html`

**Interfaces:** none. This task writes no source.

**Context:** Frappe Cloud never builds this SPA — it cannot, because `@lolbikb/dewey-ui` is private and a fresh `npm install` returns 401 without `NODE_AUTH_TOKEN`. Whatever bundle is committed is what users get. A merged PR that changes `frontend/` but not `public/hr_attendance/` ships **nothing**. This has been missed before: assets went un-rebuilt from #58 through #74.

`node_modules` and `@lolbikb/dewey-ui` are already present in this tree. **Do not run `npm install`**, and do not delete `node_modules` — that needlessly reintroduces the token dependency.

- [ ] **Step 1: Full test run**

Run: `npm run test:web`
Expected: all green. Paste the totals. Do not build on a red suite.

- [ ] **Step 2: Build once**

Run: `npm run build`
Expected: success, output into `dewey_time/public/hr_attendance/`.

Build **once**. `vite.config.ts` sets `emptyOutDir: true`, and `scripts/copy-html-entry.mjs` stamps a fresh unix timestamp into `assets/build-id.txt` and new `?v=` query strings on every invocation — a second run produces a diff even when nothing changed.

- [ ] **Step 3: Check the diff is real**

Run: `git status --porcelain dewey_time/public/hr_attendance dewey_time/www`

If the **only** changes are `assets/build-id.txt` and `?v=` query strings in the HTML — no JS or CSS content change — the build is timestamp churn and must be reverted, not committed:

```bash
git checkout -- dewey_time/public/hr_attendance dewey_time/www
```

Then report that the source changes produced no bundle change, which would mean something earlier did not take effect.

- [ ] **Step 4: Commit the assets**

```bash
git add dewey_time/public/hr_attendance/ dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html
git commit -m "build(hr-attendance): ship the calendar-axis timeline bundle"
```

Named paths only — never `-A`, `.`, or `-u`.

---

## Verification checklist

Before the branch is finished:

- [ ] `npm run test:web` green, with the count pasted. Baseline was 242; the net change is roughly +16 (new axis and window tests) −2 (deleted dense and window-helper blocks).
- [ ] `grep -rn "dense\|pctFromMinuteDay\|computeDaySpan\|useWeekWindow" src` returns nothing.
- [ ] `grep -rn "computeWeekTimelineWindow\|DEFAULT_TIMELINE_FALLBACK_WINDOW" src` returns nothing.
- [ ] `weekTimelineScroll.test.tsx`'s two fixtures resolve to different windows (its own guard test covers this).
- [ ] `dewey_time/public/hr_attendance/` is committed and its JS actually differs from the previous bundle.
- [ ] `tsconfig.json` is unmodified.
- [ ] No `mockup.html` or `src/mockup.tsx` in the tree — the design harness must not ship.
