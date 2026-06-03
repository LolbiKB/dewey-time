from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta

import frappe
from frappe.utils import get_datetime, getdate

from zkteco_hr.attendance_engine.closeout import _get_shift_meta
from zkteco_hr.attendance_engine.lunch_detection import detect_observed_lunch
from zkteco_hr.attendance_engine.shift_grace import effective_lunch_return_grace, effective_start_grace
from zkteco_hr.attendance_engine.holidays import holiday_by_date_for_company
from zkteco_hr.attendance_engine.shift_assignment import (
    get_shift_assignment as _get_shift_assignment,
    shift_assignment_bounds_by_employee,
)


def _require_hr_role():
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user) or [])
    if "System Manager" in roles or "HR User" in roles:
        return
    frappe.throw("Not permitted")


def _coerce_bool(value, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes")


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


def is_full_time_employment(employment_type: str | None) -> bool:
    """True when employment_type looks like full-time (not part-time / contract variants)."""
    if not employment_type:
        return False
    normalized = str(employment_type).strip().lower().replace("-", " ")
    if "part" in normalized:
        return False
    return "full" in normalized


def _shift_schedule_assignment_start_field() -> str | None:
    """HRMS uses create_shifts_after; older/custom schemas may use from_date."""
    if frappe.db.has_column("Shift Schedule Assignment", "create_shifts_after"):
        return "create_shifts_after"
    if frappe.db.has_column("Shift Schedule Assignment", "from_date"):
        return "from_date"
    return None


def _shift_schedule_assignment_metadata_by_employee(employee_ids: list[str]) -> dict[str, dict]:
    """Enabled Shift Schedule Assignment rows (HR Setup), keyed by employee."""
    if not employee_ids or not frappe.db.table_exists("Shift Schedule Assignment"):
        return {}

    start_field = _shift_schedule_assignment_start_field()
    fields = ["employee", "name"]
    if start_field:
        fields.append(start_field)
    if frappe.db.has_column("Shift Schedule Assignment", "end_date"):
        fields.append("end_date")

    filters: dict = {"employee": ["in", employee_ids]}
    if frappe.db.has_column("Shift Schedule Assignment", "enabled"):
        filters["enabled"] = 1

    order_by = f"{start_field} desc, creation desc" if start_field else "creation desc"

    today = getdate()
    by_employee: dict[str, dict] = {}
    rows = (
        frappe.get_all(
            "Shift Schedule Assignment",
            filters=filters,
            fields=fields,
            order_by=order_by,
        )
        or []
    )

    for row in rows:
        emp = row.get("employee")
        if not emp or emp in by_employee:
            continue
        end_date = row.get("end_date")
        if end_date and getdate(end_date) < today:
            continue
        start_date = row.get(start_field) if start_field else None
        by_employee[emp] = {
            "has_shift_assignment": True,
            "has_shift_schedule_assignment": True,
            "shift_schedule_assignment": row.get("name"),
            "schedule_min_date": str(getdate(start_date)) if start_date else None,
            "schedule_max_date": str(getdate(end_date)) if end_date else None,
        }
    return by_employee


def employee_has_active_shift_schedule_assignment(employee: str) -> bool:
    """Whether the employee has an enabled Shift Schedule Assignment (metadata only)."""
    return employee in _shift_schedule_assignment_metadata_by_employee([employee])


def _active_shift_schedule_assignment_employees(employee_ids: list[str]) -> set[str]:
    return set(_shift_schedule_assignment_metadata_by_employee(employee_ids).keys())


def _leave_by_date_for_range(*, employee: str, start, end) -> dict[str, dict]:
    """Approved leave applications overlapping [start, end], keyed by yyyy-mm-dd."""
    if not frappe.db.table_exists("Leave Application"):
        return {}

    rows = (
        frappe.get_all(
            "Leave Application",
            filters={
                "employee": employee,
                "docstatus": 1,
                "status": "Approved",
                "from_date": ["<=", end],
                "to_date": [">=", start],
            },
            fields=["from_date", "to_date", "leave_type"],
        )
        or []
    )

    by_date: dict[str, dict] = {}
    for row in rows:
        from_d = getdate(row["from_date"])
        to_d = getdate(row["to_date"])
        leave_type = row.get("leave_type")
        cur = from_d if from_d > start else start
        end_d = to_d if to_d < end else end
        while cur <= end_d:
            key = str(cur)
            by_date[key] = {"on_leave": True, "leave_type": leave_type}
            cur = cur + timedelta(days=1)
    return by_date


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
        "grace_minutes": effective_start_grace(meta),
        "lunch_start": _format_time(meta.get("custom_lunch_start")),
        "lunch_end": _format_time(meta.get("custom_lunch_end")),
    }


