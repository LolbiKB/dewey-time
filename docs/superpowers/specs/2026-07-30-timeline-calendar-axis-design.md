# Check-in/out timeline: a calendar axis — design

**Date:** 2026-07-30
**Status:** approved, ready for planning

## Goal

Make the check-in/out canvas readable the way a calendar app is readable: a labelled hour
axis, hour gridlines, and a scale that stays put between weeks and between employees.

## The problem

The vertical axis is derived from the week's punch data — `[earliest − 30 min, latest + 30 min]`
(`weekTimelineWindow.ts`), clamped to the day, then stretched to fill the container. There are
**no hour gridlines, no hour labels, and no gutter**. The only vertical line on the canvas is a
decorative hairline at 50% *width* (`DayTimeline.tsx:368`), which is not a time marker at all.
Times are legible only by hovering a tooltip, or from the start/end text burned into blocks
taller than 12%.

Three consequences, all confirmed by rendering the real `WeekView` against a fixture week:

1. **The scale is unreadable.** A block's position and height carry no absolute meaning.
2. **The scale wanders.** One 05:20 punch on Monday re-scales all seven days, with nothing on
   screen indicating it happened. Two employees' 09:00 land at different heights, so
   employee-to-employee and week-to-week comparison is broken, invisibly.
3. **Height lies about duration.** A 14-hour-span week compresses an 8-hour shift into less
   height than a 9-hour-span week does — the one variable HR is scanning for.

Measured at the ~470px the track gets on both desktop and phone: today's typical 10h window is
47px/hour. A fixed 06:00–20:00 is 34px/hour. A fixed 24h is 20px/hour. (Google Calendar's
default is ~48px/hour, and it scrolls.)

Scrolling is not an option: #78 removed it deliberately, because scrollability depended on the
employee's own data — a 09:00–17:00 week fitted while an early-start/late-finish week silently
grew a scrollbar, giving the same screen two interaction models with nothing explaining why.

## Design

### 1. The window — `src/lib/weekTimelineWindow.ts`

Derive the window from the week's **assigned shift** bounds rather than its punches:

```
shiftBounds = every (start_time, end_time) for days where shift_assigned
              and end_time > start_time        # see overnight, §4

if shiftBounds:
    startMin = floor((min(shiftBounds) - 60) / 60) * 60
    endMin   = ceil( (max(shiftBounds) + 60) / 60) * 60
else:
    startMin, endMin = 06:00, 20:00            # clock-based employees: no schedule to derive from

for m in collectWeekTimelineMinutes(...):      # punches, first_in/last_out, lunch bounds
    startMin = min(startMin, floor(m / 60) * 60)
    endMin   = max(endMin,   ceil(m / 60) * 60)

clamp to [00:00, 24:00]
```

Punches still widen the window, so nothing can be hidden — but they no longer *define* it. A
stray 05:20 punch moves the axis by one labelled hour instead of re-scaling all seven days.
Schedules are assigned and stable; punches are noisy. That is the whole reason for the switch.

Quantizing to whole hours is load-bearing: it is what guarantees gridlines always land on an
hour, so the labels can be trusted.

Verified against the real `WeekView`: an 08:00–17:00 week yields **07:00–18:00** — 43px/hour and
18% empty canvas, versus 34px/hour and 36% empty for a hardcoded 06:00–20:00.

`weekTimelineWindow.ts:63` is the **only** production caller of `computeWeekTimelineWindow`
(`attendancePunches.ts:610`), and `DEFAULT_TIMELINE_FALLBACK_WINDOW` (`:605`) exists only as its
default argument. Both become dead — delete them, along with their two tests at
`attendancePunches.test.ts:218` and `:221`.

`computeDayTimeWindow` (`:628`) is a different function and stays: `DayTimeline.tsx:305` still
uses it as the fallback when a caller supplies no window props.

### 2. The axis — two new files

**`src/lib/timelineAxis.ts`** — pure, no React, no DOM:

- `hourTicks(startMin, endMin): number[]` — whole-hour marks inside the window. Steps to 2h once
  the window exceeds 17h, which is the only way a near-24h week stays legible at 20px/hour.
  Handles non-hour-aligned bounds (the window is hour-quantized, but the function must not
  assume it).
