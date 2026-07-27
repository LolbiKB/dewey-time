# Clock-based attendance for unscheduled employees

**Date:** 2026-07-27
**Status:** Approved (design)

## Problem

Employees whose work is clock-in/clock-out rather than shift-bound have no Shift
Assignment, and the system currently treats that absence as an error:

- `closeout.py:465` — no covering Shift Assignment means `on_shift = False`, so any
  punches produce a single `OFF_SHIFT_PUNCH` (WARNING) flag and nothing else. No hours
  are computed.
- `WeekView.tsx:94,103` — `shift_assigned !== true` sets `isOffDay`, which paints the
  day cell `bg-destructive/[0.06]` with a `text-destructive/60` label.

For someone who legitimately has no schedule, that is *every working day*: an entire
week rendered as an error state, plus a warning flag per day for simply turning up.

The goal is a clock-based day: punches in, punches out, hours worked, no schedule-
adherence judgement.

## Policy

A day is a **clock day** when both conditions hold:

1. The employee's `employment_type` is non-blank and **not** in
   `WEEKLY_SCHEDULE_EMPLOYMENT_TYPES` (`Full-time`, `Part-time Fixed`, `Intern`), and
2. No Shift Assignment covers that date.

Everything else is a scheduled day and behaves exactly as it does today.

| Employee type | Shift Assignment on date | Result |
|---|---|---|
| Outside the allowlist (Contract, Casual, …) | no | **Clock day** |
| Outside the allowlist | yes (stale) | Scheduled day — full logic, unchanged |
| Full-time / Part-time Fixed / Intern | no | `OFF_SHIFT_PUNCH` — unchanged |
| Blank / unset | no | `OFF_SHIFT_PUNCH` — unchanged |

Two deliberate choices in that table:

**Blank stays scheduled.** A blank employment type is a data gap, not a statement that
someone is clock-based. Leaving it on the scheduled path keeps it visible as
`OFF_SHIFT_PUNCH` noise until a human fixes the record, rather than silently disabling
absence detection for a new hire nobody classified.

**Schedule wins when present.** If a Shift Assignment covers the date, the day is
scheduled regardless of employment type. This makes the change strictly additive — no
day that currently has enforcement loses it — so a mis-set employment type cannot
silently switch off late/absence detection for someone who really is scheduled. The
cost is that a stale Shift Assignment keeps producing `LATE_START` for a clock-based
employee until HR clears it (`ClearEmployeeScheduleDialog` already exists for this).
Note that the schedule wizard blocks ineligible employment types outright
(`resolve_apply_employment_type` → `("block", …)`) or, in derive mode, rewrites the type
to an eligible one first — so a clock-based employee cannot acquire a Shift Assignment
through the wizard. Any SA they hold predates a type change.

## Flags on a clock day

Kept — these are about punch-data integrity and location, and remain meaningful with no
schedule to compare against:

- **`ATTENDANCE_ISSUE`**, in all four reasons `evaluate_record_issue_flags` emits:
  `single_checkin` and `unpaired_punch` (hours cannot be computed at all),
  `unknown_device_branch` (which the hours fallback below depends on), and
  `delivery_failed` when the caller passes `undelivered_items`. The clock branch passes
  `undelivered_items` through exactly as the zero-checkin path does — a delivery failure
  is a property of the punch pipeline, not of anyone's schedule.
- **`NON_PRIMARY_SITE_PUNCH`** — punching at a branch that is not the employee's own.

Dropped — every one of these is defined relative to a schedule that does not exist:
`LATE_START`, `LEFT_EARLY`, `MISSING_TIME`, `LATE_FROM_LUNCH`, `UNNOTIFIED_ABSENCE`,
`OFF_SHIFT_PUNCH`.

A clock day with zero punches produces no flag and renders as a plain empty day. There
is no absence concept without a schedule to be absent from.

## Architecture

### Policy predicate

`attendance_engine/employment_type.py` gains:

