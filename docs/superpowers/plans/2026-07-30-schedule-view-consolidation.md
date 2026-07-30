# Schedule View Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse three different week visualisations into one. The attendance calendar's canvas becomes the single week view; the schedule sheet's chart and the preview dialog's pattern strip — two copies of the same self-scaled-bar defect — are both replaced by it.

**Architecture:** A shared `WeekCanvasFrame` owns the header row, hour gutter, grid template and window; each surface renders its own day column into it. Attendance keeps `DayCell` unchanged. `PlannedWeekCanvas` takes a normalised `PlannedDay[]`, so it serves both a dated week and the editor's undated Mon–Sun pattern. It replaces `WeekPatternStrip` in the existing preview dialog. The Attendance schedule sheet loses its chart entirely and becomes a facts popover.

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS v4, `tsx --test` + `node:assert/strict`, `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-07-30-schedule-view-consolidation-design.md` — read it before Task 1. It records why the sheet is being retired rather than redesigned, and carries a do-not-delete list that matters.

**Package root:** all paths below are relative to `dewey_time/frontend/hr_attendance/` unless they start with `dewey_time/`.

## Global Constraints

- **The unit gate is `npm run test:web`, run from the package root.** Baseline: **267 tests, 0 failures**. Paste real counts in every report.
- **`npm run test`, `npm run typecheck`, `npm run lint` DO NOT EXIST.** Only `dev`, `build`, `preview`, `test:web`, `test:e2e`.
- **`npx tsc --noEmit` is already red on `main`** (`tsconfig.json(15,5): error TS5101: Option 'baseUrl' is deprecated`). Accepted baseline. Never edit `tsconfig.json`.
- **A green CI `Frontend` check is not evidence** — its `npm install` is `continue-on-error: true`.
- **`test:web`'s glob covers `src/lib/*.test.ts` and `src/ui/*.test.tsx` only** — not `src/ui/*.test.ts`, not `src/lib/*.test.tsx`, and **not any subdirectory**. Every new file in this plan sits directly in `src/lib/` or `src/ui/` for that reason. **Do not create a `src/ui/schedule/` subfolder, and do not edit the glob in `package.json`.**
- **Nothing typechecks or lints this package**; `noUnusedLocals` is unset. Dead imports ship silently. Work the deletion lists literally.
- **`DayTimeline.test.tsx:13-24` asserts whole `class="…"` strings** via `html.includes`. Never alter an existing band's class string.
- **`WeekDayView.test.tsx:93-100` asserts on that file's raw source text** — must keep matching `/DayCell/`, `/useWeekTimelineWindow/`, `/DayChips/`, `/stepDay/`, and must NOT contain the literal `overflow-x-auto`.
- **Axis chrome stays `aria-hidden` and tooltip-free.** `WeekDayView.test.tsx:42` renders with no `TooltipProvider`.
- **Do not run `npm install`**; do not edit `package.json` or `package-lock.json`. **Do not run `npm run build`** — Task 7 owns the single build.
- **Git:** `git add` only the paths named in your task's commit step. Never `-A`, `.`, or `-u`. Never checkout/switch/branch/stash/reset/rebase/merge/clean/push. Never touch the stash list.
- Commit trailers, every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Hwjg53M2fPQ56z9p2BBThC
  ```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/plannedBlocks.ts` | **create** | Pure: split a scheduled day around its lunch. |
| `src/lib/plannedBlocks.test.ts` | **create** | Unit tests for the above. |
| `src/ui/WeekCanvasFrame.tsx` | **create** | Shared shell: header row, gutter, grid template. |
| `src/ui/WeekView.tsx` | modify | Render through the frame. No visual change. |
| `src/ui/PlannedWeekCanvas.tsx` | **create** | The schedule week, built on the frame. |
| `src/ui/PlannedDayColumn.tsx` | **create** | One day's planned blocks. |
| `src/ui/plannedWeekCanvas.test.tsx` | **create** | Render tests incl. the load-bearing height test. |
| `src/ui/weekCanvasFrame.test.tsx` | **create** | Anti-drift: both surfaces emit the same gutter. |
| `src/ui/SchedulePlanPreviewDialog.tsx` | modify | Swap `WeekPatternStrip` for the canvas; delete `MiniShiftTrack`. |
| `src/lib/plannedDays.ts` + `.test.ts` | **create** | Normalised `PlannedDay` + adapters. |
| `src/ui/WeeklyScheduleSummary.tsx` | **create** (from `WeeklyScheduleSheet.tsx`) | Facts popover. |
| `src/ui/WeeklyScheduleSheet.tsx` | **delete** | Superseded. |
| `src/ui/WeekScheduleGantt.tsx` | **delete** | The chart being retired. |
| `src/ui/EmployeePicker.tsx` | modify | Point the toolbar button at the summary. |
| `src/ui/weeklyScheduleSummary.test.tsx` | **create** | Facts shown; no blocks shown. |
| `src/lib/weekSchedule.ts` | modify | Delete six dead exports. |
| `src/lib/weekSchedule.test.ts` | modify | Delete their test + import. |
| `dewey_time/public/hr_attendance/**` | rebuild | Task 7 only. |

