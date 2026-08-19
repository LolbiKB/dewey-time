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

from dewey_time.attendance_engine.employment_type import (
    is_clock_based,
    is_weekly_schedule_eligible,
    weekly_scheduled_minutes,
)
from dewey_time.attendance_engine.hr_calendar import (
    _list_calendar_employee_rows,
    _require_hr_role,
)
from dewey_time.attendance_engine.schedule_resolver import week_pattern_from_ssas

# The version suffix is tied to the SHAPE of the cached payload, not to this
# module's behaviour: bump it whenever a field is added, renamed or removed
# anywhere in what get_schedule_coverage returns. A deploy does not clear
# Redis, so for the whole TTL afterwards a key written by the OLD code can
# still answer a request from the NEW frontend; a new prefix simply cannot be
# hit by pre-deploy entries.
#
# v2: employee rows (both assigned and unassigned) gained
# custom_khmer_last_name / custom_khmer_first_name.
# v3: employee rows gained `telegram`.
#: v4: rows gained `schedule_expectation`.
_CACHE_KEY = "schedule_coverage:v4"
_CACHE_TTL_SECONDS = 120

# The Employee column a prior Telegram notifier left behind, holding a numeric
# Telegram user id. THIS APP DOES NOT INSTALL IT -- setup/custom_fields.py owns
# no such field -- so every read of it is guarded by has_column, the same way
# hr_calendar guards the Khmer pair. A site without it simply never reports
# `id_on_file`, which is the truth there: there is no id on file because there
# is nowhere to put one.
_TELEGRAM_ID_FIELD = "custom_telegram_chat_id"

# Upper bound on active employees scanned for coverage. Higher than the calendar
# picker's 500 (this is meant to be an exhaustive roster); `truncated` flags when hit.
COVERAGE_EMPLOYEE_LIMIT = 2000

# Keys copied verbatim from the calendar employee rows into the coverage payload.
# `branch` is here so the register can filter by site even when the biometric
# feed is down -- branch is a property of the employee, not of their enrolment.
_EMPLOYEE_FIELDS = (
    "id",
    "employee_name",
    "department",
    "employment_type",
    "title",
    "image",
    "branch",
    "custom_khmer_last_name",
    "custom_khmer_first_name",
)


#: Whether this employee is SUPPOSED to have a weekly schedule.
#:
#: The register bucketed purely on `has_shift_assignment`, which cannot tell
#: three different situations apart and reported all of them as "schedule
#: missing":
#:
#:   scheduled     Full-time and friends. No assignment IS a coverage failure.
#:   clock         Contract, Casual, hourly teachers. They clock in and out and
#:                 no schedule exists to judge them against -- closeout.py:624
#:                 applies only punch-integrity and location flags on their
#:                 days. Reporting them as missing a schedule is a false
#:                 finding, and it scales with every rotating teacher added.
#:   unclassified  Employment type is blank. This is the one that needs a human:
#:                 `is_clock_based` deliberately refuses to treat blank as
#:                 clock-based, so until somebody classifies them the engine
#:                 judges them against a shift they do not have and flags every
#:                 scan they make.
#:
#: Resolved HERE rather than shipping the raw type, so the allowlist stays in
#: employment_type.py. A second copy in TypeScript would be a second thing to
#: keep in step with the first.
def _schedule_expectation(employment_type) -> str:
    if is_weekly_schedule_eligible(employment_type):
        return "scheduled"
    if is_clock_based(employment_type):
        return "clock"
    return "unclassified"


def _employee_base(row: dict) -> dict:
    base = {key: row.get(key) for key in _EMPLOYEE_FIELDS}
    base["schedule_expectation"] = _schedule_expectation(row.get("employment_type"))
    return base


def _telegram_status_by_employee(employee_ids: list[str]) -> dict[str, str]:
    """employee id -> "linked" | "id_on_file" | "none", for the register's column.

    Three states because HR does three different things with them: a linked
    employee is done, one with an id on file has been recorded by some earlier
    notifier and needs no link once auto-binding lands, and one with neither
    needs a link issued today. Collapsing the middle into "not linked" would
    hide the only part of the rollout that is already paid for.

    "linked" wins over "id_on_file" when both are true. The link is the fact
    that matters -- an id on file is a lead, a link is a binding -- and a row
    that reported the lead while the binding already existed would be a
    standing invitation to redo work that is done.

    Returns {} on any failure, which the caller turns into `telegram: None` --
    the register's own rule that a fact no feed vouched for is silence, never a
    finding. An empty dict is also what a site with no Telegram Link doctype
    yields, so a bench mid-migration degrades to a blank column rather than a
    roster of false "needs a link".
    """
    if not employee_ids:
        return {}

    try:
        linked = {
            row["employee"]
            for row in frappe.get_all(
                "Telegram Link",
                filters={"employee": ["in", employee_ids], "enabled": 1},
                fields=["employee"],
            )
            or []
        }
    except Exception:
        frappe.log_error(title="schedule coverage: telegram link lookup failed")
        return {}

    with_id: set[str] = set()
    if frappe.db.has_column("Employee", _TELEGRAM_ID_FIELD):
        try:
            with_id = {
                row["name"]
                for row in frappe.get_all(
                    "Employee",
                    filters={"name": ["in", employee_ids]},
                    fields=["name", _TELEGRAM_ID_FIELD],
                )
                or []
                # Filtered in Python rather than in the query: the column is
                # free-text Data, so "empty" is both NULL and "", and expressing
                # that as a Frappe filter is more fragile than reading it here.
                if str(row.get(_TELEGRAM_ID_FIELD) or "").strip()
            }
        except Exception:
            frappe.log_error(title="schedule coverage: telegram id lookup failed")
            with_id = set()

    status = {}
    for employee in employee_ids:
        if employee in linked:
            status[employee] = "linked"
        elif employee in with_id:
            status[employee] = "id_on_file"
        else:
            status[employee] = "none"
    return status


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
    telegram = _telegram_status_by_employee([row["id"] for row in rows])

    unassigned: list[dict] = []
    assigned: list[dict] = []
    for row in rows:
        # `.get`, so a failed lookup lands as None on every row rather than
        # KeyError-ing the whole payload -- one absent column must not take the
        # register down.
        base = {**_employee_base(row), "telegram": telegram.get(row["id"])}
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
