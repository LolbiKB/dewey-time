import json
from collections import defaultdict
from datetime import timedelta

import frappe
from frappe.utils import get_datetime, getdate

from zkteco_hr.attendance_engine.closeout import _get_shift_assignment, _get_shift_meta


def _require_hr_role():
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user) or [])
    if "System Manager" in roles or "HR User" in roles:
        return
    frappe.throw("Not permitted")


def _format_time(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%H:%M:%S")
    text = str(value).strip()
    if not text:
        return None
    return text.split(".")[0]


def _format_datetime(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _shift_context_for_day(*, employee: str, attendance_date):
    assignment = _get_shift_assignment(employee=employee, attendance_date=attendance_date)
    if not assignment or not assignment.get("shift_type"):
        return {"shift_assigned": False}

    meta = _get_shift_meta(assignment["shift_type"])
    if not meta:
        return {"shift_assigned": False}

    return {
        "shift_assigned": True,
        "shift_type": assignment["shift_type"],
        "start_time": _format_time(meta.get("start_time")),
        "end_time": _format_time(meta.get("end_time")),
        "grace_minutes": meta.get("custom_grace_minutes") or 0,
        "lunch_start": _format_time(meta.get("custom_lunch_start")),
        "lunch_end": _format_time(meta.get("custom_lunch_end")),
    }


@frappe.whitelist()
def list_calendar_employees():
    """Active employees for the HR attendance calendar picker."""
    _require_hr_role()

    rows = (
        frappe.get_all(
            "Employee",
            filters={"status": "Active"},
            fields=["name", "employee_name", "designation", "department", "company", "image"],
            order_by="employee_name asc",
            limit_page_length=500,
        )
        or []
    )

    employees = []
    for row in rows:
        display_name = row.get("employee_name") or row.get("name")
        employees.append(
            {
                "id": row["name"],
                "label": f"{row['name']} · {display_name}",
                "image": row.get("image"),
                "title": row.get("designation"),
                "department": row.get("department"),
                "company": row.get("company"),
            }
        )
    return employees


@frappe.whitelist()
def get_employee_calendar(employee: str, start_date: str, end_date: str):
    """
    HR calendar range API (MVP):
    - checkins bucketed per day
    - computed first/last + gross minutes (simple heuristic)
    - flags per day (chips)
    - shift context per day (when assigned)
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

    employee_branch = frappe.db.get_value("Employee", employee, "branch")
    device_alerts = []
    if employee_branch:
        device_alerts = (
            frappe.get_all(
                "Device Closeout Alert",
                filters={
                    "branch": employee_branch,
                    "local_date": ["between", [start, end]],
                    "resolved_at": ["is", "not set"],
                },
                fields=["device_sn", "branch", "local_date", "status", "last_error"],
                order_by="local_date asc, device_sn asc",
            )
            or []
        )
        for row in device_alerts:
            if row.get("local_date"):
                row["local_date"] = str(row["local_date"])

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
        checkins_by_day[str(d)].append(
            {
                **c,
                "time": _format_datetime(c.get("time")),
            }
        )

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
        day_closed = f.get("day_closed")
        flags_by_day[key].append(
            {
                **f,
                "is_provisional": day_closed == 0,
            }
        )

    days = []
    cur = start
    while cur <= end:
        key = str(cur)
        day_checkins = checkins_by_day.get(key, [])
        first_in = day_checkins[0]["time"] if day_checkins else None
        last_out = day_checkins[-1]["time"] if day_checkins else None

        gross_minutes = None
        if first_in and last_out:
            first_dt = get_datetime(first_in)
            last_dt = get_datetime(last_out)
            if last_dt >= first_dt:
                gross_minutes = int((last_dt - first_dt).total_seconds() / 60)

        days.append(
            {
                "date": key,
                "shift": _shift_context_for_day(employee=employee, attendance_date=cur),
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
        "device_alerts": device_alerts,
    }
