# Schedule Coverage page — design

**Date:** 2026-06-29
**Status:** Approved (build)
**Branch:** `feat/schedule-coverage-page`

## Problem

HR has no single place to (1) spot active employees who have **no shift assignment yet**
so they can add one manually, or (2) audit how **weekly scheduled hours** are distributed
across staff. Today both questions require ad-hoc Desk reports or eyeballing the calendar.

## Goal

One HR-only page with two read-only tracking views:

1. **Needs a schedule** — active employees where `has_shift_assignment === false`, with a
   one-click jump into the existing schedule wizard (employee preselected).
2. **Weekly hours** — every *assigned* employee grouped by their scheduled weekly hours,
   rounded to the nearest 30 minutes, shown as a breakdown of all buckets (high → low).

## Non-goals (YAGNI)

- Actual-worked-hours (from checkins) — this page is **scheduled** hours only.
- Inline schedule editing — we deep-link to the existing wizard instead.
- CSV export. Per-department roll-ups. Multi-week comparison. (All easy to add later.)

## Placement & routing

- Route **`/hr-schedule/coverage`**. Routing under `/hr-schedule/*` means the existing
  `hooks.py` website-route rewrite already covers a hard reload — **no backend route or
  `www/` change** (same property `/hr-schedule/import` relies on).
- Surfaced as a **third top-level tab "Coverage"** in `HrAppShell`, HR-staff-only (like the
  Schedule tab). `activeTab()` must check `/hr-schedule/coverage` **before** `/hr-schedule`
  so the right tab highlights.
- Access-gated client-side via the `hr_staff` flag from `get_calendar_session` — non-HR
  users are `<Navigate>`d away, exactly like `ScheduleImportPage`.

## Backend — one new read API

`get_schedule_coverage()` — whitelisted, `_require_hr_role()`, in a new small
`attendance_engine/coverage_api.py`.

It **orchestrates existing, tested helpers** rather than introducing new schedule math:

- Active employees + per-employee `has_shift_assignment` come from the same rows
  `_list_calendar_employee_rows(None, include_all=True)` already builds (`hr_calendar.py`).
- For each *assigned* employee, weekly minutes =
  `weekly_scheduled_minutes({"frequency": "Every Week", "days": week_pattern_from_ssas(emp)})`
  reusing `week_pattern_from_ssas` (`schedule_resolver.py`) and `weekly_scheduled_minutes`
  (`employment_type.py`, already overnight-aware and lunch-excluded). This guarantees the
  hours match what the wizard/calendar shows.

**Response shape:**

```json
{
  "unassigned": [
    { "id": "EMP-001", "employee_name": "...", "department": "...",
      "employment_type": "...", "title": "...", "image": "..." }
  ],
  "assigned": [
    { "id": "EMP-002", "employee_name": "...", "department": "...",
      "employment_type": "...", "title": "...", "image": "...",
      "weekly_minutes": 2400 }
  ],
  "counts": { "active": 120, "unassigned": 8, "assigned": 112 }
}
```

Rounding-to-30 and bucket grouping are **not** done server-side — the API returns raw
`weekly_minutes` per assigned employee; the client buckets (keeps presentation logic
unit-testable and adjustable without a backend deploy).

**Performance:** the per-employee `week_pattern_from_ssas` loop is O(active employees),
the same cost `list_weekly_schedule_templates` already pays. Mitigate identically: cache
the assembled payload in `frappe.cache()` (~120 s TTL). Flagged as the one real perf risk.

## Frontend

- **Pure, unit-tested logic** in `src/lib/scheduleCoverage.ts` (under the `test:web` glob):
  - `roundMinutesToHalfHour(minutes)` → nearest 30.
  - `bucketByWeeklyHours(assigned)` → `[{ minutes, label, employees }]` sorted desc, with a
    trailing `0`-minute "No resolved hours" bucket for assigned-but-unresolved employees.
  - bucket label via existing `formatScheduleDuration`.
- **Hook** `useScheduleCoverage` — fetches `get_schedule_coverage` via frappe-react-sdk
  (`useFrappeGetCall`), exposes `{ unassigned, buckets, counts, isLoading, error }`.
- **Components** under `src/ui/schedule-coverage/`:
  - `ScheduleCoveragePage.tsx` — access gate + header + segmented toggle between the two
    views (default to "Needs a schedule" when any exist, else "Weekly hours").
  - `UnassignedList.tsx` — rows with name · ID · dept · type and an **"Add schedule →"**
    button that navigates to `/hr-schedule?employee=<id>` (the wizard already reads the
    `employee` query param; confirm preselect, add if missing).
  - `HoursBuckets.tsx` — collapsible bucket cards (`40h · 12 people` → roster).
- **Nav** — add the `coverage` tab + fix `activeTab` ordering in `HrAppShell.tsx`.

## Testing

- **Python unittest** (`tests/test_coverage_api.py`): mock `frappe`, patch the employee-rows
  helper + `week_pattern_from_ssas`; assert `get_schedule_coverage` splits assigned vs
  unassigned correctly, attaches `weekly_minutes`, and returns stable `counts`.
- **Frontend node:test** (`src/lib/scheduleCoverage.test.ts`): rounding edges (2410→2400,
  2420→2430, exact-half 2415→2430 round-up), bucket grouping/sorting desc, the trailing
  0-minute "No resolved hours" bucket, empty input.
- All gated by the existing CI jobs (`tests`, `unit-web`).

## Risks / edge cases

- **Assigned but 0 resolved minutes** (broken/partial SSA): surfaced in the trailing
  "No resolved hours" bucket, not silently dropped.
- **Wizard preselect**: if `/hr-schedule` doesn't already honor `?employee=`, add it — small
  change, must verify.
- **Tab highlight**: `/hr-schedule/coverage` must not light up the Schedule tab — ordering
  fix in `activeTab`.
- **500-employee cap**: `_list_calendar_employee_rows` uses `limit_page_length=500`; if an
  org exceeds that, coverage is capped too. Acceptable now; note for future paging.
