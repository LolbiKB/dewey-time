from __future__ import annotations

from collections import defaultdict

import frappe
from frappe.utils import add_days, getdate

from dewey_time.attendance_engine.closeout import (
    _delete_auto_flags_for_employee_date,
    _generate_for_employee_date,
    has_delivery_or_record_failure_today,
)
from dewey_time.attendance_engine.hr_calendar import _require_hr_role
from dewey_time.attendance_engine.intraday import refresh_intraday_flags_for_employee_date
from dewey_time.attendance_engine.schedule_resolver import (
    CLEAR_ALL_CONFIRM_PHRASE,
    CLEAR_SITE_PATTERNS_CONFIRM_PHRASE,
    clear_all_employee_schedules,
    clear_employee_schedule,
    clear_site_patterns_step,
    clear_site_schedule_patterns,
    preview_clear_all_employee_schedules,
    preview_clear_employee_schedule,
    preview_clear_site_schedule_patterns,
)

VALID_MODES = frozenset({"intraday", "closeout", "both"})
MAX_RANGE_DAYS = 31

# The per-employee tool is capped at 31 days because it is a spot-check. The bulk
# rebuild is a deliberate re-shaping of everything anyone is looking at, so it needs
# a wider range and a harder stop: a quarter is enough for that, and short enough
# that an all-time run cannot be a typo.
MAX_BULK_RANGE_DAYS = 92


@frappe.whitelist(methods=["POST"])
def run_engine_for_employee(employee: str, start_date: str, end_date: str, mode: str = "both"):
    """Dev-only: recompute AUTO Attendance Flag rows for one employee over a date range."""
    _require_hr_role()

    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")
    if not frappe.db.exists("Employee", employee):
        frappe.throw(f"Employee {employee} not found")

    if not start_date or not end_date:
        frappe.throw("start_date and end_date are required")

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")

    day_count = (end - start).days + 1
    if day_count > MAX_RANGE_DAYS:
        frappe.throw(f"Date range cannot exceed {MAX_RANGE_DAYS} days")

    mode = (mode or "both").strip().lower()
    if mode not in VALID_MODES:
        frappe.throw(f"mode must be one of: {', '.join(sorted(VALID_MODES))}")

    current = start
    days_processed = 0
    while current <= end:
        if mode in ("intraday", "both"):
            refresh_intraday_flags_for_employee_date(employee, current)
        if mode in ("closeout", "both"):
            _generate_for_employee_date(
                employee=employee,
                attendance_date=current,
                include_unnotified_absence=True,
            )
        days_processed += 1
        current = add_days(current, 1)

    frappe.db.commit()

    return _build_response(
        employee=employee,
        start_date=str(start),
        end_date=str(end),
        mode=mode,
        days_processed=days_processed,
    )


def _build_response(*, employee, start_date, end_date, mode, days_processed):
    flags = (
        frappe.get_all(
            "Attendance Flag",
            filters={
                "employee": employee,
                "attendance_date": ["between", [start_date, end_date]],
            },
            fields=["attendance_date", "flag_code"],
            order_by="attendance_date asc, flag_code asc",
        )
        or []
    )

    by_date: dict[str, list[str]] = defaultdict(list)
    for row in flags:
        date_key = str(getdate(row["attendance_date"]))
        by_date[date_key].append(row["flag_code"])

    days = [
        {"date": date_key, "flag_codes": sorted(set(codes))}
        for date_key, codes in sorted(by_date.items())
    ]

    return {
        "ok": True,
        "employee": employee,
        "start_date": start_date,
        "end_date": end_date,
        "mode": mode,
        "days_processed": days_processed,
        "flags_after": len(flags),
        "days": days,
    }


def _validate_employee(employee: str) -> str:
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")
    if not frappe.db.exists("Employee", employee):
        frappe.throw(f"Employee {employee} not found")
    return employee


def _parse_confirm(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _require_system_manager_for_clear():
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user) or [])
    if "System Manager" in roles:
        return
    frappe.throw("Clear schedule data requires System Manager role")


@frappe.whitelist()
def preview_clear_employee_schedule_api(employee: str | None = None):
    """Dev-only: preview SSA / SA / Attendance Flag counts before nuclear clear."""
    _require_hr_role()
    employee = _validate_employee(employee or frappe.form_dict.get("employee"))
    return preview_clear_employee_schedule(employee)


@frappe.whitelist(methods=["POST"])
def clear_employee_schedule_api(employee: str | None = None, confirm=None):
    """Dev-only: delete all SSA, SA, and Attendance Flags for one employee."""
    _require_hr_role()
    employee = _validate_employee(employee or frappe.form_dict.get("employee"))

    confirm_value = confirm
    if confirm_value is None:
        confirm_value = frappe.form_dict.get("confirm")

    if not _parse_confirm(confirm_value):
        preview = preview_clear_employee_schedule(employee)
        return {"needs_confirm": True, "preview": preview}

    _require_system_manager_for_clear()

    try:
        result = clear_employee_schedule(employee)
        frappe.db.commit()
        return result
    except Exception:
        frappe.db.rollback()
        raise


