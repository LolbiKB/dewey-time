"""Schedule coverage read API.

Backs the HR-only Schedule Coverage page (/hr-schedule/coverage) with two views:
  1. Active employees with no shift assignment yet ("needs a schedule").
  2. Assigned employees + their resolved weekly scheduled minutes, for the
     client to group into nearest-30-minute hours buckets.

It orchestrates existing, tested helpers rather than introducing new schedule
math: employee rows + assignment flags come from hr_calendar; weekly minutes
reuse week_pattern_from_ssas (schedule_resolver) summed by weekly_scheduled_minutes
(employment_type), so the hours match what the wizard/calendar shows.
"""

from __future__ import annotations

import frappe

from dewey_time.attendance_engine.employment_type import weekly_scheduled_minutes
from dewey_time.attendance_engine.hr_calendar import (
    _list_calendar_employee_rows,
    _require_hr_role,
)
from dewey_time.attendance_engine.schedule_resolver import week_pattern_from_ssas

_CACHE_KEY = "schedule_coverage:v1"
_CACHE_TTL_SECONDS = 120

# Upper bound on active employees scanned for coverage. Higher than the calendar
# picker's 500 (this is meant to be an exhaustive roster); `truncated` flags when hit.
COVERAGE_EMPLOYEE_LIMIT = 2000

# Keys copied verbatim from the calendar employee rows into the coverage payload.
_EMPLOYEE_FIELDS = ("id", "employee_name", "department", "employment_type", "title", "image")


def _employee_base(row: dict) -> dict:
    return {key: row.get(key) for key in _EMPLOYEE_FIELDS}


def _employee_weekly_minutes(employee: str) -> int:
    """Resolved scheduled minutes/week for an assigned employee; 0 if unresolvable."""
    try:
        days = week_pattern_from_ssas(employee)
    except Exception:
        frappe.log_error(title="schedule coverage: week pattern resolution failed")
        return 0
    return weekly_scheduled_minutes({"frequency": "Every Week", "days": days})


def _build_coverage_payload() -> dict:
    rows = _list_calendar_employee_rows(None, include_all=True, limit=COVERAGE_EMPLOYEE_LIMIT)

    unassigned: list[dict] = []
    assigned: list[dict] = []
    for row in rows:
        base = _employee_base(row)
        if row.get("has_shift_assignment"):
            assigned.append({**base, "weekly_minutes": _employee_weekly_minutes(row["id"])})
        else:
            unassigned.append(base)

    return {
        "unassigned": unassigned,
        "assigned": assigned,
        "counts": {
            "active": len(rows),
            "unassigned": len(unassigned),
            "assigned": len(assigned),
            # True when the scan hit the cap, so the UI can flag the roster as partial.
            "truncated": len(rows) >= COVERAGE_EMPLOYEE_LIMIT,
        },
    }


def invalidate_coverage_cache(doc=None, method=None):
    """Drop the cached coverage payload. Wired to Shift Schedule Assignment doc events
    (after_insert / on_update / on_trash) so applying or clearing a schedule is reflected
    immediately rather than after the TTL."""
    frappe.cache().delete_value(_CACHE_KEY)


@frappe.whitelist()
def get_schedule_coverage():
    """HR-only: active employees split into unassigned vs assigned (+ weekly minutes).

    Cached briefly (the per-employee week-pattern loop is O(active employees), the
    same cost list_weekly_schedule_templates pays).
    """
    _require_hr_role()

    cached = frappe.cache().get_value(_CACHE_KEY)
    if cached:
        return cached

    payload = _build_coverage_payload()
    frappe.cache().set_value(_CACHE_KEY, payload, expires_in_sec=_CACHE_TTL_SECONDS)
    return payload