def first_checkin_date_by_employee(employee_ids: list[str]) -> dict[str, dict]:
    """
    Earliest calendar day (`Employee Checkin.time`) with any punch row, per employee.
    Includes off-shift / demo seed rows — week-nav backward bound only (not flag logic).
    """
    if not employee_ids or not frappe.db.table_exists("Employee Checkin"):
        return {}

    placeholders = ", ".join(["%s"] * len(employee_ids))
    rows = frappe.db.sql(
        f"""
        SELECT employee, MIN(DATE(`time`)) AS first_checkin_date
        FROM `tabEmployee Checkin`
        WHERE employee IN ({placeholders})
          AND `time` IS NOT NULL
        GROUP BY employee
        """,
        tuple(employee_ids),
        as_dict=True,
    )

    out: dict[str, dict] = {}
    for row in rows or []:
        emp = row.get("employee")
        if not emp:
            continue
        first = row.get("first_checkin_date")
        out[emp] = {
            "first_checkin_date": str(getdate(first)) if first else None,
        }
    return out


@frappe.whitelist()
def list_calendar_employees(include_without_shifts=True):
    """
    Active employees for the HR attendance calendar picker.

    include_without_shifts: when false, omit employees with no enabled Shift Schedule Assignment.
    """
    _require_hr_role()
    include_all = _coerce_bool(include_without_shifts, default=True)

    fields = ["name", "employee_name", "designation", "department", "company", "image"]
    if frappe.db.has_column("Employee", "employment_type"):
        fields.append("employment_type")

    rows = (
        frappe.get_all(
            "Employee",
            filters={"status": "Active"},
            fields=fields,
            order_by="employee_name asc",
            limit_page_length=500,
        )
        or []
    )

    employee_ids = [row["name"] for row in rows]
    try:
        ssa_by_employee = _shift_schedule_assignment_metadata_by_employee(employee_ids)
    except Exception:
        frappe.log_error(title="list_calendar_employees SSA metadata failed")
        ssa_by_employee = {}
    try:
        assignment_bounds = shift_assignment_bounds_by_employee(employee_ids)
    except Exception:
        frappe.log_error(title="list_calendar_employees shift bounds failed")
        assignment_bounds = {}
    try:
        checkin_bounds = first_checkin_date_by_employee(employee_ids)
    except Exception:
        frappe.log_error(title="list_calendar_employees first checkin bounds failed")
        checkin_bounds = {}

    employees = []
    for row in rows:
        emp_id = row["name"]
        ssa = ssa_by_employee.get(emp_id, {})
        bounds = assignment_bounds.get(emp_id, {})
        checkins = checkin_bounds.get(emp_id, {})
        has_shift_assignment = ssa.get("has_shift_assignment") is True
        if not include_all and not has_shift_assignment:
            continue

        display_name = row.get("employee_name") or emp_id
        employment_type = row.get("employment_type")
        schedule_min_date = bounds.get("schedule_min_date") or ssa.get("schedule_min_date")
        schedule_max_date = bounds.get("schedule_max_date")
        if schedule_max_date is None and bounds.get("schedule_min_date"):
            schedule_max_date = None
        elif schedule_max_date is None:
            schedule_max_date = ssa.get("schedule_max_date")

        employees.append(
            {
                "id": emp_id,
                "label": f"{emp_id} · {display_name}",
                "employee_name": display_name,
                "image": row.get("image"),
                "title": row.get("designation"),
                "department": row.get("department"),
                "company": row.get("company"),
                "employment_type": employment_type,
                "is_full_time": is_full_time_employment(employment_type),
                "has_shift_schedule_assignment": has_shift_assignment,
                "has_shift_assignment": has_shift_assignment,
                "shift_schedule_assignment": ssa.get("shift_schedule_assignment"),
                "schedule_min_date": schedule_min_date,
                "schedule_max_date": schedule_max_date,
                "first_checkin_date": checkins.get("first_checkin_date"),
            }
        )

    employees.sort(
        key=lambda e: (
            0 if e.get("has_shift_assignment") else 1,
            (e.get("employee_name") or e.get("id") or "").lower(),
        )
    )
    return employees


