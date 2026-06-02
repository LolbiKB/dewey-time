from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import getdate, now_datetime, nowdate

from zkteco_hr.attendance_engine.absence_flags import (
    evaluate_missing_time_flags,
    missing_time_max_end_min_for_date,
)
from zkteco_hr.attendance_engine.holidays import holiday_by_date_for_company
from zkteco_hr.attendance_engine.closeout import (
    _delete_auto_flags_for_employee_date,
    _get_checkins_for_day,
    _get_shift_assignment,
    _get_shift_meta,
    _insert_flag,
    has_delivery_or_record_failure_today,
    has_open_device_closeout_alert,
)

INTRADAY_FLAG_CODES = [
    "MISSING_TIME",
    "NON_PRIMARY_SITE_PUNCH",
]


def run_intraday_scheduler():
    """Cron entry: refresh provisional flags for today during configured business hours."""
    if not _is_within_intraday_window():
        return
    refresh_intraday_flags_for_date(nowdate())


def refresh_intraday_flags_for_date(attendance_date):
    attendance_date = getdate(attendance_date)
    today = getdate(nowdate())
    if attendance_date > today:
        return

    employees = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name") or []
    for employee in employees:
        refresh_intraday_flags_for_employee_date(employee, attendance_date)


def refresh_intraday_flags_for_employee_date(employee: str, attendance_date):
    attendance_date = getdate(attendance_date)
    _delete_auto_flags_for_employee_date(
        employee=employee,
        attendance_date=attendance_date,
        day_closed=0,
        flag_codes=INTRADAY_FLAG_CODES,
    )

    employee_doc = frappe.get_cached_doc("Employee", employee)
    employee_branch = getattr(employee_doc, "branch", None)
    employee_company = getattr(employee_doc, "company", None)

    if employee_company:
        holiday = holiday_by_date_for_company(
            company=employee_company, start=attendance_date, end=attendance_date
        ).get(str(attendance_date))
        if holiday:
            return

    shift_assignment = _get_shift_assignment(employee=employee, attendance_date=attendance_date)
    on_shift = bool(shift_assignment)
    if not on_shift:
        return

    checkins = _get_checkins_for_day(employee=employee, attendance_date=attendance_date)
    checkins_count = len(checkins)
    now_dt = now_datetime()

    evidence = {
        "employee": employee,
        "date": str(attendance_date),
        "on_shift": True,
        "shift_type": shift_assignment.get("shift_type") if shift_assignment else None,
        "employee_branch": employee_branch,
        "checkins_count": checkins_count,
        "provisional": True,
    }

    shift_meta = _get_shift_meta(shift_assignment["shift_type"]) if shift_assignment else None
    if not shift_meta:
        return

    skip_absence = (
        employee_branch
        and has_open_device_closeout_alert(branch=employee_branch, local_date=attendance_date)
    ) or has_delivery_or_record_failure_today(employee, attendance_date)

    if checkins_count > 0 and employee_branch:
        non_primary_hits = sum(
            1
            for c in checkins
            if c.get("custom_device_branch") and c.get("custom_device_branch") != employee_branch
        )
        if non_primary_hits > 0:
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code="NON_PRIMARY_SITE_PUNCH",
                evidence={
                    **evidence,
                    "employee_branch": employee_branch,
                    "non_primary_checkins": non_primary_hits,
                },
                day_closed=0,
            )

    if not skip_absence:
        max_end_min = missing_time_max_end_min_for_date(attendance_date)
        for flag_code, extra in evaluate_missing_time_flags(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=attendance_date,
            max_end_min=max_end_min,
        ):
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra},
                day_closed=0,
            )


def enqueue_intraday_refresh(employee: str, attendance_date):
    attendance_date = str(getdate(attendance_date))
    employee = (employee or "").strip()
    if not employee:
        return

    job_id = f"zkteco_hr-intraday-{frappe.scrub(employee)}-{attendance_date}"[:140]
    frappe.enqueue(
        "zkteco_hr.attendance_engine.intraday.refresh_intraday_flags_for_employee_date",
        queue="short",
        job_id=job_id,
        deduplicate=True,
        employee=employee,
        attendance_date=attendance_date,
    )


def on_employee_checkin_after_insert(doc, method=None):
    if not doc or not doc.get("employee") or not doc.get("time"):
        return
    enqueue_intraday_refresh(doc.employee, getdate(doc.time))


def _is_within_intraday_window() -> bool:
    tz_name = frappe.defaults.get_global_default("time_zone") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    local_now = now_datetime().astimezone(tz)
    start_hour = int(frappe.conf.get("intraday_business_start_hour") or 6)
    end_hour = int(frappe.conf.get("intraday_business_end_hour") or 20)
    return start_hour <= local_now.hour <= end_hour