**Order:** T1 and T2 are independent. T3 needs both. T4 needs T3. T5 and T6 need T3 (the replacement must exist before the original goes). T7 is last, once.

---

### Task 1: `plannedBlocks`

**Files:**
- Create: `src/lib/plannedBlocks.ts`
- Test: `src/lib/plannedBlocks.test.ts`

**Interfaces:**
- Consumes: `WeekDaySchedule` from `@/lib/weekSchedule`.
- Produces: `plannedBlocks(day: WeekDaySchedule): Array<{ startMin: number; endMin: number }>`. Task 3 imports it.

**Context:** Today the schedule view draws lunch as a notch floored at `Math.max(10, …)` inside a fixed-height pill. This helper replaces that with real intervals, so lunch becomes an actual gap between two blocks and breaks line up across days on a shared axis.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/plannedBlocks.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { plannedBlocks } from "./plannedBlocks";
import type { WeekDaySchedule } from "./weekSchedule";

const H = (h: number) => h * 60;

function day(over: Partial<WeekDaySchedule>): WeekDaySchedule {
  return {
    date: "2026-07-27",
    weekday: "Mon",
    weekdayLong: "Monday",
    dayNum: "27",
    monthLabel: "Jul",
    shift: { shift_assigned: true },
    assigned: true,
    ...over,
  } as WeekDaySchedule;
}

test("an interior lunch splits the shift into two blocks", () => {
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(12), lunchEndMin: H(13) })),
    [
      { startMin: H(8), endMin: H(12) },
      { startMin: H(13), endMin: H(17) },
    ],
  );
});

test("no lunch means one block", () => {
  assert.deepEqual(plannedBlocks(day({ startMin: H(8), endMin: H(12) })), [
    { startMin: H(8), endMin: H(12) },
  ]);
});

test("a lunch touching either edge does not create a zero-width fragment", () => {
  const atStart = plannedBlocks(
    day({ startMin: H(8), endMin: H(17), lunchStartMin: H(8), lunchEndMin: H(9) }),
  );
  assert.deepEqual(atStart, [{ startMin: H(8), endMin: H(17) }]);

  const atEnd = plannedBlocks(
    day({ startMin: H(8), endMin: H(17), lunchStartMin: H(16), lunchEndMin: H(17) }),
  );
  assert.deepEqual(atEnd, [{ startMin: H(8), endMin: H(17) }]);
});

test("an inverted or zero-length lunch is ignored", () => {
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(13), lunchEndMin: H(12) })),
    [{ startMin: H(8), endMin: H(17) }],
  );
  assert.deepEqual(
    plannedBlocks(day({ startMin: H(8), endMin: H(17), lunchStartMin: H(12), lunchEndMin: H(12) })),
    [{ startMin: H(8), endMin: H(17) }],
  );
});

test("an unassigned day has no blocks", () => {
  assert.deepEqual(plannedBlocks(day({ assigned: false })), []);
});

