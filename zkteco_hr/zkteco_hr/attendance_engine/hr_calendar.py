import json
from collections import defaultdict
from datetime import timedelta

import frappe
from frappe.utils import get_datetime, getdate


def _require_hr_role():
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user) or [])
    if "System Manager" in roles or "HR User" in roles:
        return
    frappe.throw("Not permitted")


@frappe.whitelist()
def get_employee_calendar(employee: str, start_date: str, end_date: str):
    """
    HR calendar range API (MVP):
    - checkins bucketed per day
    - computed first/last + gross minutes (simple heuristic)
    - flags per day (chips)
    """
    _require_hr_role()

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be >= start_date")

    start_dt = get_datetime(str(start) + " 00:00:00")
    end_dt = get_datetime(str(end) + " 23:59:59")

    checkins = (
        frappe.get_all(
            "Employee Checkin",
            filters={"employee": employee, "time": ["between", [start_dt, end_dt]]},
            fields=["name", "time", "log_type", "device_id", "custom_device_branch"],
            order_by="time asc",
        )
        or []
    )

    flags = (
        frappe.get_all(
            "Attendance Flag",
            filters={"employee": employee, "attendance_date": ["between", [start, end]]},
            fields=[
                "name",
                "attendance_date",
                "flag_code",
                "severity",
                "source",
                "status",
                "day_closed",
                "rule_version",
                "evidence",
            ],
            order_by="attendance_date asc, creation asc",
        )
        or []
    )

    checkins_by_day = defaultdict(list)
    for c in checkins:
        d = getdate(c["time"])
        checkins_by_day[str(d)].append(c)

    flags_by_day = defaultdict(list)
    for f in flags:
        d = f.get("attendance_date")
        key = str(d) if d else None
        if not key:
            continue
        ev = f.get("evidence")
        if isinstance(ev, str) and ev:
            try:
                f["evidence"] = json.loads(ev)
            except Exception:
                f["evidence"] = None
        flags_by_day[key].append(f)

    days = []
    cur = start
    while cur <= end:
        key = str(cur)
        day_checkins = checkins_by_day.get(key, [])
        first_in = day_checkins[0]["time"] if day_checkins else None
        last_out = day_checkins[-1]["time"] if day_checkins else None

        gross_minutes = None
        if first_in and last_out and last_out >= first_in:
            gross_minutes = int((last_out - first_in).total_seconds() / 60)

        days.append(
            {
                "date": key,
                "checkins": day_checkins,
                "first_in": first_in,
                "last_out": last_out,
                "gross_minutes": gross_minutes,
                "flags": flags_by_day.get(key, []),
            }
        )
        cur = cur + timedelta(days=1)

    return {
        "employee": employee,
        "start_date": str(start),
        "end_date": str(end),
        "days": days,
    }