- `hourLabel(min): string` — `"7 AM"`, `"12 PM"`.
- `pctOfWindow(min, window): number` — the single place minute→percent happens for axis chrome.

**`src/ui/TimelineAxis.tsx`** — presentational only:

- `HourGrid({ window })` — absolutely-positioned hour lines, `aria-hidden`, rendered inside the
  day track *behind* the punch bands so bands occlude lines the way calendar events do.
- `HourGutter({ window })` — the labelled column, `aria-hidden`, `py-3` to match `DayCell`'s
  padding so labels sit on their lines.

Splitting math from render follows the existing `lib/` ↔ `ui/` convention in this package, and is
what makes the tick logic testable without rendering anything.

Line weight: `bg-border` (not `bg-border/45` — at 45% the lines were nearly invisible on the
phone in the prototype).

### 3. Consumers

`WeekView.tsx` and `WeekDayView.tsx` each gain a `3.5rem` gutter column:

- `WeekView` header grid → `grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]` with an empty
  `aria-hidden` spacer cell; timeline grid likewise, with `<HourGutter>` as the first child.
- `WeekDayView` → `grid-cols-[3.5rem_1fr]`. The single-column `grid` there is load-bearing for
  a reason documented at `WeekDayView.tsx:141` (issue #71: `DayCell`'s root is a `<button>`,
  inline-level, and collapses to a sliver in a block wrapper). Adding a column must preserve
  that stretch behaviour.

`DayTimeline.tsx` renders `<HourGrid>` at the top of the track and **removes the decorative
50%-width hairline** (`DayTimeline.tsx:368`) — with real gridlines present it reads as a false
axis.

### 4. Overnight shifts — an honest note, not a fix

A shift whose `end_time <= start_time` is excluded from the derivation and lands on the
06:00–20:00 fallback. Rendering it produces a **completely empty labelled grid**: every band is
computed in minute-of-day, so a 22:00→02:00 segment gives `endPct < topPct` and is dropped at
`DayTimeline.tsx:521`.

This is pre-existing — overnight has never rendered on this canvas — but a labelled axis turns an
invisible absence into what looks like a broken screen.

**Scope:** when the day's assigned shift crosses midnight, the cell renders
`"Overnight shift — not shown on this view"` in place of the track, in the same style as the
existing `"Day off"` message (`DayTimeline.tsx:362`).

A real fix means re-basing every band from minute-of-day onto day-anchored minutes (so a window
can run 21:00→30:00), which touches the backend's per-`attendance_date` checkin grouping as well
as every interval helper in `shiftTimeline.ts`, `absence_intervals.py`, and
`attendance_segments.py`. That is its own spec.

### 5. The now-line

Today's column only: a red dot plus a hairline at the current time, `pointer-events-none`,
above the bands (`z-10`). Suppressed when `now` falls outside the window.

`now` is **passed in as a prop**, not read from `new Date()` inside the component. This matches
`checkDeviceSyncStaleness(deviceSync, now)`, which already takes `now` explicitly
"so the function is unit-testable without mocking Date" (`attendancePunches.ts:657`). It also
makes the render test for "no line when now is outside the window" trivial to write.

The marker earns its place beyond calendar-app familiarity: `DayTimeline` already draws a dashed
"Scheduled" band for the remainder of today (`deriveScheduledFutureIntervals`), and that band
currently floats with no reference point explaining where the past stops.

### 6. Adjacent fixes in the same files

**Delete the dead `dense` mode.** No production call site passes `dense={true}` — only
`DayTimeline.test.tsx:133`. It carries a second scale (`pctFromMinuteDay`, full-24h), the
`computeDaySpan` path, a `segments.slice(0, 3)` cap, and a `useWeekWindow` boolean threaded
through `renderTimelineBand`. Every function the axis work touches has a `dense` branch in it.
Removing it also removes `computeDaySpan` and the dense-only date/pip header, and lets
`renderTimelineBand` drop its `useWeekWindow` parameter entirely.

