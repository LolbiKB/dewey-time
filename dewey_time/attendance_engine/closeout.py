from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import add_days, get_datetime, getdate, now_datetime, nowdate

from dewey_time.attendance_engine.absence_flags import (
    evaluate_missing_time_flags,
    missing_time_max_end_min_for_date,
)
from dewey_time.attendance_engine.bridge_auth import validate_bridge_request
from dewey_time.attendance_engine.lunch_flags import evaluate_lunch_flags
from dewey_time.attendance_engine.record_issue_flags import evaluate_record_issue_flags
from dewey_time.attendance_engine.shift_grace import (
    effective_end_grace,
    effective_lunch_return_grace,
    effective_start_grace,
    enrich_shift_meta,
    grace_evidence,
    grace_fields_from_shift_doc,
)
from dewey_time.attendance_engine.shift_times import combine_date_time as _combine_date_time
from dewey_time.attendance_engine.holidays import holiday_by_date_for_company
# Shared with hr_calendar + intraday: range-aware Shift Assignment lookup (not start_date == D only).
from dewey_time.attendance_engine.shift_assignment import get_shift_assignment as _get_shift_assignment
from dewey_time.attendance_engine.employment_type import is_clock_based


CLOSEOUT_STATUSES = frozenset({"closed", "deferred_offline", "closure_failed"})

AUTO_FLAG_CODES = [
    "UNNOTIFIED_ABSENCE",
    "MISSING_TIME",
    "ATTENDANCE_ISSUE",
    "NON_PRIMARY_SITE_PUNCH",
    "LATE_START",
    "LATE_FROM_LUNCH",
    "LEFT_EARLY",
    "OFF_SHIFT_PUNCH",
    "MISSING_IN_OR_OUT",
    "MISSING_LUNCH",
    "UNKNOWN_DEVICE_BRANCH",
    "DELIVERY_FAILED",
    "NO_CHECKIN_YET",
]

DEVICE_CLOSEOUT_FLAG_CODES = [
    "MISSING_TIME",
    "ATTENDANCE_ISSUE",
    "NON_PRIMARY_SITE_PUNCH",
    "LATE_START",
    "LATE_FROM_LUNCH",
    "LEFT_EARLY",
    "OFF_SHIFT_PUNCH",
    "UNNOTIFIED_ABSENCE",
]

