from __future__ import annotations

import frappe
from frappe.utils import get_datetime, getdate, nowdate


def _is_historical_attendance_date(attendance_date) -> bool:
    """Past calendar days (site TZ): allow Inactive submitted assignments in range."""
    return getdate(attendance_date) < getdate(nowdate())


def _shift_assignment_has_status_column() -> bool:
    return frappe.db.has_column("Shift Assignment", "status")


def _shift_assignment_fields() -> list[str]:
    fields = ["name", "shift_type", "start_date", "end_date"]
    if _shift_assignment_has_status_column():
        fields.append("status")
    return fields


def get_shift_assignment(*, employee: str, attendance_date):
    """
    Submitted Shift Assignment covering attendance_date.

    Live (today/future): status must be Active when the column exists.
    Historical (past): Active first, then Inactive if no Active row (HRMS retired slices).
    Prefers HRMS get_shifts_for_date; falls back to equivalent get_all filters.
    """
    attendance_date = getdate(attendance_date)
    row = _get_shift_assignment_hrms(employee, attendance_date)
    if row:
        return row
    return _get_shift_assignment_query(employee, attendance_date)


def _get_shift_assignment_hrms(employee: str, attendance_date):
    try:
        from hrms.hr.doctype.shift_assignment.shift_assignment import get_shifts_for_date
    except ImportError:
        return None

    attendance_date = getdate(attendance_date)
    ts = get_datetime(f"{attendance_date} 12:00:00")

    try:
        shifts = get_shifts_for_date(employee, ts) or []
    except Exception:
        frappe.log_error(title="get_shifts_for_date failed", message=frappe.get_traceback())
        return None

    if not shifts:
        return None

    return _normalize_shift_assignment_row(shifts[0], attendance_date)


def _fetch_shift_assignment_row(
    employee: str,
    attendance_date,
    *,
    status: str | None = None,
):
    attendance_date = getdate(attendance_date)
    filters: dict = {
        "employee": employee,
        "docstatus": 1,
        "start_date": ["<=", attendance_date],
    }
    if status and _shift_assignment_has_status_column():
        filters["status"] = status

    rows = (
        frappe.get_all(
            "Shift Assignment",
            filters=filters,
            or_filters=[
                ["end_date", "is", "not set"],
                ["end_date", ">=", attendance_date],
            ],
            fields=_shift_assignment_fields(),
            order_by="start_date desc",
            limit_page_length=1,
        )
        or []
    )
    return rows[0] if rows else None


def _get_shift_assignment_query(employee: str, attendance_date):
    attendance_date = getdate(attendance_date)
    if not frappe.db.table_exists("Shift Assignment"):
        return None

    if not _shift_assignment_has_status_column():
        row = _fetch_shift_assignment_row(employee, attendance_date)
        return _normalize_shift_assignment_row(row, attendance_date) if row else None

    row = _fetch_shift_assignment_row(employee, attendance_date, status="Active")
    if not row and _is_historical_attendance_date(attendance_date):
        row = _fetch_shift_assignment_row(employee, attendance_date, status="Inactive")

    return _normalize_shift_assignment_row(row, attendance_date) if row else None


def _normalize_shift_assignment_row(row, attendance_date):
    if row is None:
        return None

    if isinstance(row, dict):
        shift_type = row.get("shift_type")
        name = row.get("name")
        start_date = row.get("start_date")
        end_date = row.get("end_date")
        status = row.get("status")
    else:
        shift_type = getattr(row, "shift_type", None)
        name = getattr(row, "name", None)
        start_date = getattr(row, "start_date", None)
        end_date = getattr(row, "end_date", None)
        status = getattr(row, "status", None)

    if not shift_type:
        return None

    status_text = (status or "").strip()
    out = {
        "name": name,
        "shift_type": shift_type,
        "start_date": str(getdate(start_date)) if start_date else str(getdate(attendance_date)),
        "end_date": str(getdate(end_date)) if end_date else None,
    }
    if status_text:
        out["assignment_status"] = status_text
        if status_text.lower() == "inactive":
            out["schedule_superseded"] = True
    return out


def shift_assignment_bounds_by_employee(employee_ids: list[str]) -> dict[str, dict]:
    """
    Min/max coverage dates from submitted Active Shift Assignments (one grouped query).
    schedule_max_date is null when any assignment has no end_date (open-ended).
    """
    if not employee_ids or not frappe.db.table_exists("Shift Assignment"):
        return {}

    status_clause = ""
    if _shift_assignment_has_status_column():
        status_clause = "AND status = 'Active'"

    placeholders = ", ".join(["%s"] * len(employee_ids))
    rows = frappe.db.sql(
        f"""
        SELECT
            employee,
            MIN(start_date) AS schedule_min_date,
            MAX(end_date) AS schedule_max_date,
            SUM(CASE WHEN end_date IS NULL THEN 1 ELSE 0 END) AS open_ended_count
        FROM `tabShift Assignment`
        WHERE employee IN ({placeholders})
          AND docstatus = 1
          {status_clause}
        GROUP BY employee
        """,
        tuple(employee_ids),
        as_dict=True,
    )

    bounds: dict[str, dict] = {}
    for row in rows or []:
        emp = row.get("employee")
        if not emp:
            continue
        min_date = row.get("schedule_min_date")
        max_date = row.get("schedule_max_date")
        if row.get("open_ended_count"):
            max_date = None
        bounds[emp] = {
            "schedule_min_date": str(min_date) if min_date else None,
            "schedule_max_date": str(max_date) if max_date else None,
            "has_shift_assignment": bool(min_date),
        }
    return bounds
