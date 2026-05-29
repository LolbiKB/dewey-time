from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import add_days, get_datetime, getdate, now_datetime, nowdate

from zkteco_hr.attendance_engine.bridge_auth import validate_bridge_request
# Shared with hr_calendar + intraday: range-aware Shift Assignment lookup (not start_date == D only).
from zkteco_hr.attendance_engine.shift_assignment import get_shift_assignment as _get_shift_assignment


CLOSEOUT_STATUSES = frozenset({"closed", "deferred_offline", "closure_failed"})

AUTO_FLAG_CODES = [
    "UNNOTIFIED_ABSENCE",
    "NON_PRIMARY_SITE_PUNCH",
    "LATE_START",
    "OFF_SHIFT_PUNCH",
    "MISSING_IN_OR_OUT",
    "UNKNOWN_DEVICE_BRANCH",
    "DELIVERY_FAILED",
]

DEVICE_CLOSEOUT_FLAG_CODES = [
    "NON_PRIMARY_SITE_PUNCH",
    "LATE_START",
    "OFF_SHIFT_PUNCH",
    "MISSING_IN_OR_OUT",
    "UNKNOWN_DEVICE_BRANCH",
    "DELIVERY_FAILED",
]

FLAG_SEVERITY = {
    "UNNOTIFIED_ABSENCE": "CRITICAL",
    "MISSING_IN_OR_OUT": "CRITICAL",
    "UNKNOWN_DEVICE_BRANCH": "CRITICAL",
    "DELIVERY_FAILED": "WARNING",
    "OFF_SHIFT_PUNCH": "WARNING",
    "NON_PRIMARY_SITE_PUNCH": "WARNING",
    "LATE_START": "WARNING",
    "NO_CHECKIN_YET": "WARNING",
    "MISSING_LUNCH": "INFO",
    "LATE_FROM_LUNCH": "WARNING",
    "LATE_CHECKIN_AFTER_CLOSE": "INFO",
}


def run_yesterday_closeout():
    """Deprecated: use run_company_fallback_closeout (kept for manual backwards compatibility)."""
    run_company_fallback_closeout()


def run_company_fallback_closeout():
    """
    Company fallback at ~03:00 in each company's timezone.
    Creates UNNOTIFIED_ABSENCE only; skips employees when branch has an open device alert.
    """
    for company in frappe.get_all("Company", pluck="name") or []:
        if not _is_company_closeout_hour(company):
            continue

        attendance_date = _yesterday_for_company(company)
        _generate_company_fallback_for_date(company=company, attendance_date=attendance_date)


def _is_company_closeout_hour(company: str) -> bool:
    tz_name = frappe.db.get_value("Company", company, "default_timezone") or frappe.defaults.get_global_default(
        "time_zone"
    )
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")

    local_now = now_datetime().astimezone(tz)
    return local_now.hour == 3


def _yesterday_for_company(company: str):
    tz_name = frappe.db.get_value("Company", company, "default_timezone") or frappe.defaults.get_global_default(
        "time_zone"
    )
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")

    local_today = now_datetime().astimezone(tz).date()
    return add_days(local_today, -1)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def notify_device_closeout_status(
    device_sn=None,
    local_date=None,
    status=None,
    device_branch=None,
    last_error=None,
    undelivered=None,
):
    """
    Bridge webhook: device day closeout status.
    Auth: API key (Authorization: token key:secret) + optional X-Bridge-Secret.
    """
    validate_bridge_request()

    device_sn = (device_sn or "").strip()
    if not device_sn:
        frappe.throw("device_sn is required")

    local_date = getdate(local_date)
    status = (status or "").strip().lower()
    if status not in CLOSEOUT_STATUSES:
        frappe.throw(f"status must be one of: {', '.join(sorted(CLOSEOUT_STATUSES))}")

    undelivered_items = _parse_undelivered(undelivered, status=status)

    alert_name = upsert_device_closeout_alert(
        device_sn=device_sn,
        local_date=local_date,
        status=status,
        device_branch=device_branch,
        last_error=last_error,
    )

    if status == "closed":
        frappe.enqueue(
            "zkteco_hr.attendance_engine.closeout.generate_auto_flags_for_device_date",
            queue="long",
            timeout=1800,
            device_sn=device_sn,
            local_date=str(local_date),
            undelivered=undelivered_items,
        )

    return {
        "ok": True,
        "alert": alert_name,
        "status": status,
        "local_date": str(local_date),
        "enqueued": status == "closed",
    }


