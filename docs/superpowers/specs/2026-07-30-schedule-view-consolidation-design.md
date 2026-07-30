# Employee schedule view: one canvas, one axis — design

**Date:** 2026-07-30
**Status:** approved, ready for planning

## Goal

The two week views in this app feel like different products. Make the schedule view speak the
same visual language as the attendance calendar, put it on the page where schedules are actually
authored, and delete the duplicate that no longer earns its place.

## The problem, measured

Both surfaces were rendered against one deliberately varied fixture week — Mon 8h, Tue **4h**,
Wed **11h net starting 06:00**, Thu **8h but 13:00–21:00**, Fri 8h, Sat off, Sun leave.

### The schedule bars encode nothing

`WeekScheduleGantt` is not a Gantt. It is a vertical list of day cards, and each card's
`VerticalShiftTrack` is a **fixed `h-[4.5rem]` pill** whose lunch notch is positioned against
*that day's own* start→end span (`WeekScheduleGantt.tsx:146-151`). Consequences, all confirmed by
rendering:

- A 4-hour day and an 11-hour day produce **pixel-identical bars**. Duration exists only in text.
- A 13:00 start looks exactly like an 08:00 start. Time-of-day is not encoded at all.
- Lunch at "halfway down" means a different clock time on every row, so breaks cannot be compared.
- `Math.max(10, lunchHeight)` floors the notch — the same proportional-floor lie removed from the
  attendance timeline in #83.

### The two surfaces disagree structurally

| | `/hr-attendance` | schedule sheet |
|---|---|---|
| week axis | horizontal, 7 columns | vertical, 7 stacked rows |
| time axis | labelled hours + gridlines | none |
| a week's height | 620px, no scroll | ~940px, scrolls |
| leave | red chip | palm-tree card |

### The real Gantt was designed and never wired

`computeWeekGanttWindow`, `minuteToWeekGanttPct`, `formatGanttAxisHour`, `WeekGanttWindow`,
`SCHEDULE_DAY_START_MIN` and `SCHEDULE_DAY_END_MIN` have **no production consumers** — only
`weekSchedule.test.ts:101-115` keeps them alive. Someone intended a shared-axis week Gantt; it
never landed, and the placeholder shipped instead.

### And the page that needs it doesn't have it

`/hr-schedule` renders no week view at all. On the page where you author the schedule you cannot
see the schedule; you switch to `/hr-attendance` to check your own work.

## The decisive finding

**Attendance already draws the assigned schedule.** Rendering a future week with zero punches
shows the complete plan as dashed blocks on the hour axis, with lunch as a real gap —
`deriveScheduledFutureIntervals` for today and future days, `missingExpected` for the unmet part
of past days, and since #83 the axis window is itself derived from the assigned shift bounds.

So the sheet's chart is a worse duplicate of something already on screen, in a second visual
language, behind a button. That reframes the work from "redesign the sheet" to "retire it".

## Design

### 1. `WeekCanvasFrame` — the shared shell

New `src/ui/WeekCanvasFrame.tsx`, extracted from `WeekView`'s existing structure: the header row,
the `3.5rem` gutter column, the seven day slots, the grid template, and the window. It renders
`HourGutter` and owns the `grid-cols-[3.5rem_repeat(7,minmax(…,1fr))]` template that currently
appears in `WeekView.tsx` twice and `AttendanceLoading.tsx` twice.

Consumers pass a `renderDay(date, index)` prop and their own header cell renderer.

**This extraction is the actual fix.** The complaint is inconsistency; a shared frame makes
consistency structural instead of a thing someone has to remember. Two surfaces that both import
the frame cannot drift into different column templates, different gutter widths, or different
axis treatments.

`WeekView` keeps rendering `DayCell` into it. Nothing about the attendance surface changes
visually — this is a refactor there, and its existing tests are the proof.

### 2. `PlannedWeekCanvas` — the schedule week

New `src/ui/PlannedWeekCanvas.tsx` and `src/ui/PlannedDayColumn.tsx`, driven by
`WeekDaySchedule[]` from the existing `buildWeekSchedule`.

- **Window** from `resolveWeekTimelineWindow` — already shift-derived and hour-quantized, which is
  exactly what a planned view wants. No new window rule.
- **Blocks** are outlined rather than filled: `border border-primary/45 bg-primary/12`. Planned is
  deliberately weaker than the solid fill attendance uses for observed punches, so the two can
  never be mistaken for each other if they ever appear side by side.
- **Lunch splits the block in two.** A pure helper `plannedBlocks(day)` in `src/lib/plannedBlocks.ts`
  returns one interval, or two
  when a valid interior lunch exists. Breaks then line up vertically across days, which is
  information the current design cannot express at all.
- **Day off** and **leave** are column states reusing attendance's existing language.
- Net hours per day sit in the column header, scannable across the week.
- The shift-type code (`shortShiftTypeCode`) and exact times go in the block's tooltip, matching
  how attendance segments already behave. `AppTooltip` handles touch.

Mounted in `WeeklySchedulePage`'s existing `Section` (`:406-473`), beneath the "Shift blocks"
editor, under a "Resulting week" label — so editing a pattern updates the week in view.

### 3. Attendance keeps the facts, loses the chart

`WeekScheduleGantt.tsx` is deleted in full (204 lines).

`WeeklyScheduleSheet` becomes `WeeklyScheduleSummary`: the same `CalendarDaysIcon` trigger in
`EmployeePicker` (`:132-137`), `Sheet` → `Popover`, and content limited to what the calendar
**cannot** express:

