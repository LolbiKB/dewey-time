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
shiftBounds = collectShiftBounds(...)          # start_time, end_time; ONLY where end > start
wideningMins = collectWideningMinutes(...)     # checkins, first_in, last_out, lunch bounds

if shiftBounds:
    startMin = floor((min(shiftBounds) - 60) / 60) * 60
    endMin   = ceil( (max(shiftBounds) + 60) / 60) * 60
else:
    startMin, endMin = 06:00, 20:00            # clock-based employees: no schedule to derive from

for m in wideningMins:
    startMin = min(startMin, floor(m / 60) * 60)
    endMin   = max(endMin,   ceil(m / 60) * 60)

clamp to [00:00, 24:00]
```

**`collectWeekTimelineMinutes` must be split, not reused.** Today it pushes `shift.start_time`
and `shift.end_time` into the same flat array as the punch minutes, with no `end > start` check
(`weekTimelineWindow.ts:44-54`). Calling it for the widening phase would silently re-admit the
overnight bounds that the derivation phase just excluded — a 22:00–06:00 week would widen to
06:00–22:00. Split it into `collectShiftBounds` (start/end, `end > start` only) and
`collectWideningMinutes` (checkins, `first_in`, `last_out`, lunch bounds only). Its two existing
tests assert the current combined contract and change with it.

Punches still widen the window, so nothing can be hidden — but they no longer *define* it. A
stray 05:20 punch moves the axis by one labelled hour instead of re-scaling all seven days.
Schedules are assigned and stable; punches are noisy. That is the whole reason for the switch.

Quantizing to whole hours is load-bearing: it is what guarantees gridlines always land on an
hour, so the labels can be trusted.

Verified against the real `WeekView`: an 08:00–17:00 week yields **07:00–18:00** — 43px/hour and
18% empty canvas, versus 34px/hour and 36% empty for a hardcoded 06:00–20:00.

`weekTimelineWindow.ts:63` is the **only** production caller of `computeWeekTimelineWindow`
(`attendancePunches.ts:610`), and `DEFAULT_TIMELINE_FALLBACK_WINDOW` (`:605`) exists only as its
default argument. Both become dead — delete them, along with the **one** test block that covers
them (`attendancePunches.test.ts:214-227`; `:218` and `:221` are two call sites inside it, not
two tests) **and** the `computeWeekTimelineWindow` entry in that file's named-import list at
`:10`. Nothing in CI typechecks, so a stale import fails only at test time.

Note the fallback is a **new value**: `DEFAULT_TIMELINE_FALLBACK_WINDOW` is currently
`{8*60, 18*60}` — 08:00–18:00. The 06:00–20:00 constant is written fresh in
`weekTimelineWindow.ts`, not reused from there.

Deleting `computeWeekTimelineWindow` also deletes its `Math.max(60, …)` span floor
(`attendancePunches.ts:624`). Hour quantization makes a sub-60-minute span impossible, so the
floor is not needed — but `WeekTimelineWindow` still declares `spanMinutes`, which the new rule
must keep populating.

`computeDayTimeWindow` (`:628`) is a different function and stays: `DayTimeline.tsx:305` still
uses it as the fallback when a caller supplies no window props.

### 2. The axis — two new files

**`src/lib/timelineAxis.ts`** — pure, no React, no DOM:

- `export type AxisWindow = { startMin: number; endMin: number }` — the one shape all axis chrome
  takes. This matters: two incompatible window objects already exist. `WeekTimelineWindow` is
  `{startMin, endMin, spanMinutes}` (`weekTimelineWindow.ts:17-21`), while `DayDayTrack`'s
  internal memo returns `{startMin, endMin, **span**}` (`DayTimeline.tsx:293-306`) and can be
  `null`. `HourGutter` is fed the former, `HourGrid` the latter. Both must narrow to `AxisWindow`
  at the call site; `pctOfWindow` derives the span itself rather than reading a field.
- `hourTicks(startMin, endMin): number[]` — whole-hour marks inside the window. Steps to 2h once
  the window exceeds 17h, which is the only way a near-24h week stays legible at 20px/hour. The
  2h step is **phased from `startMin`** (a 05:00 start gives 05, 07, 09…), not aligned to even
  clock hours — one rule, no special case. Handles non-hour-aligned bounds (the window is
  hour-quantized, but the function must not assume it). A tick exactly at `endMin` **does**
  render; it sits on the track's bottom border and terminates the axis.
- `hourLabel(min): string` — `"7 AM"`, `"12 PM"`. `hourLabel(1440)` is reachable (a 23:30 punch
  widens `endMin` to 24:00) and returns `"12 AM"`; naive `% 12` arithmetic yields `"0 PM"`.
- `pctOfWindow(min, window): number` — the single place minute→percent happens for axis chrome.

**`src/ui/TimelineAxis.tsx`** — presentational only:

- `HourGrid({ window })` — absolutely-positioned hour lines, `aria-hidden`, rendered inside the
  day track *behind* the punch bands so bands occlude lines the way calendar events do. Renders
  nothing when `window` is null.
- `HourGutter({ window })` — the labelled column, `aria-hidden`, `py-3` to match `DayCell`'s
  padding so labels sit on their lines.

Both must stay **tooltip-free and `aria-hidden`**. `WeekDayView.test.tsx:42` renders
`WeekDayView` with no `TooltipProvider`; anything wrapped in `AppTooltip` throws there. And
Tailwind utilities only — no named rule in `brand/base.css` — so this does not pull in the
`offSiteSegment.test.tsx:127-140` convention of asserting CSS rules off disk.

Splitting math from render follows the existing `lib/` ↔ `ui/` convention in this package, and is
what makes the tick logic testable without rendering anything.

Line weight: `bg-border`. (The prototype used `bg-border/45` and the lines were nearly invisible
on the phone. The decorative hairline being removed is `bg-border/60`.)

### 3. Consumers

`WeekView.tsx` and `WeekDayView.tsx` each gain a `3.5rem` gutter column:

- `WeekView` header grid → `grid-cols-[3.5rem_repeat(7,minmax(8rem,1fr))]` with an empty
  `aria-hidden` spacer cell; timeline grid likewise, with `<HourGutter>` as the first child.
- `WeekDayView` → `grid-cols-[3.5rem_1fr]`. The single-column `grid` there is load-bearing for
  a reason documented at `WeekDayView.tsx:141` (issue #71: `DayCell`'s root is a `<button>`,
  inline-level, and collapses to a sliver in a block wrapper). Adding a column must preserve
  that stretch behaviour.

`DayTimeline.tsx` renders `<HourGrid>` as the **first DOM child** of the track div
(`DayTimeline.tsx:358-361`) — exactly the slot the deleted hairline occupies. Nothing in the file
sets a z-index; stacking is pure DOM order, so inserted anywhere later it paints over the bands.

It **removes the decorative 50%-width hairline** (`DayTimeline.tsx:367-370`) — with real
gridlines present it reads as a false axis.

Three consumer decisions, made explicitly so they do not surface as review findings:

- **`AttendanceLoading.tsx` gets the gutter too.** It duplicates the 7-column template at `:64`
  and `:79`. Left alone, every load jumps horizontally when data replaces the skeleton.
- **`WeekView.tsx:174`'s `overflow-hidden` is a known pre-existing bug, deferred.** The header
  row and the timeline row are separate grids inside one `overflow-x-auto` wrapper; the timeline
  row's rightmost columns clip and become unreachable once min-content width exceeds the box.
  The gutter raises min-content from 896px to 952px, shrinking the margin before it bites but not
  causing it. Out of scope, noted here so the plan does not silently inherit it.
- **Holiday columns render no gridlines,** and a holiday-today cell can render no now-line.
  `DayCell` short-circuits to `HolidayBoard` instead of `DayDayTrack` (`:116-126`), and both live
  inside the track. Accepted: a holiday column has no timeline to annotate.

### 4. Overnight shifts

Excluded from the window derivation (`end_time <= start_time` days do not stretch the axis), and
nothing else. No note, no special-casing.

An earlier draft of this spec proposed rendering "Overnight shift — not shown on this view" in
place of the track. That was wrong on both premises and is recorded here so it is not
reintroduced:

- Overnight punches **do** render today. `pctFromMinute` clamps to `[0,100]`
  (`DayTimeline.tsx:308-311`), so out-of-window minutes pin to an edge rather than vanishing, and
  `hr_calendar.py:558` groups punches by `getdate(c["time"])` — the SPA never receives a
  midnight-spanning `Day.checkins`, so `deriveSegments` never forms a wrapping pair and the
  negative-height guard is unreachable through the real API.
- The note's predicate is the *assigned shift*, so a Mon–Fri night roster would show it on all
  five days and hide every punch — strictly worse than today.

Overnight is also not reachable through this app's own UI: `schedule_resolver.py:220-226` drops
`end <= start` days on both the wizard preview and apply paths, and
`docs/ROLLOUT_PUNCH_LIST.md:44-46` records confirmation on 2026-07-04 that none are scheduled.

A real fix means re-basing the frontend's minute helpers from minute-of-day onto day-anchored
minutes plus changing `hr_calendar.py`'s grouping (`closeout.py:733-746` is a working template)
and lifting six `end <= start` guards in `shiftTimeline.ts`. Note the backend's
`absence_intervals.py:68` and `attendance_segments.py:46-49` are **already** day-anchored, so
they are not part of that cost.

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

Four sub-decisions, all made here because each is otherwise a guess:

1. **Suppression is an explicit pre-check**, not a consequence of the pct math:
   `if (now < startMin || now > endMin) return null`. Because `pctFromMinute` clamps to
   `[0,100]`, omitting it does not produce a visibly broken line — it produces a plausible line
   pinned to an edge, i.e. a confident 06:00 reading at 03:00. Silent wrongness, so it gets its
   own test.
2. **`now` originates in `App.tsx`** and is passed to `WeekView` / `WeekDayView` / `DayCell` /
   `DayDayTrack`. There is no shared `now` today — `App.tsx` has four independent `new Date()`
   calls (`:48,126,147,215`), `WeekView` two more, `WeekDayView` four.
3. **`isToday` stays as it is.** The existing `isSameDay(d, new Date())` checks are not
   rewritten to consume the new `now`. Re-deriving today-ness is a behaviour change with its own
   risk (midnight rollover across a memo boundary) and is not what this spec is for.
4. **`now` is not threaded into `deriveScheduledFutureIntervals`, `missingExpectedMaxEndMin`, or
   `classifyUnpairedPresentations`.** All three accept an optional `now` and currently default to
   their own `new Date()` (`DayTimeline.tsx:205-218`, `:265-270`). Threading them is a correctness
   improvement — the line and the band it explains would then share one instant — but it changes
   what those functions compute and belongs in its own change. **Named as deferred so a reviewer
   sees a decision, not an oversight.**

There is no ticking clock anywhere in this package, and this spec does not add one. `now` is
evaluated at render and moves only when `App` re-renders. Accepted: the line is a coarse
reference, not a second hand.

`DayDayTrack` receives neither `today` nor `now` today (`DayTimeline.tsx:163-176`) even though
`DayCell` has `today` (`:56`). Both props are added.

### 6. Adjacent fixes in the same files

**Delete the dead `dense` mode.** No production call site passes `dense={true}` — only
`DayTimeline.test.tsx`. It carries a second scale (`pctFromMinuteDay`, full-24h), the
`computeDaySpan` path, a `segments.slice(0, 3)` cap, and a `useWeekWindow` boolean threaded
through `renderTimelineBand`, which can then drop that parameter entirely.

Nothing in CI typechecks or lints this package, and `noUnusedLocals` is unset, so a missed
orphan ships silently. The full set, enumerated rather than left to "remove unused imports":

| removing | orphans |
|---|---|
| dense span block (`:454-465`) | `computeDaySpan`; `DayDayTrack.lastOut` (`:165`, only use `:199`); its pass-down `lastOut={…}` (`:130`) |
| dense header (`:97-113`) | `DayCell.shiftEndMin` (`:69-72`); `hasErrorPunch` (`:73-77`) |
| `pctFromMinuteDay` | — (used only by the `useWeekWindow: false` path) |

Three imports must **not** be removed, because each looks dead and is not:

- `formatCheckinTime` — live at `:350` in `openSessionLabel`, used by the non-dense open-session
  band at `:419`.
- `clipScheduledBandToFuture` — its `DayTimeline.tsx:32` *import* is dead, but that is
  pre-existing and unrelated to `dense`; the function is live at `shiftTimeline.ts:176` inside
  `deriveScheduledFutureIntervals` with four tests. Remove the import, never the function.
- `hasTimelineErrorPunches` — becomes production-unused, but `attendancePunches.test.ts:262`
  still exercises it. Remove the `DayTimeline.tsx:20` import, never the lib function.

`computeDaySpan` itself is deleted from `shiftTimeline.ts` (zero other consumers, zero tests),
along with any of `minutesSinceMidnight` / `parseDateTimeLocal` its removal orphans from that
file's import block (`:3-9`). Keep `clamp`.

**Replace the 2%-of-window band floor.** `renderTimelineBand` does
`Math.max(2, bottomPct - topPct)` (`DayTimeline.tsx:330`). At 07:00–18:00 that floor is ~9px,
i.e. ~14 minutes of apparent time — harmless while the axis is unreadable, a visible lie once
hours are labelled. Use `minHeight: 3px` so a short band stays clickable without claiming
duration it does not have.

Two consequences to state rather than discover:

- The `if (heightPct <= 0) return null` guard at `:331` is **dead today** because `Math.max(2,…)`
  precedes it. Removing the 2% floor makes it live again. That is intended — it legitimately
  drops zero-length and inverted intervals.
- `gaps.map` (`:480-481`) and `segments.map` (`:520-521`) compute height inline and have **no
  floor at all**, so after this change the canvas has two floor policies. Deliberate: those
  bands are derived from real punch pairs and should be free to render sub-1%. Do not "unify"
  them. (There are two other `Math.max(2, …)` sites — `shiftTimeline.ts:196` in `computeDaySpan`,
  deleted with dense, and `:208` in the pre-existing dead `computeExpectedWindowPct`. Neither is
  in scope.)

**Remove the 6-segment cap entirely.** `segments.slice(0, props.dense ? 3 : 6)`
(`DayTimeline.tsx:516`) becomes `segments`. An earlier draft proposed a `"+N more"` marker
instead; rendering every segment is better on all three counts: eight absolutely-positioned divs
cost nothing, segments never overlap in time so there is no clutter risk, and a marker inside
`DayCell`'s root `<button>` would change that button's accessible name — which
`e2e/attendance.spec.ts:20` selects on.

## Testing

**Pure — `src/lib/weekTimelineWindow.test.ts` (this file already exists — extend it)**

It has two tests today. The second, `"resolveWeekTimelineWindow falls back to 08:00–18:00 with no
data"`, asserts the **old** fallback and must be rewritten to 06:00–20:00. Its
`canvasHeightPct === undefined` assertion **must survive** — that is the #78 anti-scroll
invariant. The first test asserts that `collectWeekTimelineMinutes` gathers checkin, first/last,
*and shift* minutes; it changes with the split into `collectShiftBounds` /
`collectWideningMinutes`.

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
  outside the window (see §5.1 — this is the silent-failure case).