def upsert_device_closeout_alert(
    *,
    device_sn: str,
    local_date,
    status: str,
    device_branch=None,
    last_error=None,
):
    local_date = getdate(local_date)
    alert_name = f"DCA-{frappe.scrub(device_sn)}-{local_date}"[:140]

    resolved_at = now_datetime() if status == "closed" else None
    values = {
        "device_sn": device_sn,
        "branch": device_branch,
        "local_date": local_date,
        "status": status,
        "last_error": last_error,
        "resolved_at": resolved_at,
    }

    if frappe.db.exists("Device Closeout Alert", alert_name):
        frappe.db.set_value("Device Closeout Alert", alert_name, values, update_modified=True)
        return alert_name

    doc = frappe.get_doc({"doctype": "Device Closeout Alert", "name": alert_name, **values})
    doc.insert(ignore_permissions=True)
    return doc.name


def generate_auto_flags_for_device_date(device_sn, local_date, undelivered=None):
    """Device-scoped closeout after bridge reports status=closed."""
    device_sn = (device_sn or "").strip()
    local_date = getdate(local_date)
    undelivered_items = undelivered or []
    if isinstance(undelivered_items, str):
        undelivered_items = _parse_undelivered(undelivered_items, status="closed")

    employees = _employees_for_device_closeout(device_sn, local_date, undelivered_items)
    for employee in employees:
        employee_undelivered = [
            item
            for item in undelivered_items
            if (item.get("frappe_employee_id") or item.get("employee")) == employee
        ]
        _generate_for_employee_date(
            employee=employee,
            attendance_date=local_date,
            include_unnotified_absence=False,
            device_sn=device_sn,
            undelivered_items=employee_undelivered,
        )


def generate_auto_flags_for_date(attendance_date):
    """
    Generate AUTO Attendance Flag rows for a single day (all active employees).
    Idempotency: delete/recreate only AUTO flags for (employee, attendance_date).
    """
    attendance_date = getdate(attendance_date)
    employees = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name") or []
    for employee in employees:
        _generate_for_employee_date(
            employee=employee,
            attendance_date=attendance_date,
            include_unnotified_absence=True,
        )


def _generate_company_fallback_for_date(*, company: str, attendance_date):
    attendance_date = getdate(attendance_date)
    employees = frappe.get_all("Employee", filters={"status": "Active", "company": company}, pluck="name") or []

    for employee in employees:
        employee_doc = frappe.get_cached_doc("Employee", employee)
        employee_branch = getattr(employee_doc, "branch", None)
        if employee_branch and has_open_device_closeout_alert(branch=employee_branch, local_date=attendance_date):
            continue

        shift_assignment = _get_shift_assignment(employee=employee, attendance_date=attendance_date)
        if not shift_assignment:
            continue

        checkins = _get_checkins_for_day(employee=employee, attendance_date=attendance_date)
        if checkins:
            continue

        _delete_auto_flags_for_employee_date(
            employee=employee,
            attendance_date=attendance_date,
            day_closed=1,
            flag_codes=["UNNOTIFIED_ABSENCE"],
        )
        _insert_flag(
            employee=employee,
            company=company,
            attendance_date=attendance_date,
            flag_code="UNNOTIFIED_ABSENCE",
            evidence={
                "employee": employee,
                "date": str(attendance_date),
                "on_shift": True,
                "reason": "company_fallback_no_checkins",
                "checkins_count": 0,
            },
        )


def has_open_device_closeout_alert(*, branch: str, local_date) -> bool:
    if not branch:
        return False

    local_date = getdate(local_date)
    return bool(
        frappe.db.exists(
            "Device Closeout Alert",
            {
                "branch": branch,
                "local_date": local_date,
                "resolved_at": ["is", "not set"],
            },
        )
    )