test("a day missing its bounds has no blocks", () => {
  assert.deepEqual(plannedBlocks(day({ startMin: undefined, endMin: undefined })), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web`
Expected: FAIL — `Cannot find module './plannedBlocks'`.

- [ ] **Step 3: Write the module**

Create `src/lib/plannedBlocks.ts`:

```ts
import type { WeekDaySchedule } from "@/lib/weekSchedule";

export type PlannedBlock = { startMin: number; endMin: number };

/**
 * A scheduled day as drawable intervals, with lunch removed rather than drawn.
 *
 * Returning two blocks instead of one block plus a notch is what lets breaks
 * line up vertically across days on a shared axis — the old fixed-height pill
 * positioned its notch against each day's own span, so "halfway down" meant a
 * different clock time on every row.
 *
 * A lunch that touches either bound is ignored: clipping it would leave a
 * zero-length fragment, and a break at the very start or end of a shift is
 * indistinguishable from a shorter shift anyway.
 */
export function plannedBlocks(day: WeekDaySchedule): PlannedBlock[] {
  if (!day.assigned || day.startMin == null || day.endMin == null) return [];
  const { startMin, endMin, lunchStartMin: ls, lunchEndMin: le } = day;
  if (endMin <= startMin) return [];

  const interior = ls != null && le != null && le > ls && ls > startMin && le < endMin;
  if (!interior) return [{ startMin, endMin }];

  return [
    { startMin, endMin: ls! },
    { startMin: le!, endMin },
  ];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:web`
Expected: PASS, 6 new tests (267 → 273). Paste totals.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plannedBlocks.ts src/lib/plannedBlocks.test.ts
git commit -m "feat(hr-schedule): split a scheduled day around its lunch"
```

---

### Task 2: Extract `WeekCanvasFrame`

**Files:**
- Create: `src/ui/WeekCanvasFrame.tsx`
- Modify: `src/ui/WeekView.tsx`

**Interfaces:**
- Consumes: `HourGutter` from `@/ui/TimelineAxis`; `AxisWindow` from `@/lib/timelineAxis`.
- Produces:
  ```ts
  export function WeekCanvasFrame(props: {
    weekDates: Date[];
    window: AxisWindow | null;
    renderHeader: (date: Date) => ReactNode;
    renderDay: (date: Date) => ReactNode;
    ariaLabel?: string;
  }): JSX.Element
  ```
  Task 3 renders `PlannedDayColumn` through it.

**Context:** The `grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]` template currently appears twice in `WeekView.tsx` and twice more in `AttendanceLoading.tsx`. Centralising it is what makes the two surfaces unable to drift apart — which is the whole complaint this plan answers.

**This task must produce no visual change to Attendance.** `WeekView`'s existing tests are the proof.

- [ ] **Step 1: Create the frame**

Create `src/ui/WeekCanvasFrame.tsx`:

```tsx
import type { ReactNode } from "react";
import { format } from "date-fns";

import type { AxisWindow } from "@/lib/timelineAxis";
import { HourGutter } from "@/ui/TimelineAxis";

/**
 * The week canvas shell: a labelled hour gutter and seven day slots on one
 * shared axis.
 *
 * Both week surfaces render through this. That is deliberate and load-bearing:
 * the attendance timeline and the schedule week previously used different
 * layouts, different time axes and different densities, and nothing structural
 * stopped them diverging. A single frame makes their agreement a property of
 * the code rather than of whoever edits it next.
 */
export function WeekCanvasFrame(props: {
  weekDates: Date[];
  window: AxisWindow | null;
  renderHeader: (date: Date) => ReactNode;
  renderDay: (date: Date) => ReactNode;
  ariaLabel?: string;
}) {
  const cols = "grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
        <div className={`grid shrink-0 ${cols} border-b border-border/60`}>
          <div aria-hidden="true" />
          {props.weekDates.map((d) => (
            <div key={format(d, "yyyy-MM-dd")} className="contents">
              {props.renderHeader(d)}
            </div>
          ))}
        </div>

        {/* No vertical scroll: the axis is scaled to fit this box. See #78. */}
        <div className="relative min-h-0 flex-1 overflow-hidden" aria-label={props.ariaLabel}>
          <div className={`grid h-full ${cols}`}>
            <HourGutter window={props.window} />
            {props.weekDates.map((d) => (
              <div key={format(d, "yyyy-MM-dd")} className="contents">
                {props.renderDay(d)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Both wrappers carry `className="contents"`, and for two different reasons.** `display: contents`
generates no box, so the rendered cell — not the wrapper — stays the direct grid item.

- **Day row:** `DayCell`'s root is a `<button>`, inline-level, which collapses to a narrow sliver
  unless it is itself the grid item. That was issue #71, documented at `WeekDayView.tsx:141`.
- **Header row:** the header cell relies on `align-self: stretch` to make its off-day
  (`bg-destructive/[0.06]`) and holiday (`bg-muted/40`) tint fill the full row height. Header cells
  differ in height — a holiday line, a clock total, 0–N chips — so with a plain wrapper the tint on
  short columns like Sat/Sun stops short of the row bottom.

Neither failure is catchable by the test suite: jsdom has no layout engine, so all four `WeekView`
test files stay green through both. This note exists because the first draft of this plan omitted
the header wrapper's `contents` and the implementer caught it before writing any code.

- [ ] **Step 2: Render `WeekView` through it**

In `src/ui/WeekView.tsx`, replace the outer JSX with a `<WeekCanvasFrame>` call. The header cell body and the `<DayCell …>` call move verbatim into `renderHeader` and `renderDay` — do not retype them, and do not change a single class string inside them. Add `import { WeekCanvasFrame } from "@/ui/WeekCanvasFrame";`.

`renderDay` returns exactly the `<DayCell … />` element that exists today, with all its current props.

- [ ] **Step 3: Run the tests**

Run: `npm run test:web`
Expected: **273 passing, unchanged from Task 1.** Any failure here means the refactor altered rendering — `weekTimelineScroll.test.tsx`, `offSiteSegment.test.tsx`, `timelineAxis.test.tsx` and `DayTimeline.test.tsx` all render `WeekView` and are your regression net. Paste totals.

- [ ] **Step 4: Commit**

```bash
git add src/ui/WeekCanvasFrame.tsx src/ui/WeekView.tsx
git commit -m "refactor(hr-attendance): extract the shared week canvas frame"
```

---

### Task 3: `PlannedWeekCanvas`

**Files:**
- Create: `src/ui/PlannedDayColumn.tsx`, `src/ui/PlannedWeekCanvas.tsx`
- Test: `src/ui/plannedWeekCanvas.test.tsx`, `src/ui/weekCanvasFrame.test.tsx`

**Interfaces:**
- Consumes: `plannedBlocks` (Task 1); `WeekCanvasFrame` (Task 2); `HourGrid`, `pctOfWindow`, `resolveWeekTimelineWindow`, `buildWeekSchedule`, `formatScheduleDuration`, `shortShiftTypeCode`.
- Produces: `PlannedWeekCanvas({ days, window })` where `days: PlannedDay[]` — a normalised, source-agnostic week. Task 4 feeds it from the editor's `WeekPattern`; a dated adapter exists for any future caller. `PlannedDay` and both adapters live in `src/lib/plannedDays.ts`.

**Context:** This is the defect being fixed. Today a 4-hour day and an 11-hour day render as identical pills. The load-bearing test below asserts they do not.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/plannedWeekCanvas.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { PlannedWeekCanvas } from "./PlannedWeekCanvas";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

type Spec = { start: string; end: string; lunch?: [string, string] } | "off" | "leave";

function week(specs: Spec[]): Map<string, Day> {
  return new Map(
    WEEK.map((d, i) => {
      const date = format(d, "yyyy-MM-dd");
      const s = specs[i] ?? "off";
      if (s === "off") return [date, { date, shift: { shift_assigned: false } } as unknown as Day];
      if (s === "leave") {
        return [
          date,
          {
            date,
            shift: { shift_assigned: false },
            leave: { on_leave: true, leave_type: "Annual Leave" },
          } as unknown as Day,
        ];
      }
      return [
        date,
        {
          date,
          shift: {
            shift_assigned: true,
            shift_type: "FT",
            start_time: s.start,
            end_time: s.end,
            lunch_start: s.lunch?.[0] ?? null,
            lunch_end: s.lunch?.[1] ?? null,
          },
        } as unknown as Day,
      ];
    }),
  );
}

function render(days: Map<string, Day>): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PlannedWeekCanvas weekDates={WEEK} daysByDate={days} />
    </TooltipProvider>,
  );
}

/** Every `height:N%` in source order. */
function heights(html: string): number[] {
  return [...html.matchAll(/height:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

test("shifts of different duration render blocks of different height", () => {
  // THE defect. The old day-card list drew a fixed h-[4.5rem] pill for every
  // day, so a 4-hour shift and an 11-hour shift were pixel-identical. If this
  // assertion ever passes trivially, the canvas has stopped encoding duration.
  const html = render([
    { start: "08:00:00", end: "12:00:00" }, // 4h
    { start: "06:00:00", end: "17:00:00" }, // 11h
  ]);
  const [short, long] = heights(html);
  assert.ok(short != null && long != null, "expected two blocks");
  assert.ok(long! > short! * 2, `11h block (${long}%) must dwarf the 4h one (${short}%)`);
});

test("a late shift starts lower on the axis than an early one", () => {
  const html = render([
    { start: "08:00:00", end: "16:00:00" },
    { start: "13:00:00", end: "21:00:00" },
  ]);
  const tops = [...html.matchAll(/top:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
  const blockTops = tops.filter((t) => t > 0);
  assert.ok(blockTops.length >= 2, "expected two positioned blocks");
  assert.ok(
    Math.max(...blockTops) > Math.min(...blockTops),
    "the 13:00 shift must sit below the 08:00 one",
  );
});

test("lunch renders as a gap between two blocks, not a notch", () => {
  const one = render([{ start: "08:00:00", end: "17:00:00" }]);
  const two = render([
    { start: "08:00:00", end: "17:00:00", lunch: ["12:00:00", "13:00:00"] },
  ]);
  assert.equal(heights(one).length, 1, "no lunch → one block");
  assert.equal(heights(two).length, 2, "lunch → two blocks");
});

test("off and leave days render their state and no block", () => {
  const html = render(["off", "leave"]);
  assert.match(html, /Day off/);
  assert.match(html, /Annual Leave/);
  assert.equal(heights(html).length, 0);
});
```

Create `src/ui/weekCanvasFrame.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../components/ui/tooltip";
import { WeekView } from "./WeekView";
import { PlannedWeekCanvas } from "./PlannedWeekCanvas";
import type { Day } from "../types/calendar";

const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

function scheduledWeek(): Map<string, Day> {
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
          checkins: [],
        } as unknown as Day,
      ];
    }),
  );
}

const labels = (html: string) => [...html.matchAll(/>(\d{1,2} [AP]M)</g)].map((m) => m[1]);

test("both week surfaces put the same hours on the axis", () => {
  // The anti-drift guard. These two views previously used different layouts,
  // different time axes and different densities; sharing WeekCanvasFrame is
  // what stops that recurring, and this is the assertion that notices if it does.
  const days = scheduledWeek();
  const attendance = renderToStaticMarkup(
    <TooltipProvider>
      <WeekView
        weekDates={WEEK}
        daysByDate={days}
        alertsByDate={new Map()}
        syncByDate={new Map()}
        onInspectDay={() => {}}
        onInspectFlag={() => {}}
      />
    </TooltipProvider>,
  );
  const schedule = renderToStaticMarkup(
    <TooltipProvider>
      <PlannedWeekCanvas weekDates={WEEK} daysByDate={days} />
    </TooltipProvider>,
  );

  assert.ok(labels(attendance).length > 0, "attendance rendered no hour labels");
  assert.deepEqual(labels(schedule), labels(attendance));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:web`
Expected: FAIL — `Cannot find module './PlannedWeekCanvas'`.

- [ ] **Step 3: Write `PlannedDayColumn`**

Create `src/ui/PlannedDayColumn.tsx`:

```tsx
import { plannedBlocks } from "@/lib/plannedBlocks";
import { pctOfWindow, type AxisWindow } from "@/lib/timelineAxis";
import { formatScheduleDuration, shortShiftTypeCode, type WeekDaySchedule } from "@/lib/weekSchedule";
import { cn } from "@/lib/utils";
import { AppTooltip } from "@/ui/AppTooltip";
import { HourGrid } from "@/ui/TimelineAxis";

/** One day of the planned week. Mirrors DayCell's shape without its punch machinery. */
export function PlannedDayColumn(props: {
  day: WeekDaySchedule;
  window: AxisWindow | null;
  isToday: boolean;
}) {
  const { day } = props;
  const blocks = props.window ? plannedBlocks(day) : [];
  const tip = [
    shortShiftTypeCode(day.shiftType),
    day.timeLabel,
    day.lunchLabel ? `lunch ${day.lunchLabel}` : null,
    day.durationMin ? `${formatScheduleDuration(day.durationMin)} net` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "relative min-h-0 border-b border-r border-border/60 p-3 pl-5",
        props.isToday && "bg-primary/3 ring-1 ring-primary/20",
      )}
    >
      <div className="relative h-full rounded-xl bg-muted/25">
        <HourGrid window={props.window} />

        {day.onLeave ? (
          <div className="absolute inset-0 flex items-center justify-center px-2">
            <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-brand-accent">
              {day.leaveType ?? "On leave"}
            </span>
          </div>
        ) : !day.assigned ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Day off</span>
          </div>
        ) : null}

        {blocks.map((b, i) => {
          const top = pctOfWindow(b.startMin, props.window!);
          const height = pctOfWindow(b.endMin, props.window!) - top;
          if (height <= 0) return null;
          return (
            <AppTooltip key={i} side="right" content={tip || "Scheduled"}>
              <div
                /* Outlined, not filled: planned time must never be mistaken for
                   the solid blocks the attendance canvas uses for real punches. */
                className="absolute inset-x-2 rounded-sm border border-primary/45 bg-primary/12"
                style={{ top: `${top}%`, height: `${height}%`, minHeight: 3 }}
              />
            </AppTooltip>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `PlannedWeekCanvas`**

Create `src/ui/PlannedWeekCanvas.tsx`:

```tsx
import { format, isSameDay } from "date-fns";

import { buildWeekSchedule, formatScheduleDuration } from "@/lib/weekSchedule";
import { resolveWeekTimelineWindow } from "@/lib/weekTimelineWindow";
import type { Day } from "@/types/calendar";
import { PlannedDayColumn } from "@/ui/PlannedDayColumn";
import { WeekCanvasFrame } from "@/ui/WeekCanvasFrame";

/**
 * The scheduled week, on the same canvas as the attendance timeline.
 *
 * The window comes from resolveWeekTimelineWindow, which already derives from
 * assigned shift bounds — exactly what a planned view wants, and the reason the
 * two surfaces cannot land on different scales.
 */
export function PlannedWeekCanvas(props: { weekDates: Date[]; daysByDate: Map<string, Day> }) {
  const week = buildWeekSchedule(props.weekDates, props.daysByDate);
  const window = resolveWeekTimelineWindow(props.weekDates, props.daysByDate);
  const byDate = new Map(week.map((d) => [d.date, d]));

  return (
    <WeekCanvasFrame
      weekDates={props.weekDates}
      window={window}
      ariaLabel="Weekly expected schedule"
      renderHeader={(d) => {
        const day = byDate.get(format(d, "yyyy-MM-dd"));
        return (
          <div className="px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">{day?.weekday}</span>
              <span className="text-sm font-semibold">{day?.dayNum}</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] tabular-nums text-muted-foreground">
              {day?.durationMin ? `${formatScheduleDuration(day.durationMin)} net` : " "}
            </div>
          </div>
        );
      }}
      renderDay={(d) => {
        const day = byDate.get(format(d, "yyyy-MM-dd"));
        if (!day) return null;
        return (
          <PlannedDayColumn day={day} window={window} isToday={isSameDay(d, new Date())} />
        );
      }}
    />
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:web`
Expected: PASS, 5 new tests (273 → 278). Paste totals.

**Before moving on, prove the load-bearing test bites:** temporarily give every block a fixed `height: 20%` instead of the computed one, re-run, and confirm the "different duration" test fails. Restore. Report what you saw — without that check the test may be asserting something that passes regardless.

- [ ] **Step 6: Commit**

```bash
git add src/ui/PlannedDayColumn.tsx src/ui/PlannedWeekCanvas.tsx src/ui/plannedWeekCanvas.test.tsx src/ui/weekCanvasFrame.test.tsx
git commit -m "feat(hr-schedule): draw the planned week on the shared calendar canvas"
```

---

### Task 4: Replace the preview dialog's strip

**Files:**
- Modify: `src/ui/SchedulePlanPreviewDialog.tsx`
- Create: `src/lib/plannedDays.ts` + `src/lib/plannedDays.test.ts`

**Interfaces:**
- Consumes: `PlannedWeekCanvas` (Task 3); `WeekPattern` from the schedule libs.
- Produces: `plannedDaysFromWeekPattern(pattern: WeekPattern): PlannedDay[]`.

**Context:** The Schedule page already has a week view — `WeekPatternStrip` inside the "Weekly
schedule preview" dialog, driven by `weekPattern`. Its `MiniShiftTrack` (`:141-160`) repeats the
Gantt's defect exactly: a fixed `h-14 w-2` bar whose lunch is positioned against
`span = endMin - startMin`, so every day is scaled to itself. Two files, one broken idea.

This task swaps that strip for the canvas. **No new data dependency** — the dialog is already
wired to the editor's live pattern.

- [ ] **Step 1: Write the adapter's failing tests**

Create `src/lib/plannedDays.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { plannedDaysFromWeekPattern } from "./plannedDays";
import type { WeekPattern, WeekPatternDay } from "../types/schedule";

const H = (h: number) => h * 60;

function pattern(...days: Partial<WeekPatternDay>[]): WeekPattern {
  return {
    frequency: "Weekly",
    days: days.map((d, i) => ({
      weekday: (["Monday", "Tuesday", "Wednesday"] as const)[i]!,
      works: true,
      ...d,
    })) as WeekPatternDay[],
  };
}

test("a working weekday carries its minute bounds", () => {
  const [day] = plannedDaysFromWeekPattern(
    pattern({
      start_time: "08:00:00",
      end_time: "17:00:00",
      lunch_start: "12:00:00",
      lunch_end: "13:00:00",
    }),
  );
  assert.equal(day!.works, true);
  assert.equal(day!.startMin, H(8));
  assert.equal(day!.endMin, H(17));
  assert.equal(day!.lunchStartMin, H(12));
  assert.equal(day!.lunchEndMin, H(13));
  assert.equal(day!.label, "Mon", "three-letter label for an undated pattern");
  assert.equal(day!.sublabel, undefined, "an undated pattern has no day number");
});

test("a non-working weekday has no bounds", () => {
  const [day] = plannedDaysFromWeekPattern(pattern({ works: false, start_time: "08:00:00" }));
  assert.equal(day!.works, false);
  assert.equal(day!.startMin, undefined);
});

test("unparseable or absent times degrade to no bounds rather than throwing", () => {
  const [a, b] = plannedDaysFromWeekPattern(
    pattern({ start_time: "not a time", end_time: null }, { start_time: null, end_time: null }),
  );
  assert.equal(a!.works, true);
  assert.equal(a!.startMin, undefined);
  assert.equal(b!.startMin, undefined);
});

test("every weekday in the pattern produces exactly one day, in order", () => {
  const days = plannedDaysFromWeekPattern(pattern({}, {}, {}));
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.label), ["Mon", "Tue", "Wed"]);
});
```

`WeekPatternDay` is `{ weekday, works, start_time?, end_time?, lunch_start?, lunch_end?,
grace_minutes? }` (`src/types/schedule.ts:13-21`); `WeekPattern` is `{ frequency, days }`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web` — FAIL, module not found.

- [ ] **Step 3: Write the adapter**

Create `src/lib/plannedDays.ts` exporting `plannedDaysFromWeekPattern`. Use the dialog's existing
`timeToMinutes` helper's logic; if it is local to `SchedulePlanPreviewDialog.tsx`, move it into
`plannedDays.ts` and import it back rather than duplicating it.

`key` is the weekday name, `label` is `weekday.slice(0, 3)`, `sublabel` is omitted — an undated
pattern has no day numbers.

- [ ] **Step 4: Swap the strip for the canvas**

In `src/ui/SchedulePlanPreviewDialog.tsx`, replace `<WeekPatternStrip pattern={props.weekPattern} />`
(`:50`) with the canvas fed by the adapter, in a bounded-height box (`h-[22rem]` suits the
dialog's `max-h-[min(70dvh,32rem)]` body).

Then delete `WeekPatternStrip`, `DayColumn`, `MiniShiftTrack` and `clampPct` from that file, plus
any imports they alone used — check `formatTimeInput`, `timeToMinutes` and `cn` for other
consumers in the file before removing them.

- [ ] **Step 5: Verify nothing dangles**

Run: `grep -n "WeekPatternStrip\|MiniShiftTrack\|clampPct" src/ui/SchedulePlanPreviewDialog.tsx`
Expected: no matches.

- [ ] **Step 6: Run the tests**

Run: `npm run test:web`. Paste totals.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plannedDays.ts src/lib/plannedDays.test.ts src/ui/SchedulePlanPreviewDialog.tsx
git commit -m "feat(hr-schedule): the weekly preview draws on the shared canvas"
```

---

### Task 5: Retire the Attendance chart

**Files:**
- Create: `src/ui/WeeklyScheduleSummary.tsx`
- Delete: `src/ui/WeeklyScheduleSheet.tsx`, `src/ui/WeekScheduleGantt.tsx`
- Modify: `src/ui/EmployeePicker.tsx`
- Test: `src/ui/weeklyScheduleSummary.test.tsx`

**Interfaces:** `WeeklyScheduleSummary` takes the same props `WeeklyScheduleSheet` does today, minus nothing — read its prop type and keep it.

**Context:** The attendance canvas already draws the assigned schedule (dashed bands for today and future, missing-expected for past, and the axis window is itself shift-derived). The sheet's chart is a duplicate in a second visual language. What survives is only what the calendar cannot express.

- [ ] **Step 1: Write the failing test**

Create `src/ui/weeklyScheduleSummary.test.tsx`, following `offSiteSegment.test.tsx`'s fixture and
`renderToStaticMarkup` idiom. Build a five-day 08:00–17:00 week with a one-hour lunch (so the
expected total is a round 40h) plus one off day and one leave day, render
`<WeeklyScheduleSummary open … />`, and assert:

```tsx
test("the summary states what the calendar cannot show", () => {
  const html = render();
  assert.match(html, /40h/, "expected-hours total");
  assert.match(html, /5/, "working days");
});

test("the summary renders no shift blocks — the chart lives on the canvas now", () => {
  // The guard against the chart creeping back in. These three patterns are the
  // block treatments used by the canvas and by the two retired strips.
  const html = render();
  assert.doesNotMatch(html, /border-primary\/45/, "canvas block");
  assert.doesNotMatch(html, /h-\[4\.5rem\]/, "old Gantt pill");
  assert.doesNotMatch(html, /h-14 w-2/, "old preview mini-track");
});
```

Adapt the exact expected-hours string to whatever `formatScheduleDuration` produces for 2400
minutes — run it once and use the real output rather than guessing.

- [ ] **Step 2: Build the summary**

Copy `WeeklyScheduleSheet.tsx` to `WeeklyScheduleSummary.tsx`, then:

- swap `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetDescription` for `Popover`/`PopoverTrigger`/`PopoverContent` (`@/components/ui/popover`, already used by `EmployeePicker`);
- **delete the `<WeekScheduleGantt …>` render and its import**;
- keep the name, range label, coverage, `summaryLine`, and the `status.tone === "warn"` block;
- lay the facts out as a definition list: expected hours, working days, days off, leave, assignment id + coverage range.

Delete `src/ui/WeeklyScheduleSheet.tsx` and `src/ui/WeekScheduleGantt.tsx`.

- [ ] **Step 3: Rewire the trigger**

In `src/ui/EmployeePicker.tsx`, the `ScheduleAccessButton` (`:132-137`) becomes the `PopoverTrigger`. Keep its `CalendarDaysIcon`, its `aria-label="View weekly schedule"`, and its tooltip text. Replace the `<WeeklyScheduleSheet …>` mount with `<WeeklyScheduleSummary …>`.

- [ ] **Step 4: Verify nothing references the deleted files**

Run: `grep -rn "WeekScheduleGantt\|WeeklyScheduleSheet" src`
Expected: no matches. Nothing typechecks this package, so this grep is the only automated check.

- [ ] **Step 5: Run the tests**

Run: `npm run test:web`
Expected: green with the new summary tests. Paste totals.

- [ ] **Step 6: Commit**

```bash
git add src/ui/WeeklyScheduleSummary.tsx src/ui/weeklyScheduleSummary.test.tsx src/ui/EmployeePicker.tsx
git rm src/ui/WeeklyScheduleSheet.tsx src/ui/WeekScheduleGantt.tsx
git commit -m "refactor(hr-attendance): the schedule panel keeps the facts, drops the chart"
```

---

### Task 6: Delete the dead Gantt helpers

**Files:**
- Modify: `src/lib/weekSchedule.ts`, `src/lib/weekSchedule.test.ts`

**Context:** These were written for a shared-axis Gantt that never shipped. The new canvas uses `resolveWeekTimelineWindow` and `timelineAxis.ts` instead.

- [ ] **Step 1: Delete**

From `src/lib/weekSchedule.ts` remove: `computeWeekGanttWindow`, `minuteToWeekGanttPct`, `formatGanttAxisHour`, the `WeekGanttWindow` type, and the `SCHEDULE_DAY_START_MIN` / `SCHEDULE_DAY_END_MIN` constants (verified: no other consumers).

From `src/lib/weekSchedule.test.ts` remove the `computeWeekGanttWindow` test (`~:101-115`) and its named import (`:7`).

**Do not remove** `formatShiftTime12h` (used by `WeeklyScheduleTemplatePickerDialog.tsx`), `formatWeekRangeLabel` (used by `AttendanceToolbar.tsx`), or `shortShiftTypeCode` (now used by `PlannedDayColumn`).

- [ ] **Step 2: Verify**

Run: `grep -rn "computeWeekGanttWindow\|minuteToWeekGanttPct\|formatGanttAxisHour\|WeekGanttWindow\|SCHEDULE_DAY_" src`
Expected: no matches.

- [ ] **Step 3: Run the tests**

Run: `npm run test:web`
Expected: green, one test fewer. Paste totals.

- [ ] **Step 4: Commit**

```bash
git add src/lib/weekSchedule.ts src/lib/weekSchedule.test.ts
git commit -m "refactor(hr-schedule): remove the Gantt helpers that never shipped"
```

---

### Task 7: Build and commit the assets

**Files:** `dewey_time/public/hr_attendance/**`, `dewey_time/www/hr-{attendance,schedule}.html`

**Context:** Frappe Cloud cannot build this SPA — `@lolbikb/dewey-ui` is private and a fresh `npm install` returns 401. Whatever is committed is what ships. A PR that changes `frontend/` without the bundle ships **nothing**; that happened across #58–#74.

`node_modules` is already present. **Do not run `npm install`.**

- [ ] **Step 1: Full test run**

Run: `npm run test:web` — must be green. Paste totals. Do not build on red.

- [ ] **Step 2: Build once**

Run: `npm run build`

Once only. `emptyOutDir: true` plus a fresh `build-id.txt` timestamp on every invocation means a second run is pure churn.

- [ ] **Step 3: Confirm the diff is real**

Run: `git status --porcelain dewey_time/public/hr_attendance dewey_time/www`

Then prove the new feature is in the bundle:

```bash
grep -c "Resulting week" dewey_time/public/hr_attendance/assets/index.js
```

Expected: ≥ 1. If the only changes are `build-id.txt` and `?v=` query strings, revert with `git checkout -- dewey_time/public/hr_attendance dewey_time/www` and report it — that would mean the source changes never took effect.

- [ ] **Step 4: Commit**

```bash
git add dewey_time/public/hr_attendance/ dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html
git commit -m "build(hr-attendance): ship the consolidated schedule canvas"
```

---

## Verification checklist

- [ ] `npm run test:web` green, counts pasted. 267 → roughly 283.
- [ ] `grep -rn "WeekScheduleGantt\|WeeklyScheduleSheet\|WeekPatternStrip\|MiniShiftTrack" src` → nothing.
- [ ] `grep -rn "computeWeekGanttWindow\|minuteToWeekGanttPct\|formatGanttAxisHour\|WeekGanttWindow\|SCHEDULE_DAY_" src` → nothing.
- [ ] `formatShiftTime12h`, `formatWeekRangeLabel` and `shortShiftTypeCode` all still exist and still have consumers.
- [ ] The duration test was proven to fail against a fixed block height.
- [ ] `tsconfig.json` and `package.json` unmodified.
- [ ] Bundle committed and contains the new strings.
- [ ] No `mockup*.html` or `src/mockup*.tsx` in the tree.