def _parse_include_all_active(value) -> bool:
    if value is None:
        return False
    return _parse_confirm(value)


@frappe.whitelist()
def preview_clear_all_employee_schedules_api(include_all_active=None):
    """Dev-only: site-wide SSA / SA / Attendance Flag counts before nuclear clear."""
    _require_system_manager_for_clear()
    include_all_active = _parse_include_all_active(
        include_all_active if include_all_active is not None else frappe.form_dict.get("include_all_active")
    )
    return preview_clear_all_employee_schedules(include_all_active=include_all_active)


@frappe.whitelist(methods=["POST"])
def clear_all_employee_schedules_api(confirm=None, confirm_phrase=None, include_all_active=None):
    """Dev-only: delete all SSA, SA, and Attendance Flags for every affected employee."""
    _require_system_manager_for_clear()

    include_all_active = _parse_include_all_active(
        include_all_active if include_all_active is not None else frappe.form_dict.get("include_all_active")
    )

    confirm_value = confirm
    if confirm_value is None:
        confirm_value = frappe.form_dict.get("confirm")

    if not _parse_confirm(confirm_value):
        preview = preview_clear_all_employee_schedules(include_all_active=include_all_active)
        return {"needs_confirm": True, "preview": preview}

    phrase = (confirm_phrase or frappe.form_dict.get("confirm_phrase") or "").strip()
    if phrase != CLEAR_ALL_CONFIRM_PHRASE:
        frappe.throw(f'Type "{CLEAR_ALL_CONFIRM_PHRASE}" to confirm')

    try:
        result = clear_all_employee_schedules(include_all_active=include_all_active)
        frappe.db.commit()
        return result
    except Exception:
        frappe.db.rollback()
        raise


@frappe.whitelist()
def preview_clear_site_schedule_patterns_api(clear_employee_data=None):
    """Dev-only: PAT / Shift Type counts before full site pattern wipe."""
    _require_system_manager_for_clear()
    clear_first = _parse_include_all_active(
        clear_employee_data
        if clear_employee_data is not None
        else frappe.form_dict.get("clear_employee_data", 1)
    )
    return preview_clear_site_schedule_patterns(clear_employee_data=clear_first)


@frappe.whitelist(methods=["POST"])
def clear_site_schedule_patterns_api(confirm=None, confirm_phrase=None, clear_employee_data=None):
    """Dev-only: delete all Shift Schedules and Shift Types (optionally employee data first)."""
    _require_system_manager_for_clear()

    clear_first = _parse_include_all_active(
        clear_employee_data
        if clear_employee_data is not None
        else frappe.form_dict.get("clear_employee_data", 1)
    )

    confirm_value = confirm
    if confirm_value is None:
        confirm_value = frappe.form_dict.get("confirm")

    if not _parse_confirm(confirm_value):
        preview = preview_clear_site_schedule_patterns(clear_employee_data=clear_first)
        return {"needs_confirm": True, "preview": preview}

    phrase = (confirm_phrase or frappe.form_dict.get("confirm_phrase") or "").strip()
    if phrase != CLEAR_SITE_PATTERNS_CONFIRM_PHRASE:
        frappe.throw(f'Type "{CLEAR_SITE_PATTERNS_CONFIRM_PHRASE}" to confirm')

    try:
        result = clear_site_schedule_patterns(clear_employee_data=clear_first)
        frappe.db.commit()
        return result
    except Exception:
        frappe.db.rollback()
        raise


@frappe.whitelist(methods=["POST"])
def clear_site_patterns_step_api(confirm_phrase=None, clear_employee_data=None):
    """Dev-only: one bounded, committed step of the site wipe. The client calls this
    repeatedly (showing progress) until ``done`` — each call stays well under the
    request timeout and releases locks, unlike the one-shot ``clear_site_schedule_patterns_api``.
    The confirm phrase is re-checked on every call (it's destructive on every call)."""
    _require_system_manager_for_clear()

    phrase = (confirm_phrase or frappe.form_dict.get("confirm_phrase") or "").strip()
    if phrase != CLEAR_SITE_PATTERNS_CONFIRM_PHRASE:
        frappe.throw(f'Type "{CLEAR_SITE_PATTERNS_CONFIRM_PHRASE}" to confirm')

    clear_first = _parse_include_all_active(
        clear_employee_data
        if clear_employee_data is not None
        else frappe.form_dict.get("clear_employee_data", 1)
    )

    try:
        result = clear_site_patterns_step(clear_employee_data=clear_first)
        frappe.db.commit()
        return result
    except Exception:
        frappe.db.rollback()
        raise