def _employees_for_device_closeout(device_sn: str, local_date, undelivered_items):
    local_date = getdate(local_date)
    start = get_datetime(str(local_date) + " 00:00:00")
    end = get_datetime(str(local_date) + " 23:59:59")

    employees = set(
        frappe.get_all(
            "Employee Checkin",
            filters={"device_id": device_sn, "time": ["between", [start, end]]},
            pluck="employee",
        )
        or []
    )

    for item in undelivered_items or []:
        employee_id = item.get("frappe_employee_id") or item.get("employee")
        if employee_id:
            employees.add(employee_id)

    return sorted(employees)


def _generate_for_employee_date(
    *,
    employee: str,
    attendance_date,
    include_unnotified_absence: bool = True,
    device_sn: str | None = None,
    undelivered_items=None,
):
    attendance_date = getdate(attendance_date)
    _delete_auto_flags_for_employee_date(
        employee=employee, attendance_date=attendance_date, day_closed=0
    )
    _delete_auto_flags_for_employee_date(
        employee=employee, attendance_date=attendance_date, day_closed=1
    )

    employee_doc = frappe.get_cached_doc("Employee", employee)
    employee_branch = getattr(employee_doc, "branch", None)
    employee_company = getattr(employee_doc, "company", None)

    shift_assignment = _get_shift_assignment(employee=employee, attendance_date=attendance_date)
    on_shift = bool(shift_assignment)

    checkins = _get_checkins_for_day(employee=employee, attendance_date=attendance_date)
    checkins_count = len(checkins)

    first_in_dt = checkins[0]["time"] if checkins else None
    last_out_dt = checkins[-1]["time"] if checkins else None

    evidence = {
        "employee": employee,
        "date": str(attendance_date),
        "on_shift": on_shift,
        "shift_type": shift_assignment.get("shift_type") if shift_assignment else None,
        "employee_branch": employee_branch,
        "checkins_count": checkins_count,
        "first_in": first_in_dt.isoformat() if first_in_dt else None,
        "last_out": last_out_dt.isoformat() if last_out_dt else None,
        "device_sn": device_sn,
    }

    flags_to_create = []

    if include_unnotified_absence:
        if on_shift and checkins_count == 0:
            flags_to_create.append(("UNNOTIFIED_ABSENCE", {"reason": "on_shift_no_checkins"}))
    elif on_shift and checkins_count == 0:
        # Device closeout path: employees only in undelivered list get flags below.
        pass

    if (not on_shift) and checkins_count > 0:
        flags_to_create.append(("OFF_SHIFT_PUNCH", {"reason": "off_shift_has_checkins"}))
    elif on_shift and checkins_count == 1:
        flags_to_create.append(("MISSING_IN_OR_OUT", {"reason": "single_checkin"}))

    unknown_branch_hits = 0
    non_primary_hits = 0
    for c in checkins:
        device_branch = c.get("custom_device_branch")
        if not device_branch:
            unknown_branch_hits += 1
            continue
        if employee_branch and device_branch != employee_branch:
            non_primary_hits += 1

    if checkins_count > 0 and unknown_branch_hits > 0:
        flags_to_create.append(
            ("UNKNOWN_DEVICE_BRANCH", {"unknown_branch_checkins": unknown_branch_hits})
        )
    if checkins_count > 0 and employee_branch and non_primary_hits > 0:
        flags_to_create.append(
            (
                "NON_PRIMARY_SITE_PUNCH",
                {
                    "employee_branch": employee_branch,
                    "non_primary_checkins": non_primary_hits,
                },
            )
        )

    if on_shift and first_in_dt and shift_assignment and shift_assignment.get("shift_type"):
        shift_meta = _get_shift_meta(shift_assignment["shift_type"])
        if shift_meta and shift_meta.get("start_time") is not None:
            grace = int(shift_meta.get("custom_grace_minutes") or 0)
            start_dt = _combine_date_time(attendance_date, shift_meta["start_time"])
            late_threshold = start_dt + timedelta(minutes=grace)
            evidence["shift_start"] = start_dt.isoformat()
            evidence["grace_minutes"] = grace
            evidence["late_threshold"] = late_threshold.isoformat()
            if first_in_dt > late_threshold:
                flags_to_create.append(
                    (
                        "LATE_START",
                        {
                            "first_in": first_in_dt.isoformat(),
                            "late_threshold": late_threshold.isoformat(),
                        },
                    )
                )

    for flag_code, extra_evidence in flags_to_create:
        _insert_flag(
            employee=employee,
            company=employee_company,
            attendance_date=attendance_date,
            flag_code=flag_code,
            evidence={**evidence, **extra_evidence},
        )

    for item in undelivered_items or []:
        _insert_flag(
            employee=employee,
            company=employee_company,
            attendance_date=attendance_date,
            flag_code="DELIVERY_FAILED",
            evidence={
                **evidence,
                "reason": "undelivered_checkin",
                "device_sn": device_sn,
                "undelivered": item,
            },
        )


