# Attendance rules (MVP → later engine)

This document defines **policy + rule logic** for turning raw device punches (ERPNext **Employee Checkin**) into daily outcomes (late flags, missing punches, hours, exceptions) for ZKTeco bridge employees.

It is intentionally **rules-only** (no implementation). The bridge currently sets `skip_auto_attendance = 1` on device punches to prevent ERP auto-attendance from creating `Attendance` before these rules are implemented.

**Implementation plan:** see [`FRAPPE_ATTENDANCE_ENGINE_PLAN.md`](./FRAPPE_ATTENDANCE_ENGINE_PLAN.md).

## Scope

- **In scope**: rule definitions, required data, expected outputs, and the review/approval workflow.
- **Out of scope**: building the scheduler/jobs, doctypes, UI, or payroll integrations.

## Prerequisites (must already be true)

- **Shift setup** is complete: see [`FRAPPE_SHIFT_SETUP.md`](./FRAPPE_SHIFT_SETUP.md)
  - Shift Types named `FT_{HHMM}_{HHMM}`.
  - Shift Schedules named `PAT_{DAYS}_{SHIFT_TYPE}[_{LUNCH_HINT}]`.
  - Employees assigned via **Shift Schedule Assignment** (creates dated Shift Assignments).
  - Lunch custom fields exist on Shift Type: `custom_lunch_start`, `custom_lunch_end`, `custom_grace_minutes`.
- **Checkin delivery** is stable: see [`FRAPPE_EMPLOYEE_CHECKIN.md`](./FRAPPE_EMPLOYEE_CHECKIN.md)
  - Idempotent inserts via `custom_supabase_log_id`.
  - Bridge sends `skip_auto_attendance = 1` on device punches.
- **Company timezone** is correct (attendance day boundaries).

## Data model assumptions

### Inputs

- **Employee Checkin**
  - `employee`
  - `time` (timezone-aware; stored as datetime)
  - `log_type` (IN/OUT if available; otherwise inferred)
  - `device_id` (optional but useful for debugging)
  - `skip_auto_attendance = 1`
  - `custom_supabase_log_id` (unique)
  - `custom_verify_type` (optional; informational)
- **Shift Assignment** (dated rows created from Shift Schedule Assignment)
  - employee + date → Shift Type for that date
- **Shift Type**
  - `start_time`, `end_time`
  - `custom_lunch_start`, `custom_lunch_end`, `custom_grace_minutes` (for full-day types)
- **Holiday List**
  - weekly off + public holidays

### Outputs (target shape)

**Persisted:** `Attendance Flag` rows (one per issue) — see [`FRAPPE_ATTENDANCE_ENGINE_PLAN.md`](./FRAPPE_ATTENDANCE_ENGINE_PLAN.md).

**Computed on read** (week/day API from checkins; not stored in MVP):

- **Derived times:** `first_in`, `last_out`, `lunch_out` / `lunch_in` (if present)
- **Durations:** `net_minutes`, `lunch_minutes` (observed vs expected)
- **Summary status:** worst open flag or `OK` (informational; payroll statuses deferred)

## Definitions

- **Attendance day**: local calendar day in **company timezone**.
- **On-shift**: employee has a dated Shift Assignment for that day.
- **Off-shift**: no Shift Assignment for that day or it’s a holiday/weekly-off.
- **Full-day shift**: a Shift Type where lunch fields are set.
- **Short shift**: a Shift Type without lunch fields (e.g. Saturday AM `FT_0800_1200`).

## Rule set (v0, MVP-compatible)

### 1) Determine expected shift for the day

For employee \(E\) on date \(D\):

- If \(D\) is a holiday / weekly off → **Off**.
- Else load Shift Assignment for \(E,D\).
  - If none → **Off** (or **Unassigned** if you want to track setup gaps).
  - Else shift type = `FT_*`.

Holiday source (MVP): resolve holiday dates from the employee’s **Company Default Holiday List** (`Company.default_holiday_list`). Holidays are displayed on the HR calendar/timeline, and the flag engine treats those days as **off-shift** (holiday wins) even if SSA-generated Shift Assignments exist.

### 2) Select relevant checkins for \(E,D\)