**Replace the 2%-of-window band floor.** `renderTimelineBand` does
`Math.max(2, bottomPct - topPct)` (`DayTimeline.tsx:330`). At 07:00–18:00 that floor is ~9px,
i.e. ~14 minutes of apparent time — harmless while the axis is unreadable, a visible lie once
hours are labelled. Use a small px floor (`minHeight: 3px`) so a short band stays clickable
without claiming duration it does not have.

**Surface the 6-segment cap.** `segments.slice(0, props.dense ? 3 : 6)` (`DayTimeline.tsx:516`)
silently drops a 7th segment, which on a labelled axis reads as an unexplained absence rather
than truncation. Render the capped count as a marker in the cell (e.g. `"+2 more"`) so the
canvas never shows a hole it did not mean.

## Testing

**Pure — `src/lib/weekTimelineWindow.test.ts`**

| case | expect |
|---|---|
| 08:00–17:00 assigned all week | 07:00–18:00 |
| no shift assigned any day, no punches | 06:00–20:00 |
| no shift assigned, punches 09:15–16:40 | 06:00–20:00 (inside fallback, no change) |
| 08:00–17:00 assigned, one 05:20 punch | 05:00–18:00 |
| 08:00–17:00 assigned, one 23:30 punch | 07:00–24:00 |
| shift 22:00–06:00 | 06:00–20:00 (overnight excluded from derivation) |
| mixed week: 06:00–14:00 and 12:00–20:00 | 05:00–21:00 |
| punch at 00:05 | startMin clamps at 00:00, never negative |

**Pure — `src/lib/timelineAxis.test.ts`**

- `hourTicks(7*60, 18*60)` → 12 ticks, first 07:00, last 18:00.
- 18h window → 2h step; 17h window → 1h step (the boundary itself, both sides).
- Non-hour-aligned bounds (`hourTicks(430, 1085)`) → first tick 08:00, last 18:00, none outside.
- `hourLabel` → `"12 AM"`, `"7 AM"`, `"12 PM"`, `"11 PM"` (the two noon/midnight cases are where
  a naive `% 12` reads `"0 AM"`).

**Render — `src/ui/timelineAxis.test.tsx`** (`renderToStaticMarkup`, matching the
`offSiteSegment.test.tsx` idiom)

- The gutter renders a label per tick, and `WeekDayView` renders the same labels as `WeekView`
  for the same week — the phone surface is a separate call site and TypeScript catches a missing
  prop declaration but not a forgotten pass-down (the exact gap `offSiteSegment.test.tsx:120`
  was written to cover).
- Hour lines appear inside a day track, and the 50%-width hairline is gone.
- Now-line: present on today's column, absent on the other six, absent entirely when `now` is
  outside the window.
- An overnight-shift day renders the note and no track.
- A day with 8 segments renders 6 plus a `"+2 more"` marker.

**Regression** — the existing `offSiteSegment.test.tsx`, `weekTimelineScroll.test.tsx`,
`DayTimeline.test.tsx`, and `WeekDayView.test.tsx` must all still pass. `DayTimeline.test.tsx`
has two `dense` tests (`:114`, `:141`) that must be deleted with the mode, not adapted —
adapting them would keep a scale that no longer exists.

**Manual** — the prototype harness that produced this design's screenshots is a fast way to
eyeball the result: a `mockup.html` + `src/mockup.tsx` entry rendering `WeekView`/`WeekDayView`
against a hand-built week, screenshotted with Playwright at 1320×660 and 430×760. It was deleted
after the design; recreate it if the visual result needs checking, and delete it again — it must
not ship.

## Deployment

Runtime frontend code, so per `CLAUDE.md` the rebuilt `dewey_time/public/hr_attendance/**` and
`dewey_time/www/hr-{attendance,schedule}.html` **must be committed in the same PR**. Frappe Cloud
never builds this SPA — it cannot, because `@lolbikb/dewey-ui` is private and a fresh
`npm install` returns 401 without `NODE_AUTH_TOKEN`. A merged PR that changes `frontend/` but not
`public/hr_attendance/` ships nothing.

No backend change, no patch, no DocType change.