def _delete_auto_flags_for_employee_date(
    *,
    employee: str,
    attendance_date,
    day_closed: int | None = None,
    flag_codes: list[str] | None = None,
):
    filters = {
        "source": "AUTO",
        "employee": employee,
        "attendance_date": getdate(attendance_date),
    }
    if day_closed is not None:
        filters["day_closed"] = day_closed
    if flag_codes:
        filters["flag_code"] = ["in", flag_codes]
    frappe.db.delete("Attendance Flag", filters)


def _insert_flag(*, employee, company, attendance_date, flag_code, evidence, day_closed: int = 1):
    doc = frappe.get_doc(
        {
            "doctype": "Attendance Flag",
            "employee": employee,
            "company": company,
            "attendance_date": attendance_date,
            "flag_code": flag_code,
            "severity": FLAG_SEVERITY.get(flag_code, "WARNING"),
            "source": "AUTO",
            "status": "OPEN",
            "day_closed": day_closed,
            "rule_version": "v0",
            "evidence": json.dumps(evidence, separators=(",", ":"), ensure_ascii=False),
        }
    )
    doc.insert(ignore_permissions=True)


def _parse_undelivered(undelivered, *, status: str):
    if status != "closed":
        return []

    if undelivered in (None, "", []):
        return []

    if isinstance(undelivered, list):
        return [item for item in undelivered if isinstance(item, dict)]

    if isinstance(undelivered, str):
        try:
            parsed = json.loads(undelivered)
        except json.JSONDecodeError as exc:
            frappe.throw(f"undelivered must be valid JSON: {exc}")
        if parsed is None:
            return []
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
        if isinstance(parsed, dict):
            return [parsed]
        frappe.throw("undelivered JSON must be a list of objects")

    frappe.throw("undelivered must be a JSON list when provided")


def _get_shift_meta(shift_type: str):
    try:
        doc = frappe.get_doc("Shift Type", shift_type)
    except Exception:
        return None

    return {
        "start_time": doc.start_time,
        "end_time": doc.end_time,
        "custom_grace_minutes": getattr(doc, "custom_grace_minutes", 0),
        "custom_lunch_start": getattr(doc, "custom_lunch_start", None),
        "custom_lunch_end": getattr(doc, "custom_lunch_end", None),
    }


def _get_checkins_for_day(*, employee: str, attendance_date):
    start = get_datetime(str(attendance_date) + " 00:00:00")
    end = get_datetime(str(attendance_date) + " 23:59:59")
    return (
        frappe.get_all(
            "Employee Checkin",
            filters={"employee": employee, "time": ["between", [start, end]]},
            fields=[
                "name",
                "time",
                "log_type",
                "device_id",
                "custom_device_branch",
            ],
            order_by="time asc",
        )
        or []
    )


def _combine_date_time(d, t):
    if isinstance(d, str):
        d = getdate(d)
    if hasattr(t, "hour"):
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    return get_datetime(str(d) + " 00:00:00")