- A day with 8 segments renders all 8.

**Regression** — `offSiteSegment.test.tsx`, `weekTimelineScroll.test.tsx`, `DayTimeline.test.tsx`,
and `WeekDayView.test.tsx` must all still pass. Four specifics, each a trap:

- **`weekTimelineScroll.test.tsx` must be re-fixtured.** Its `NARROW` (09–17) and `WIDE` (06–20)
  fixtures are both `shift_assigned: false` (`:44-46`), so under the new rule both resolve to the
  *same* 06:00–20:00 fallback. Every assertion still passes and the file becomes a tautology —
  green, and testing nothing. Give the two fixtures assigned shifts so they resolve to different
  windows again. Its real invariants (`height:%` never exceeds 100 at `:100`; no
  `overflow-y-auto` / `overflow-auto` at `:88-89`) must keep holding, which means axis chrome
  emits `top:%`, never a height over 100%.
- **The `dense` deletion set is one test, not two.** `DayTimeline.test.tsx:114` is a JSDoc line.
  Delete: consts `DENSE_WORKED_SPAN` / `DENSE_OFF_SHIFT_SPAN` (`:22-25`), the docblock and
  `renderDenseDay` helper (`:113-139`), the single `test()` (`:141-144`), and the then-unused
  `import { DayCell }` (`:6`) unless a new axis test reuses it. Delete, do not adapt — adapting
  keeps a scale that no longer exists.
