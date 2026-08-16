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

#: first_in/last_out are derived server-side from this employee's own punches
#: (hr_calendar.py:791) and are strictly less than the punch list already
#: allowed below -- if they can see every punch, the first and last of them
#: are not a new disclosure. The week view reads them via
#: formatDayCheckinTimeRange.
DAY_KEYS = (
    "date",
    "shift",
    "checkins",
    "holiday",
    "leave",
    "observed_lunch",
    "first_in",
    "last_out",
)
SHIFT_KEYS = (
    "shift_assigned",
    "shift_type",
    "start_time",
    "end_time",
    "lunch_start",
    "lunch_end",
)
#: `custom_device_branch` is IN; `device_id` is out, and the line between them
#: is deliberate. The branch is a place the employee physically stood, which is
#: their own attendance fact -- the check-in notification already tells them
#: ("Checked in 07:58 · DIS Iconic"). The device serial is infrastructure.
#:
#: It is also load-bearing for rendering, which is how the original omission
#: was caught: attendancePunches.ts:37 -- "Punches without
#: custom_device_branch are never grouped -- each is its own run (rogue)" --
#: so dropping it made every punch draw as an anomaly on the timeline. Only
#: looking at the rendered page found that; no unit test could.
CHECKIN_KEYS = ("time", "log_type", "custom_device_branch")


def _pick(source, keys):
    source = source or {}
    return {k: source[k] for k in keys if k in source}


#: Top-level keys an employee may see about themselves.
#:
#: `employee_branch` is their own primary site -- the same fact the check-in
#: notification already states ("Checked in 07:58 · DIS Iconic"). Everything
#: else the payload carries at this level stays out: `device_alerts` and
#: `device_sync` are infrastructure health, and `_employee_nav_meta` is the
#: SPA's picker plumbing.
PAYLOAD_KEYS = ("employee", "employee_branch")


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
    return {**_pick(payload, PAYLOAD_KEYS), "days": days}


def _identity(employee: str) -> dict:
    """Who the server resolved this launch to.

    THE POINT IS CONFIRMATION, not decoration. Telegram already knows the
    user's own name and echoing it back proves nothing; what an employee cannot
    otherwise check is which Employee record their account is bound to. The
    recorded-id bind path makes that worth showing: it trusts an id somebody
    recorded, and a wrong one binds a stranger silently. Seeing someone else's
    name at the top of the app is how that gets reported on day one instead of
    never.

    Khmer name included because for a great many of these employees it is the
    name they would actually recognise as theirs, and an English transliteration
    they never use is a poor thing to verify an identity against.
    """
    fields = ["employee_name", "designation"]
    # Installed by dewey_time.setup.custom_fields, but a site mid-migration may
    # not have them yet -- and an unknown column makes the select raise, which
    # would take the whole Mini App down to lose one optional name.
    khmer_fields = [
        field
        for field in ("custom_khmer_last_name", "custom_khmer_first_name")
        if frappe.db.has_column("Employee", field)
    ]
    row = frappe.db.get_value("Employee", employee, fields + khmer_fields, as_dict=True) or {}
    khmer = " ".join(
        part for part in (
            row.get("custom_khmer_last_name"),
            row.get("custom_khmer_first_name"),
        ) if part
    ).strip()
    return {
        "employee_name": row.get("employee_name"),
        "designation": row.get("designation"),
        "khmer_name": khmer or None,
    }


# POST-only, deliberately. Without methods=[...] Frappe also accepts GET, and
# a GET would carry init_data -- the entire authentication credential -- in the
# query string, where it lands in the web server's access log, any proxy in
# front of it, and the webview's history. The webhook already pins this; this
# endpoint did not.
@frappe.whitelist(allow_guest=True, methods=["POST"])
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

    payload = narrow(hr_calendar.build_employee_calendar(employee, str(start), str(end)))
    # Merged here rather than inside narrow(): narrow is a pure projection of
    # what it is handed, and identity is a separate lookup. Keeping it pure is
    # what lets the allowlist tests feed it a fabricated HR payload.
    return {**payload, **_identity(employee)}