FLAG_SEVERITY = {
    "UNNOTIFIED_ABSENCE": "CRITICAL",
    "MISSING_TIME": "CRITICAL",
    "ATTENDANCE_ISSUE": "CRITICAL",
    "MISSING_IN_OR_OUT": "CRITICAL",
    "UNKNOWN_DEVICE_BRANCH": "CRITICAL",
    "DELIVERY_FAILED": "WARNING",
    "OFF_SHIFT_PUNCH": "WARNING",
    "NON_PRIMARY_SITE_PUNCH": "INFO",
    "LATE_START": "WARNING",
    "NO_CHECKIN_YET": "WARNING",
    "MISSING_LUNCH": "INFO",
    "LATE_FROM_LUNCH": "WARNING",
    "LEFT_EARLY": "WARNING",
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
            "dewey_time.attendance_engine.closeout.generate_auto_flags_for_device_date",
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

    branch = _device_closeout_branch(device_sn, local_date)
    employees = set(_employees_for_device_closeout(device_sn, local_date, undelivered_items))
    employees.update(_on_shift_zero_checkin_employees_at_branch(branch, local_date))

    for employee in sorted(employees):
        employee_undelivered = [
            item
            for item in undelivered_items
            if (item.get("frappe_employee_id") or item.get("employee")) == employee
        ]
        _generate_for_employee_date_isolated(
            employee=employee,
            attendance_date=local_date,
            include_unnotified_absence=True,
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
        _generate_for_employee_date_isolated(
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
            # T3-3: no open device closeout alert for this branch means the device closeout
            # webhook never completed for this day. Without this, a punched employee would
            # silently never receive LATE_START/LEFT_EARLY/MISSING_TIME. Run the full closeout
            # ourselves. Idempotent (AUTO flags are delete/recreated), so a late device webhook
            # simply regenerates the same flags.
            _generate_for_employee_date_isolated(
                employee=employee,
                attendance_date=attendance_date,
                include_unnotified_absence=False,
            )
            continue
        if should_skip_absence_flags(employee=employee, employee_branch=employee_branch, attendance_date=attendance_date):
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


def _device_closeout_branch(device_sn: str, local_date) -> str | None:
    local_date = getdate(local_date)
    alert_name = f"DCA-{frappe.scrub(device_sn)}-{local_date}"[:140]
    return frappe.db.get_value("Device Closeout Alert", alert_name, "branch")


def _on_shift_zero_checkin_employees_at_branch(branch: str | None, local_date) -> list[str]:
    if not branch:
        return []
    local_date = getdate(local_date)
    employees = (
        frappe.get_all("Employee", filters={"status": "Active", "branch": branch}, pluck="name") or []
    )
    out: list[str] = []
    for employee in employees:
        if not _get_shift_assignment(employee=employee, attendance_date=local_date):
            continue
        if _get_checkins_for_day(employee=employee, attendance_date=local_date):
            continue
        out.append(employee)
    return out


def should_skip_absence_flags(*, employee: str, employee_branch: str | None, attendance_date) -> bool:
    attendance_date = getdate(attendance_date)
    if employee_branch and has_open_device_closeout_alert(branch=employee_branch, local_date=attendance_date):
        return True
    return has_delivery_or_record_failure_today(employee, attendance_date)


def has_delivery_or_record_failure_today(employee: str, attendance_date) -> bool:
    attendance_date = getdate(attendance_date)
    if frappe.db.exists(
        "Attendance Flag",
        {
            "employee": employee,
            "attendance_date": attendance_date,
            "flag_code": "DELIVERY_FAILED",
            "source": "AUTO",
        },
    ):
        return True
    rows = frappe.get_all(
        "Attendance Flag",
        filters={
            "employee": employee,
            "attendance_date": attendance_date,
            "flag_code": "ATTENDANCE_ISSUE",
            "source": "AUTO",
        },
        fields=["evidence"],
    )
    for row in rows or []:
        if "delivery_failed" in (row.get("evidence") or ""):
            return True
    return False


def _non_primary_site_punch_flag(
    *, checkins: list[dict], employee_branch: str | None
) -> tuple[str, dict] | None:
    """NON_PRIMARY_SITE_PUNCH when punches land on a branch that isn't the employee's.

    Pure branch arithmetic with no shift input, which is why the scheduled path
    and the clock-day path can share it.
    """
    if not employee_branch:
        return None
    non_primary_hits = sum(
        1
        for c in checkins
        if c.get("custom_device_branch") and c.get("custom_device_branch") != employee_branch
    )
    if non_primary_hits <= 0:
        return None
    return (
        "NON_PRIMARY_SITE_PUNCH",
        {
            "employee_branch": employee_branch,
            "non_primary_checkins": non_primary_hits,
        },
    )


def _generate_for_employee_date_isolated(**kwargs) -> bool:
    """Run one employee's flag generation, containing any failure to that employee.

    A single employee's data must never abort a whole device or company batch.
    Before this existed, an overnight interval running past minute 1440 raised
    inside evaluate_missing_time_flags and every employee sorted after the night
    worker silently got no flags at all — while the Device Closeout Alert still
    reported the branch healthy, so nothing surfaced the gap.

    Failures go to the Error Log rather than being swallowed; the batch
    continues. Returns True when the employee was processed.
    """
    try:
        _generate_for_employee_date(**kwargs)
        return True
    except Exception:
        frappe.log_error(
            title="Attendance flag generation failed",
            message="employee={0} date={1}\n{2}".format(
                kwargs.get("employee"), kwargs.get("attendance_date"), frappe.get_traceback()
            ),
        )
        return False


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

    holiday = None
    if employee_company:
        holiday = holiday_by_date_for_company(
            company=employee_company, start=attendance_date, end=attendance_date
        ).get(str(attendance_date))

    shift_assignment = _get_shift_assignment(employee=employee, attendance_date=attendance_date)
    on_shift = bool(shift_assignment)
    # Resolve shift_meta early so _get_checkins_for_day can extend the window for overnight shifts.
    _early_shift_meta = (
        _get_shift_meta(shift_assignment["shift_type"])
        if shift_assignment and shift_assignment.get("shift_type")
        else None
    )

    checkins = _get_checkins_for_day(employee=employee, attendance_date=attendance_date, shift_meta=_early_shift_meta)
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
        "holiday": holiday,
    }

    flags_to_create: list[tuple[str, dict]] = []

    if holiday:
        # Holiday wins: suppress normal on-shift flags even if SSA created a Shift Assignment.
        if checkins_count == 0:
            return
        flags_to_create.append(("OFF_SHIFT_PUNCH", {"reason": "holiday_has_checkins"}))
        for flag_code, extra_evidence in flags_to_create:
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra_evidence},
            )
        return

    if not on_shift:
        if checkins_count == 0:
            return
        if is_clock_based(getattr(employee_doc, "employment_type", None)):
            # Clock day: no schedule exists to judge against, so only punch-integrity
            # and location flags apply. LATE_START / LEFT_EARLY / MISSING_TIME /
            # LATE_FROM_LUNCH / UNNOTIFIED_ABSENCE / OFF_SHIFT_PUNCH are all defined
            # relative to a shift and are deliberately absent here.
            # Spec: docs/superpowers/specs/2026-07-27-clock-based-attendance-design.md
            evidence["clock_based"] = True
            non_primary_flag = _non_primary_site_punch_flag(
                checkins=checkins, employee_branch=employee_branch
            )
            if non_primary_flag:
                flags_to_create.append(non_primary_flag)
            flags_to_create.extend(
                evaluate_record_issue_flags(
                    checkins=checkins,
                    shift_meta=None,
                    attendance_date=attendance_date,
                    undelivered_items=undelivered_items,
                )
            )
        else:
            flags_to_create.append(("OFF_SHIFT_PUNCH", {"reason": "off_shift_has_checkins"}))
        for flag_code, extra_evidence in flags_to_create:
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra_evidence},
            )
        return

    if checkins_count == 0:
        flags_to_create.extend(
            evaluate_record_issue_flags(
                checkins=checkins,
                shift_meta=None,
                attendance_date=attendance_date,
                undelivered_items=undelivered_items,
            )
        )
        if (
            include_unnotified_absence
            and not undelivered_items
            and not should_skip_absence_flags(
                employee=employee,
                employee_branch=employee_branch,
                attendance_date=attendance_date,
            )
        ):
            flags_to_create.insert(
                0, ("UNNOTIFIED_ABSENCE", {"reason": "on_shift_no_checkins"})
            )
        for flag_code, extra_evidence in flags_to_create:
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra_evidence},
            )
        return

    shift_meta = _early_shift_meta  # already resolved before _get_checkins_for_day
    start_grace = effective_start_grace(shift_meta) if shift_meta else 0
    end_grace = effective_end_grace(shift_meta) if shift_meta else 0
    lunch_grace = effective_lunch_return_grace(shift_meta) if shift_meta else 0

    if shift_meta and shift_meta.get("start_time") is not None:
        start_dt = _combine_date_time(attendance_date, shift_meta["start_time"])
        late_threshold = start_dt + timedelta(minutes=start_grace)
        evidence["shift_start"] = start_dt.isoformat()
        evidence.update(grace_evidence(shift_meta))
        evidence["late_threshold"] = late_threshold.isoformat()
        # For overnight shifts (end < start), LATE_START is detectable from the IN punch alone.
        # For day shifts, require a complete IN/OUT pair (≥2 punches) to avoid false positives.
        _is_overnight = (
            shift_meta.get("end_time") is not None
            and shift_meta["end_time"] < shift_meta["start_time"]
        )
        _min_punches_for_late = 1 if _is_overnight else 2
        if checkins_count >= _min_punches_for_late and first_in_dt and first_in_dt > late_threshold:
            flags_to_create.append(
                (
                    "LATE_START",
                    {
                        **grace_evidence(shift_meta),
                        "first_in": first_in_dt.isoformat(),
                        "late_threshold": late_threshold.isoformat(),
                    },
                )
            )

    non_primary_flag = _non_primary_site_punch_flag(
        checkins=checkins, employee_branch=employee_branch
    )
    if non_primary_flag:
        flags_to_create.append(non_primary_flag)

    if shift_meta and checkins_count > 0:
        flags_to_create.extend(
            evaluate_missing_time_flags(
                checkins=checkins,
                shift_meta=shift_meta,
                attendance_date=attendance_date,
                max_end_min=None,
            )
        )

    if shift_meta and checkins_count >= 2:
        flags_to_create.extend(
            evaluate_lunch_flags(
                checkins=checkins,
                shift_meta=shift_meta,
                attendance_date=attendance_date,
                grace_minutes=lunch_grace,
            )
        )
        if last_out_dt and shift_meta.get("end_time") is not None:
            end_dt = _combine_date_time(attendance_date, shift_meta["end_time"])
            _start_time = shift_meta.get("start_time")
            if _start_time is not None and end_dt <= _combine_date_time(attendance_date, _start_time):
                end_dt = end_dt + timedelta(days=1)  # overnight: roll end to next day
            early_threshold = end_dt - timedelta(minutes=end_grace)
            evidence["shift_end"] = end_dt.isoformat()
            evidence["early_threshold"] = early_threshold.isoformat()
            if last_out_dt < early_threshold:
                flags_to_create.append(
                    (
                        "LEFT_EARLY",
                        {
                            **grace_evidence(shift_meta, for_end=True),
                            "last_out": last_out_dt.isoformat(),
                            "early_threshold": early_threshold.isoformat(),
                        },
                    )
                )

    flags_to_create.extend(
        evaluate_record_issue_flags(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=attendance_date,
            grace_minutes=lunch_grace,
            undelivered_items=undelivered_items,
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

    meta = {
        "start_time": doc.start_time,
        "end_time": doc.end_time,
        **grace_fields_from_shift_doc(doc),
        "custom_lunch_start": getattr(doc, "custom_lunch_start", None),
        "custom_lunch_end": getattr(doc, "custom_lunch_end", None),
    }
    return enrich_shift_meta(meta)


def _get_checkins_for_day(*, employee: str, attendance_date, shift_meta=None):
    start = get_datetime(str(attendance_date) + " 00:00:00")
    # For overnight shifts (end_time < start_time), extend the upper bound to include D+1 punches.
    if shift_meta:
        _end_time = shift_meta.get("end_time")
        _start_time = shift_meta.get("start_time")
        if _end_time is not None and _start_time is not None and _end_time < _start_time:
            _end_grace = effective_end_grace(shift_meta)
            _next_day = getdate(attendance_date) + timedelta(days=1)
            end = _combine_date_time(_next_day, _end_time) + timedelta(minutes=_end_grace + 60)
        else:
            end = get_datetime(str(attendance_date) + " 23:59:59")
    else:
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