- **`DayTimeline.test.tsx:13-25` asserts full `class="…"` attribute strings** via
  `html.includes`. `minHeight: 3px` is a style change and safe; adding *any* class to a segment
  or gap band breaks four tests.
- **`WeekDayView.test.tsx:93-100` asserts on raw source text.** It must still match `/DayCell/`,
  `/useWeekTimelineWindow/`, `/DayChips/`, `/stepDay/`, and must **not** contain the literal
  `overflow-x-auto`. Removing `dense={false}` is safe; this is a literal-string guard, not an
  intent check.

**Manual** — the prototype harness that produced this design's screenshots is a fast way to
eyeball the result: a `mockup.html` + `src/mockup.tsx` entry rendering `WeekView`/`WeekDayView`
against a hand-built week, screenshotted with Playwright at 1320×660 and 430×760. It was deleted
after the design; recreate it if the visual result needs checking, and delete it again — it must
not ship.

## Verification — what "green" actually means here

The gates in this package are not the conventional ones. Getting this wrong produces false
confidence, so it is pinned:

- **There is no `test`, `typecheck`, or `lint` script.** `package.json` has `dev`, `build`,
  `preview`, `test:web`, `test:e2e`. `npm run test` fails with "Missing script". The unit gate is
  `npm run test:web` from `dewey_time/frontend/hr_attendance`. **Baseline: 242 tests, 0 failures,
  ~6.2s.** Paste the counts; do not describe them.