```python
def is_clock_based(employment_type: str | None) -> bool:
    """Non-blank string type outside the Weekly-Schedule allowlist."""
    if not isinstance(employment_type, str):
        return False
    if not employment_type.strip():
        return False
    return not is_weekly_schedule_eligible(employment_type)
```

It belongs in this module: it is the literal complement of the allowlist already
defined there, and the module is deliberately Frappe-free so it unit-tests with plain
`unittest` and no bench.

Both guards fail in the same direction — toward *keeping* schedule enforcement. Blank is
covered above. The `isinstance` check matters because `Employee.employment_type` is a
Frappe Data field, so a non-string is bad data or a test double; treating such a value as
clock-based would silently disable late and absence detection for someone who really is
scheduled. Erring toward enforcement means the failure mode is visible noise rather than
silent under-reporting.

### Engine

The change is confined to one branch. `intraday.py:87` already does
`if not on_shift: return`, so `OFF_SHIFT_PUNCH` is **closeout-only** and intraday needs
no change — both kept flags are EOD-determinable anyway, since a punch is not unpaired
until the day ends.

In `closeout.py`, the `if not on_shift:` branch at line 465 splits: when the employee is
clock-based, run the two data-integrity detectors instead of appending
`OFF_SHIFT_PUNCH`; otherwise behave exactly as today.

- `evaluate_record_issue_flags` is reused as-is. Its docstring says "on-shift only —
  caller must gate off-shift", but that is a statement about the *caller's* policy, not a
  computational dependency: the body never reads `shift_meta` or `grace_minutes`, and all
  four reasons it emits (`single_checkin`, `unpaired_punch`, `unknown_device_branch`,
  `delivery_failed`) are pure punch arithmetic. Update the docstring to say the caller
  decides, and name clock days as the second legitimate caller.
- The `NON_PRIMARY_SITE_PUNCH` comparison (`closeout.py:540-556`) is branch arithmetic
  with no shift input; it is lifted into a small helper shared by both paths rather than
  duplicated.
- `evidence` on flags from this path gains `clock_based: true`, so a flag's provenance is
  readable without reconstructing employee state.

### Contract

`is_clock_based` is added to `_employee_nav_meta()` (`hr_calendar.py:430`), so it rides
the existing calendar payload at top level, and to the picker rows built around
`hr_calendar.py:410` beside the existing `is_full_time`. It is employee-level, not
per-day: the UI derives the per-day answer by ANDing with `shift_assigned`, which keeps
the employment-type rule in exactly one language.

`docs/CALENDAR_DATA_CONTRACT.md` gains the field and the policy table above.

### Frontend

**The empty-state gate must be unblocked first.** `App.tsx:350` renders a "No schedule
configured" card *instead of* the week view whenever
`selectedEmployee?.has_shift_assignment === false`. A clock-based employee has no Shift
Schedule Assignment by definition, so without changing this condition they never reach
the grid at all and every other frontend change here is invisible. The gate becomes
`has_shift_assignment === false && !is_clock_based`. (Found during implementation
planning, after the design was first approved.)

```ts
const isClockDay = employee.is_clock_based && day.shift?.shift_assigned !== true;
```

Computed once in the week component and threaded down alongside the existing
`isOffDay`. Where `isOffDay` currently drives destructive styling
(`WeekView.tsx:94,103,113,123`), a clock day takes the neutral path: no red wash, no
`text-destructive` label, no off-day date badge treatment. `WeekDayView` inherits the
same behaviour through the shared `DayChips`.

Punch bands need no new plumbing — `deriveSegments` (`attendancePunches.ts:97`) builds
segments from checkins alone and never consulted the shift. The shift-relative overlays
(`deriveMissingExpectedIntervals`, `deriveScheduledFutureIntervals`,
`computeExpectedWindowPct`, `computeLunchWindowPct`, `computeLateness`) keep their
existing `!shift_assigned` guards and simply stay off.

A **"Clock"** chip renders in the day-cell header and on the picker row. Without it, a
clock-based employee and an employee whose schedule failed to import look identical —
and under the blank-type rule above those two cases are genuinely different and want
different responses.

