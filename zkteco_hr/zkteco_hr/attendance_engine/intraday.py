from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import getdate, now_datetime, nowdate

from zkteco_hr.attendance_engine.closeout import (
    _combine_date_time,
    _delete_auto_flags_for_employee_date,
    _get_checkins_for_day,
    _get_shift_assignment,
    _get_shift_meta,
    _insert_flag,
    has_open_device_closeout_alert,
)

INTRADAY_FLAG_CODES = [
    "LATE_START",
    "NO_CHECKIN_YET",
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

    if shift_meta and shift_meta.get("start_time") is not None:
        grace = int(shift_meta.get("custom_grace_minutes") or 0)
        start_dt = _combine_date_time(attendance_date, shift_meta["start_time"])
        late_threshold = start_dt + timedelta(minutes=grace)
        evidence["shift_start"] = start_dt.isoformat()
        evidence["grace_minutes"] = grace
        evidence["late_threshold"] = late_threshold.isoformat()

        if checkins_count > 0:
            first_in_dt = checkins[0]["time"]
            if first_in_dt > late_threshold:
                _insert_flag(
                    employee=employee,
                    company=employee_company,
                    attendance_date=attendance_date,
                    flag_code="LATE_START",
                    evidence={
                        **evidence,
                        "first_in": first_in_dt.isoformat(),
                        "late_threshold": late_threshold.isoformat(),
                    },
                    day_closed=0,
                )

        if checkins_count == 0:
            no_checkin_after_hours = int(frappe.conf.get("intraday_no_checkin_grace_hours") or 2)
            no_checkin_threshold = start_dt + timedelta(hours=no_checkin_after_hours)
            if (
                now_dt > no_checkin_threshold
                and not has_open_device_closeout_alert(branch=employee_branch, local_date=attendance_date)
                and not _has_delivery_failed_today(employee, attendance_date)
            ):
                _insert_flag(
                    employee=employee,
                    company=employee_company,
                    attendance_date=attendance_date,
                    flag_code="NO_CHECKIN_YET",
                    evidence={
                        **evidence,
                        "reason": "on_shift_no_checkin_yet",
                        "no_checkin_threshold": no_checkin_threshold.isoformat(),
                        "now": now_dt.isoformat(),
                    },
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


def _has_delivery_failed_today(employee: str, attendance_date) -> bool:
    return bool(
        frappe.db.exists(
            "Attendance Flag",
            {
                "employee": employee,
                "attendance_date": getdate(attendance_date),
                "flag_code": "DELIVERY_FAILED",
                "source": "AUTO",
            },
        )
    )


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