| fact | source |
|---|---|
| pattern label — "Mon–Fri, mixed shifts" | `describeWeekSchedulePattern` |
| work / off / leave counts, expected hours | `summarizeWeekSchedule` |
| Shift Schedule Assignment id and coverage range | `formatScheduleCoverage` |
| assignment status | `shiftScheduleStatus` |
| "Superseded in ERP" warning | `shift.schedule_superseded` |

Shift blocks, times and lunch are **removed** from this panel — they are on the canvas behind it.

### 4. Deletions

| delete | why |
|---|---|
| `src/ui/WeekScheduleGantt.tsx` | replaced; sole consumer is the sheet |
| `computeWeekGanttWindow`, `minuteToWeekGanttPct`, `formatGanttAxisHour`, `WeekGanttWindow` | dead; the new canvas uses `resolveWeekTimelineWindow` + `timelineAxis.ts` |
| `SCHEDULE_DAY_START_MIN`, `SCHEDULE_DAY_END_MIN` | verified no other consumers |
| `weekSchedule.test.ts:101-115` + its import at `:7` | tests only the above |

**Do not delete these — they look adjacent and are live:**

- `formatShiftTime12h` — also used by `WeeklyScheduleTemplatePickerDialog.tsx`.
- `formatWeekRangeLabel` — also used by `AttendanceToolbar.tsx`.
- `shortShiftTypeCode` — currently only the Gantt uses it, but the new `PlannedDayColumn` tooltip
  takes it over. Moves consumer, does not die.
- `buildWeekSchedule`, `summarizeWeekSchedule`, `describeWeekSchedulePattern`,
  `formatScheduleCoverage`, `shiftScheduleStatus` — all consumed by the new summary panel.

## Testing

**The load-bearing test:** two shifts of different duration must produce **different block
heights**. That single assertion is the entire defect being fixed, and its absence is why the
current design shipped and survived. Render a week with a 4h day and an 11h day and assert the
two heights differ by roughly the ratio of their durations.

**Pure — `src/lib/plannedBlocks.test.ts`**

| case | expect |
|---|---|
| 08:00–17:00, lunch 12:00–13:00 | two blocks, `[480,720]` and `[780,1020]` |
| 08:00–12:00, no lunch | one block |
| lunch equal to or wider than the shift | one block (guard) |
| lunch touching either edge | one block — no zero-width fragment |
| day not assigned | `[]` |

**Render — `src/ui/plannedWeekCanvas.test.tsx`**

- Different durations → different heights (above).
- A 13:00 shift's block starts lower than an 08:00 shift's on the same axis.
- A lunch gap renders as two blocks, not one with a notch.
- Off and leave render their states and no block.

**Render — the anti-drift guard, `src/ui/weekCanvasFrame.test.tsx`**

`WeekView` and `PlannedWeekCanvas`, given the same week, emit the **same gutter hour labels**.
This is what stops the two surfaces diverging again, and it is the test this whole spec exists to
make possible.

**Render — `src/ui/weeklyScheduleSummary.test.tsx`**

- Shows expected hours, counts, assignment id and coverage range.
- Renders **no** shift blocks or per-day times — the regression guard against the chart creeping
  back in.

**Regression** — `WeekView`'s existing tests must pass unchanged through the frame extraction;
that is the evidence attendance did not shift. Note `WeekDayView.test.tsx:93-100` asserts on
`WeekDayView.tsx`'s raw source text and `DayTimeline.test.tsx:13-24` asserts four whole `class`
strings.

**Gate:** `npm run test:web` from `dewey_time/frontend/hr_attendance`, currently **267 passing**.
There is no `test`, `typecheck`, or `lint` script; `npx tsc --noEmit` is already red on an
accepted `tsconfig` deprecation baseline; a green CI `Frontend` check is not evidence because its
`npm install` is `continue-on-error`. `test:web`'s glob covers `src/lib/*.test.ts` and
`src/ui/*.test.tsx` but **not** `src/ui/*.test.ts`, `src/lib/*.test.tsx`, `src/hooks/**`, or any
**subdirectory** of those. That is why every file above sits directly in `src/lib/` or `src/ui/`
rather than in a `schedule/` subfolder: `src/ui/schedule/foo.test.tsx` would silently never run.
Do not edit the glob in `package.json` to work around this.

## Deployment

Runtime frontend change: the rebuilt `dewey_time/public/hr_attendance/**` and both
`dewey_time/www/hr-*.html` must be committed in the same PR. Frappe Cloud cannot build this SPA —
`@lolbikb/dewey-ui` is private and a fresh `npm install` returns 401 — so a PR that changes
`frontend/` without the bundle ships nothing. Build once, last.

No backend change, no patch, no DocType change.

## Open questions, deliberately deferred

- **Does the outlined wash read as "planned" or as "disabled"?** Reviewed at prototype stage and
  judged acceptable; revisit if it reads as greyed-out in real use.
- **Only the first block of a day is labelled.** Monday shows `8:00 AM` with no end label. The
  axis carries the end time; add an end label only if it is missed.
- **The summary is a popover behind a toolbar icon.** If expected-hours turns out to be a
  frequently-needed number, it should be promoted to something always visible.

## Explicitly out of scope

- Showing planned and actual on one canvas as layers. The attendance track already carries seven
  band types; an eighth needs its own design pass.
- The phone surface for the schedule canvas. `WeekDayView` solves this for attendance by showing
  one day at a time; the schedule page is desktop-first and the same approach applies when needed.
- Issues #84 and #85, which touch the same files but are independent.

## Corrects issue #86

#86 claims `/hr-schedule`'s Gantt "still uses the old punch-derived, unlabelled axis". Wrong on
three counts: the component lives in **Attendance**, not Schedule; it uses **no shared axis at
all** rather than an old one; and the axis helpers it supposedly used are **dead code**. This
spec supersedes it, and #86 should be closed as superseded rather than fixed.
