import json
from datetime import timedelta

import frappe
from frappe.utils import get_datetime, getdate

from zkteco_hr.attendance_engine.hr_calendar import _require_calendar_access


@frappe.whitelist()
def get_my_week(employee: str, start_date: str, end_date: str):
    """
    MVP read API for Desk:
    - checkins per day
    - computed first/last + gross minutes (simple heuristic)
    - flags per day

    Access: HR staff may read any employee; everyone else may read only the
    Employee linked to their own user (same rule as the hr_calendar read API).
    """
    _require_calendar_access(employee)

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be >= start_date")

    days = []
    cur = start
    while cur <= end:
        days.append(_get_day(employee=employee, attendance_date=cur))
        cur = cur + timedelta(days=1)

    return {"employee": employee, "start_date": str(start), "end_date": str(end), "days": days}


def _get_day(*, employee: str, attendance_date):
    attendance_date = getdate(attendance_date)
    start = get_datetime(str(attendance_date) + " 00:00:00")
    end = get_datetime(str(attendance_date) + " 23:59:59")

    checkins = (
        frappe.get_all(
            "Employee Checkin",
            filters={"employee": employee, "time": ["between", [start, end]]},
            fields=["time", "log_type", "device_id", "custom_device_branch"],
            order_by="time asc",
        )
        or []
    )

    first_in = checkins[0]["time"] if checkins else None
    last_out = checkins[-1]["time"] if checkins else None

    gross_minutes = None
    if first_in and last_out and last_out >= first_in:
        gross_minutes = int((last_out - first_in).total_seconds() / 60)

    flags = (
        frappe.get_all(
            "Attendance Flag",
            filters={"employee": employee, "attendance_date": attendance_date},
            fields=[
                "name",
                "flag_code",
                "severity",
                "source",
                "status",
                "day_closed",
                "rule_version",
                "evidence",
            ],
            order_by="creation asc",
        )
        or []
    )

    for f in flags:
        ev = f.get("evidence")
        if isinstance(ev, str) and ev:
            try:
                f["evidence"] = json.loads(ev)
            except Exception:
                f["evidence"] = None

    return {
        "date": str(attendance_date),
        "checkins": checkins,
        "first_in": first_in,
        "last_out": last_out,
        "gross_minutes": gross_minutes,
        "flags": flags,
    }