- Include all Employee Checkin rows for \(E\) whose `time` falls within:
  - \([D 00:00, D 23:59:59]\) in company timezone, **plus** an optional buffer window for near-midnight shifts (deferred).
- Sort ascending by time.

### 3) Identify primary punches

**MVP heuristic (device-agnostic):**

- `first_in` = earliest checkin time on \(D\)
- `last_out` = latest checkin time on \(D\)

If `log_type` is reliably populated:

- Prefer earliest `IN` for `first_in`
- Prefer latest `OUT` for `last_out`

### 4) Late start (flag)

Applies on **on-shift** days.

- Expected start = Shift Type `start_time`
- **Start grace** = `max(custom_grace_minutes, late_entry_grace_period)` (each treated as 0 if unset). Weekly schedule creation also writes both custom and HRMS grace fields from the profile.

Flag: **LATE_START** if:

- `first_in` exists and `first_in` > \(start + start\_grace\)
- If `first_in` missing → handle by missing-punch rules below.

### 5) Lunch window (full-day shifts only)

If shift type has `custom_lunch_start` and `custom_lunch_end`:

- Expected lunch start/end define a *window*.
- **Lunch return grace** = same as start grace (`max(custom_grace_minutes, late_entry_grace_period)`). A separate lunch-only grace field is deferred.

MVP detection (shared by closeout flags and HR calendar UI):

- **Observed lunch** = first plausible punch OUT→IN pair where:
  - OUT punch time is at or after `custom_lunch_start`
  - IN punch time is after OUT and on or before `custom_lunch_end + grace + 1 hour` slack
- **Validity guard:** ignore an observed pair if its duration is less than **half of the scheduled lunch length** (e.g. scheduled 60m → minimum observed 30m). When ignored, treat lunch as **not observed**.
- If no valid observed lunch exists, **assume scheduled lunch** for the lunch window (do not label it as Away, and do not emit lunch flags).
- **Late return** = valid observed IN after `custom_lunch_end + grace` → **LATE_FROM_LUNCH**.

The calendar API exposes `observed_lunch` on each day (same heuristic as closeout). UI uses this to distinguish **lunch** bands from **away** bands on the timeline.

Flags:

- **LATE_FROM_LUNCH**: valid observed lunch return after expected lunch end (plus grace) is late.

### 5b) Early departure (flag)

Applies on **on-shift** days with at least two punches.

- Expected end = Shift Type `end_time`
- **End grace** = `max(custom_grace_minutes, early_exit_grace_period)`

Flag: **LEFT_EARLY** if:

- `last_out` exists and `last_out` < \(end − end\_grace\)

### 6) Missing punches / insufficient data (flag)

Applies on **on-shift** days.

- **MISSING_ALL_PUNCHES**: no checkins on that day.
- **MISSING_IN_OR_OUT**: only one punch exists (cannot compute a work span).
- **SUSPICIOUS_SEQUENCE** (optional): too many punches, identical timestamps, etc.

### 7) Off-shift punches (flag)

If day is **off** but there are checkins:

- **OFF_SHIFT_PUNCH**: record punches but do not generate attendance status (MVP).

### 8) Work minutes (derived)

MVP:

- If `first_in` and `last_out` exist and `last_out` >= `first_in`:
  - `gross_minutes = last_out - first_in`
- If lunch detected and full-day:
  - `net_minutes = gross_minutes - lunch_minutes`
- Else:
  - `net_minutes = gross_minutes`

Later:

- cap extreme spans, handle multiple intervals, handle cross-midnight.

### 9) Work segments (UI / derived intervals)

HR calendar **segments** are derived from punches (not stored). Rules:

1. Sort checkins by `time` ascending.
2. Split into **branch runs**: consecutive punches with the same `custom_device_branch`. A branch change starts a new run.
3. **Missing branch** (`custom_device_branch` empty): treated as **rogue** — never grouped with other punches and never paired (each shows as an unpaired marker on the timeline). Does not pair with named branches either.
4. Within each **named** branch run only, pair punches **IN → OUT** using the MVP order heuristic (earliest = IN, latest = OUT, middle alternates). Each pair is one segment; segment `branch` is that run’s branch.
5. **Never** pair punches across different branches (e.g. OUT at site A must not close an IN at site B).
6. **Unpaired punch**: any rogue (no branch) punch, or the last punch in a named branch run when that run has an odd count (week timeline red tick).
7. **Lunch vs away** (UI timeline — **away** only between consecutive paired segments: segment end → next segment start):
   - **Observed lunch** (priority): when `observed_lunch` is present (punch-derived OUT→IN per §5), render a **Lunch · observed** band for that interval (sky). Inspector shows a **Lunch** row with OUT/IN times and duration; not labeled away.
   - **Scheduled lunch** (fallback): when no observed lunch but the segment→segment gap overlaps `[lunch_start, lunch_end + grace]`, the overlapping portion is **Lunch · scheduled** (solid muted fill). Remaining portions are **Away** (red solid).
   - **Away**: unaccounted time in a segment→segment gap, minus `[shift_start, shift_start + grace]` if overlapping. Not used for gaps involving unpaired punches — those show as unpaired markers only.
8. **Missing expected** (UI timeline — dashed red): on-shift obligation (shift start→end minus scheduled lunch) not covered by paired segments, **excluding** mid-day away intervals. Covers late start (before first segment), early leave / no return (after last segment), and holes when punch pairing is incomplete. On **today**, bands end at the **start of the present hour** (past only); they must not overlap the scheduled future band.
9. **Scheduled reference** (UI timeline — grey dashed): shift work windows (start→end minus scheduled lunch) from Shift Type. On **today**, bands start at the **present hour** through scheduled end; past days hide them; future days show the full windows. Tooltip: `Scheduled · {duration}`. Lunch is not a separate scheduled reference band — use observed/scheduled lunch gap bands instead.
10. **Week timeline scale** (UI): one time window for the whole week (earliest→latest punch ±30 min). **10 hours** of time map to the full viewport height; if the week span is shorter, that span is stretched to fill the column; if longer, the week grid grows taller and the week section scrolls internally (page stays `100dvh` without page scroll).

`Employee Checkin.log_type` is not used for segments in MVP (same as punch list IN/OUT labels).

**Flags vs segments:** `MISSING_IN_OR_OUT` (closeout) applies when the **day** has only one punch total; segment logic may still show zero segments or one unpaired marker. `NON_PRIMARY_SITE_PUNCH` is per punch vs `Employee.branch`, not per segment pairing.

## Decisions deferred (explicitly out of MVP)

- Payroll statuses: Present / Half Day / Absent (based on working hours thresholds).
- Shift spanning midnight.
- Device-specific IN/OUT correctness and mapping (verify types).
- Automatic approvals / penalties.

## Review + approval workflow (proposed)

### Async on punch + intraday + closeout

- **After each checkin:** enqueue `refresh_intraday_flags_for_employee_date` (coalesced per employee+date).
- **Intraday (provisional):** `day_closed = 0` — `LATE_START`, `NO_CHECKIN_YET`, `NON_PRIMARY_SITE_PUNCH` only. No `UNNOTIFIED_ABSENCE`.
- **Scheduler:** every 30 minutes during business hours → `refresh_intraday_flags_for_date(today)` (site config: `intraday_business_start_hour`, `intraday_business_end_hour`, `intraday_no_checkin_grace_hours`).
- **Device/company closeout (final):** delete AUTO flags with `day_closed = 0`, then write final AUTO flags with `day_closed = 1` (includes `UNNOTIFIED_ABSENCE` only on company fallback).
- Never mutate historical **Employee Checkin** rows.

### HR review

- Inbox: `Attendance Flag` where `status = OPEN` (filter by `flag_code`, date, employee).
- HR can approve/reject or add `HR` source flag (e.g. official duty).

### Employee explanation

- Employee updates the **flag** row: `employee_note` + attachment → `status = EXPLAINED`.

### HR approval

On each **Attendance Flag**:

- **Approve** (`APPROVED`)
- **Reject** (`REJECTED`)
- **Close** without payroll impact (`CLOSED`) — e.g. acknowledged warning

## Pilot checklist (rules acceptance)

- [ ] Late start flags match manual expectations for 20 random days across 5 employees
- [ ] Lunch late flags match policy for full-day staff
- [ ] Saturday short shift does not raise lunch flags
- [ ] Off-shift punches are visible and do not create payroll status
- [ ] Edge cases documented (missing checkins, device downtime)