### Hours figure

The headline number is **net worked**: the sum of non-null `minutes` across the segments
from `deriveSegments`. For a clock-based worker this is the payable figure; gross span
would silently include a two-hour lunch punch-out.

One fallback matters. `deriveSegments` skips any run whose first punch has no device
branch (`attendancePunches.ts:109`), so punches with missing branch data yield zero
segments. Showing `0h` there would be wrong — the employee worked, the data is
incomplete. When punches exist but segments are empty, show the gross span
(`day.gross_minutes`, already in the payload) with a marker indicating it is unverified.
That same condition already raises `ATTENDANCE_ISSUE (unknown_device_branch)`, which
explains the discrepancy to whoever is reading the cell.

Gross span remains available in the day inspector in all cases.

## Scope boundaries

**Not building a self-service punch UI.** Punches continue to arrive only from the
ZKTeco devices via the Bridge service. This work is display and flag logic.

**No new DocType field.** The mode is derived from `employment_type`, which already
exists on Employee and is already read by `hr_calendar.py:343` and `schedule_api.py:105`.

**No backfill.** Closeout only regenerates AUTO flags for a date when it re-runs, so
existing `OFF_SHIFT_PUNCH` rows on past dates will not self-heal. Days close cleanly
from the next closeout onward. To clean a specific employee's history on demand, re-run
the engine over a window with `run_engine_for_employee` (`dev_tools.py`). This is
recorded rather than automated because a patch that rewrites flags would also discard
ones HR has already actioned.

**Known consequence, not addressed here:** `list_calendar_employees` sorts employees
with shift coverage first, so clock-based employees sort to the bottom of the picker.
The "Clock" chip on the row makes their lack of coverage read as intentional rather than
as a gap. Changing the sort is a separate decision.

## Testing

**Python** (`unittest`, via `bench --site <site> run-tests --app dewey_time`):

- `is_clock_based` truth table — allowlist members, outside-allowlist types, blank,
  whitespace-only, mixed case. Runs without a bench, like the rest of `employment_type`.
- Clock-based employee, punches, no SA → no `OFF_SHIFT_PUNCH`.
- Clock-based employee, single punch → `ATTENDANCE_ISSUE (single_checkin)` still emitted.
- Clock-based employee, punch at a foreign branch → `NON_PRIMARY_SITE_PUNCH` still emitted.
- Clock-based employee, zero punches → no flags at all.
- **Clock-based employee with a stale SA → `LATE_START` still emitted.** This is the
  additive guarantee; it is the test most worth having.
- Blank employment type, punches, no SA → `OFF_SHIFT_PUNCH` unchanged.
- Full-time, punches, no SA → `OFF_SHIFT_PUNCH` unchanged.

**TypeScript** (`npm run test:web`):

- `isClockDay` derivation across the truth table.
- A clock day's cell carries no destructive class; an off-day cell still does.
- Net-worked sums segment minutes; punches-but-no-segments falls back to gross rather
  than rendering `0h`.

## Files touched

| File | Change |
|---|---|
| `attendance_engine/employment_type.py` | add `is_clock_based` |
| `attendance_engine/closeout.py` | split the `not on_shift` branch; extract the non-primary-branch helper |
| `attendance_engine/record_issue_flags.py` | docstring correction only |
| `attendance_engine/hr_calendar.py` | expose `is_clock_based` on nav meta + picker rows |
| `frontend/.../App.tsx` | unblock the "No schedule configured" gate for clock-based employees |
| `frontend/.../WeekView.tsx`, `WeekDayView.tsx`, `DayChips.tsx` | neutral clock-day styling + "Clock" chip |
| `frontend/.../lib/weekDayView.ts` | `dayPipState` becomes clock-aware |
| `frontend/.../lib/clockDay.ts` | new: `isClockDay`, net-worked minutes, display formatting |
| `frontend/.../types/calendar.ts` | `is_clock_based` field |
| `dewey_time/docs/CALENDAR_DATA_CONTRACT.md` | document field + policy table |