def _validate_bulk_range(start_date, end_date):
    if not start_date or not end_date:
        frappe.throw("start_date and end_date are required")

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")

    day_count = (end - start).days + 1
    if day_count > MAX_BULK_RANGE_DAYS:
        frappe.throw(f"Date range cannot exceed {MAX_BULK_RANGE_DAYS} days")
    return start, end


def _active_employee_names() -> list[str]:
    return [
        row["name"]
        for row in frappe.get_all(
            "Employee", filters={"status": "Active"}, fields=["name"], order_by="name"
        )
    ]


@frappe.whitelist()
def preview_regenerate_flags_for_range_api(start_date=None, end_date=None):
    """Dev-only: what a bulk flag rebuild would touch, before it touches it."""
    _require_system_manager_for_clear()
    start, end = _validate_bulk_range(
        start_date or frappe.form_dict.get("start_date"),
        end_date or frappe.form_dict.get("end_date"),
    )
    return {
        "start_date": str(start),
        "end_date": str(end),
        "days": (end - start).days + 1,
        "employees": len(_active_employee_names()),
        "auto_flags_in_range": frappe.db.count(
            "Attendance Flag",
            {"source": "AUTO", "attendance_date": ["between", [start, end]]},
        ),
    }


@frappe.whitelist(methods=["POST"])
def regenerate_flags_for_range_api(
    start_date=None, end_date=None, confirm=None, mode="both"
):
    """Dev-only: wipe and rebuild AUTO flags for every active employee in a range.

    Exists because a change to what the engine emits only reaches days that are
    re-processed. Without this the queue shows the old and the new shape at once,
    and the data being used to judge the change becomes an artifact that looks
    like a result.

    Destructive, so it follows the same contract as the clear_* tools: System
    Manager only, and no confirm means a preview and nothing else. The permission
    check and the confirm gate both run BEFORE any employee is enumerated, so a
    refused call cannot even read, let alone delete.
    """
    _require_system_manager_for_clear()
    start, end = _validate_bulk_range(
        start_date or frappe.form_dict.get("start_date"),
        end_date or frappe.form_dict.get("end_date"),
    )

    mode = (mode or "both").strip().lower()
    if mode not in VALID_MODES:
        frappe.throw(f"mode must be one of: {', '.join(sorted(VALID_MODES))}")

    confirm_value = confirm
    if confirm_value is None:
        confirm_value = frappe.form_dict.get("confirm")
    if not _parse_confirm(confirm_value):
        return {
            "needs_confirm": True,
            "preview": preview_regenerate_flags_for_range_api(
                start_date=str(start), end_date=str(end)
            ),
        }

    employees = _active_employee_names()
    days_processed = 0
    days_protected = 0
    for employee in employees:
        current = start
        while current <= end:
            # A day whose punches are known not to have arrived is left exactly
            # as it is. The wipe below is unscoped, and DELIVERY_FAILED is
            # source=AUTO but comes only from the device-closeout webhook's
            # undelivered_items -- nothing here can recompute it. Deleting it
            # would be self-defeating in the worst direction: the rebuild calls
            # has_delivery_or_record_failure_today, which reads exactly those
            # rows, so a wiped marker reads as "no failure" and the day earns an
            # UNNOTIFIED_ABSENCE it had been deliberately suppressed from
            # getting. This tool would then manufacture a no-show accusation
            # against someone whose device simply never delivered.
            #
            # One call covers both suppression sources -- the DELIVERY_FAILED
            # row and the ATTENDANCE_ISSUE variant carrying delivery_failed
            # evidence -- and it must run BEFORE the delete, not after.
            if has_delivery_or_record_failure_today(employee, current):
                days_protected += 1
                current = add_days(current, 1)
                continue

            # Explicit, because mode="intraday" alone would otherwise leave stale
            # finals behind: refresh_intraday only deletes its own provisional
            # rows, scoped to INTRADAY_FLAG_CODES.
            _delete_auto_flags_for_employee_date(
                employee=employee, attendance_date=current
            )
            if mode in ("intraday", "both"):
                refresh_intraday_flags_for_employee_date(employee, current)
            if mode in ("closeout", "both"):
                _generate_for_employee_date(
                    employee=employee,
                    attendance_date=current,
                    include_unnotified_absence=True,
                )
            days_processed += 1
            current = add_days(current, 1)
        # Per employee, not once at the end: a bulk run over a quarter should not
        # be a single transaction held open for its whole duration.
        frappe.db.commit()

    return {
        "start_date": str(start),
        "end_date": str(end),
        "mode": mode,
        "employees_processed": len(employees),
        "days_processed": days_processed,
        # Reported, not silent: these employee-days keep whatever they already
        # had, so a caller comparing before/after knows why some of the range
        # did not move.
        "days_protected_by_delivery_failure": days_protected,
    }
