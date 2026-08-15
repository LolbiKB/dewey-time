"""The Mini App's only read endpoint.

Two properties carry this module, and both are structural rather than vigilant:

1. It takes NO employee-selecting parameter. An attacker cannot name a victim
   because there is no field to put one in. A test guards the signature, and
   exists because that property will die to a reasonable future edit -- a
   manager view adding `employee=` -- rather than to an attack.

2. The projection is an ALLOWLIST. Written as removals it would fail open: a
   field added to the calendar builder for an HR need would reach every
   employee silently, with no test failing. Built this way, a new field is
   hidden by default and exposing one is a deliberate edit.

The payload this narrows is HR-shaped -- device serials, `last_error`, flag
evidence, internal flag names, grace minutes. None of it is an employee's to
see, and `build_employee_calendar` says so at its own definition.
"""

import frappe
from frappe.utils import date_diff, getdate

from dewey_time.attendance_engine import hr_calendar
from dewey_time.telegram import miniapp_auth

#: One launch cannot pull more than this. Wide enough for a month view, narrow
#: enough that it is not a history export.
MAX_RANGE_DAYS = 62

DAY_KEYS = ("date", "shift", "checkins", "holiday", "leave", "observed_lunch")
SHIFT_KEYS = (
    "shift_assigned",
    "shift_type",
    "start_time",
    "end_time",
    "lunch_start",
    "lunch_end",
)
#: NOT device_id and NOT custom_device_branch -- those are HR's. A top-level
#: allowlist alone would pass them through inside each punch object.
CHECKIN_KEYS = ("time", "log_type")


def _pick(source, keys):
    source = source or {}
    return {k: source[k] for k in keys if k in source}


def narrow(payload: dict) -> dict:
    """Project the HR calendar payload down to what an employee may see."""
    days = []
    for day in payload.get("days") or []:
        narrowed = _pick(day, DAY_KEYS)
        # Only if the source had one. Fabricating an empty shift would make an
        # off day render as a scheduled one.
        if "shift" in narrowed:
            narrowed["shift"] = _pick(day.get("shift"), SHIFT_KEYS)
        narrowed["checkins"] = [
            _pick(c, CHECKIN_KEYS) for c in (day.get("checkins") or [])
        ]
        days.append(narrowed)
    return {"employee": payload.get("employee"), "days": days}


@frappe.whitelist(allow_guest=True)
def get_my_calendar(init_data: str, start_date: str, end_date: str) -> dict:
    """The employee's own calendar, resolved from their Telegram binding.

    allow_guest because no Frappe User exists for these callers by design. The
    initData signature and the binding are the entire authorization -- see
    miniapp_auth's module docstring for why there is nothing beneath them.
    """
    # FIRST, before any other validation. Checking the range first would let an
    # unauthenticated caller probe for accepted date windows.
    employee = miniapp_auth.employee_from_init_data(init_data)

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")
    if date_diff(end, start) > MAX_RANGE_DAYS:
        frappe.throw(f"Range is limited to {MAX_RANGE_DAYS} days")

    return narrow(hr_calendar.build_employee_calendar(employee, str(start), str(end)))