- **`npx tsc --noEmit` is already red on `main`** — exit 2, `tsconfig.json(15,5): error TS5101:
  Option 'baseUrl' is deprecated`. That single line is the accepted baseline. Do not use it as a
  pass/fail gate, and do not "fix" `tsconfig.json` as a side effect of this work.
- **A green CI `Frontend` check is not evidence.** Its `npm install` step is
  `continue-on-error: true`, so if `@lolbikb/dewey-ui` cannot be fetched, `test:web` is skipped
  and the job reports green anyway.
- **`test:web`'s glob is seven literal patterns.** `src/lib/*.test.ts` and `src/ui/*.test.tsx`
  are covered; `src/ui/*.test.ts`, `src/lib/*.test.tsx`, and anything under `src/hooks/` are
  **not** — a test placed there silently never runs. So `timelineAxis.test.ts` goes in
  `src/lib/`, the render test is `src/ui/timelineAxis.test.tsx`, and no logic may be added to
  `useWeekTimelineWindow.ts`, which is untestable by construction. Keep it a one-line memo.

## Deployment

Runtime frontend code, so per `CLAUDE.md` the rebuilt `dewey_time/public/hr_attendance/**` and
`dewey_time/www/hr-{attendance,schedule}.html` **must be committed in the same PR**. Frappe Cloud
never builds this SPA — it cannot, because `@lolbikb/dewey-ui` is private and a fresh
`npm install` returns 401 without `NODE_AUTH_TOKEN`. A merged PR that changes `frontend/` but not
`public/hr_attendance/` ships nothing.