def _employee_nav_meta(employee: str) -> dict:
    checkin = first_checkin_date_by_employee([employee]).get(employee, {})
    bounds = shift_assignment_bounds_by_employee([employee]).get(employee, {})
    return {
        "first_checkin_date": checkin.get("first_checkin_date"),
        "schedule_max_date": bounds.get("schedule_max_date"),
        "has_shift_assignment": bool(bounds.get("has_shift_assignment")),
    }


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

    employee_company = frappe.db.get_value("Employee", employee, "company")
    holiday_by_date = holiday_by_date_for_company(company=employee_company, start=start, end=end)

    employee_branch = frappe.db.get_value("Employee", employee, "branch")
    device_alerts = []
    if employee_branch and frappe.db.table_exists("Device Closeout Alert"):
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

    device_sync = []
    if employee_branch and frappe.db.table_exists("Device Sync Status"):
        device_sync = (
            frappe.get_all(
                "Device Sync Status",
                filters={
                    "branch": employee_branch,
                    "local_date": ["between", [start, end]],
                },
                fields=[
                    "device_sn",
                    "branch",
                    "local_date",
                    "last_device_log_at",
                    "last_delivered_at",
                    "pending_count",
                    "last_error",
                ],
                order_by="local_date asc, device_sn asc",
            )
            or []
        )
        for row in device_sync:
            if row.get("local_date"):
                row["local_date"] = str(row["local_date"])
            row["last_device_log_at"] = _format_datetime(row.get("last_device_log_at"))
            row["last_delivered_at"] = _format_datetime(row.get("last_delivered_at"))

    flags = []
    if frappe.db.table_exists("Attendance Flag"):
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

    leave_by_date = _leave_by_date_for_range(employee=employee, start=start, end=end)

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

        observed_lunch = None
        shift = _shift_context_for_day(employee=employee, attendance_date=cur)
        if shift.get("shift_assigned") and day_checkins:
            assignment = _get_shift_assignment(employee=employee, attendance_date=cur)
            if assignment and assignment.get("shift_type"):
                meta = _get_shift_meta(assignment["shift_type"])
                if meta:
                    observed_lunch = detect_observed_lunch(
                        checkins=day_checkins,
                        shift_meta=meta,
                        attendance_date=cur,
                        grace_minutes=effective_lunch_return_grace(meta),
                    )

        days.append(
            {
                "date": key,
                "shift": shift,
                "holiday": holiday_by_date.get(key),
                "leave": leave_by_date.get(key, {"on_leave": False}),
                "checkins": day_checkins,
                "first_in": first_in,
                "last_out": last_out,
                "gross_minutes": gross_minutes,
                "observed_lunch": observed_lunch,
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
        "device_sync": device_sync,
        **_employee_nav_meta(employee),
    }