The rebuild runs **once, last**:

- `node_modules` and `@lolbikb/dewey-ui` are already present in this tree, so `npm run build`
  runs directly. Do **not** prescribe `rm -rf node_modules && npm install` — that needlessly
  reintroduces the `NODE_AUTH_TOKEN` dependency.
- `vite.config.ts` sets `emptyOutDir: true`, and `scripts/copy-html-entry.mjs` stamps a fresh
  unix timestamp into `assets/build-id.txt` plus new `?v=` query strings on **every** invocation.
  A second "just to double-check" build therefore produces a commit of pure timestamp churn.
  Build once; if the only diff is `build-id.txt` and `?v=` strings, revert it.
- Stage named paths only: `git add dewey_time/public/hr_attendance/ dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html`.
- Commit-message precedent: `build(hr-attendance): …` (see `0faae666`, `a35c950e`).

No backend change, no patch, no DocType change.

## Explicitly out of scope

- **`/hr-schedule`'s Gantt keeps its own axis.** `weekSchedule.ts:161-176`
  `computeWeekGanttWindow` gives `WeekScheduleGantt` a punch-derived, unlabelled, un-quantized
  window. After this change the app's two week grids read on different scales. Named here so it
  is a known gap rather than a review finding.
- **`WeekView.tsx:174`'s horizontal clipping** (see §3).
- **Threading `now` into the three interval helpers** (see §5.4).
- **Overnight rendering** (see §4).
