from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import getdate, now_datetime, nowdate

from dewey_time.attendance_engine.absence_flags import (
    evaluate_missing_time_flags,
    missing_time_max_end_min_for_date,
)
from dewey_time.attendance_engine.holidays import holiday_by_date_for_company
from dewey_time.attendance_engine import rollout
from dewey_time.attendance_engine.closeout import (
    _delete_auto_flags_for_employee_date,
    _get_checkins_for_day,
    _generate_for_employee_date_isolated,
    _get_shift_assignment,
    _get_shift_meta,
    _insert_flag,
    has_delivery_or_record_failure_today,
    has_open_device_closeout_alert,
)

# Everything intraday writes MUST be listed here. This is the delete list at
# the top of every refresh, so a code intraday emits but does not list is
# never cleaned up: the provisional row survives the punch that disproves it.
INTRADAY_FLAG_CODES = [
    "MISSING_TIME",
    "NON_PRIMARY_SITE_PUNCH",
    "NO_CHECKIN_YET",
    # STILL HERE THOUGH INTRADAY NO LONGER WRITES IT. This is the delete list,
    # not the write list, and every site running this app has open provisional
    # UNNOTIFIED_ABSENCE rows from before NO_CHECKIN_YET took that job. Removing
    # it would strand them: nothing else deletes a provisional row, so a no-show
    # raised yesterday morning would sit in the queue as a CRITICAL forever,
    # surviving the punch that disproved it. The first pass after deploy clears
    # them, which is the whole migration.
    "UNNOTIFIED_ABSENCE",
]


def run_intraday_scheduler():
    """Cron entry: refresh provisional flags for today during configured business hours."""
    # Record the heartbeat first, on every scheduler fire (24/7) — it proves the
    # scheduler is alive, independent of whether we're in the business window.
    # (Recording it only after the window check would falsely report the engine
    # "stale" overnight, when the scheduler is fine but simply not doing work.)
    _record_intraday_heartbeat()
    if not _is_within_intraday_window():
        return
    refresh_intraday_flags_for_date(nowdate())


_HEARTBEAT_KEY = "dewey_time_last_intraday_run_at"


def _record_intraday_heartbeat():
    """Record a durable heartbeat so get_engine_health can detect a stale scheduler."""
    try:
        ts = now_datetime().isoformat(timespec="seconds")
        frappe.db.set_global_default(_HEARTBEAT_KEY, ts)
    except Exception:
        pass  # heartbeat write must never break the scheduler run


def refresh_intraday_flags_for_date(attendance_date):
    attendance_date = getdate(attendance_date)
    today = getdate(nowdate())
    if attendance_date > today:
        return

    employees = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name") or []
    for employee in employees:
        # Contained per employee: this runs every 30 minutes across every active
        # employee, so one bad shift or punch sequence must not cost everyone
        # sorted after them their provisional flags.
        try:
            refresh_intraday_flags_for_employee_date(employee, attendance_date)
        except Exception:
            frappe.log_error(
                title="Intraday flag refresh failed",
                message="employee={0} date={1}\n{2}".format(
                    employee, attendance_date, frappe.get_traceback()
                ),
            )


def refresh_intraday_flags_for_employee_date(employee: str, attendance_date):
    attendance_date = getdate(attendance_date)

    # Hoisted above the delete, which used to be this function's first statement.
    # The guard has to run before the delete, and the guard needs the branch. All
    # three reads are side-effect free, so for any non-PRELAUNCH day the observable
    # behaviour is unchanged.
    employee_doc = frappe.get_cached_doc("Employee", employee)
    employee_branch = getattr(employee_doc, "branch", None)
    employee_company = getattr(employee_doc, "company", None)

    # Before this branch's cutoff the engine has no opinion about the day. See the
    # matching guard in closeout._generate_for_employee_date for why this returns
    # before the delete rather than after it.
    if (
        rollout.phase_for(branch=employee_branch, attendance_date=attendance_date)
        == rollout.PRELAUNCH
    ):
        return

    _delete_auto_flags_for_employee_date(
        employee=employee,
        attendance_date=attendance_date,
        day_closed=0,
        flag_codes=INTRADAY_FLAG_CODES,
    )

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
        missing = list(
            evaluate_missing_time_flags(
                checkins=checkins,
                shift_meta=shift_meta,
                attendance_date=attendance_date,
                max_end_min=max_end_min,
            )
        )

        if checkins_count == 0 and missing:
            # Nobody has turned up yet. Closeout says UNNOTIFIED_ABSENCE and
            # skips MISSING_TIME the same way (closeout.py:568); intraday says
            # NO_CHECKIN_YET, because the difference between the two codes is
            # exactly the difference between a finished day and a running one.
            #
            # This used to raise a PROVISIONAL UNNOTIFIED_ABSENCE, and the cost
            # of that is still visible in flag_triage: it needed a special case
            # above _FIXED_RANKS to stop a 31-minute no-show ranking 150 and
            # burying every real finding until the person badged. That is a
            # workaround for using a closeout VERDICT to describe a morning
            # nobody has finished yet. NO_CHECKIN_YET is the code the doctype
            # and ARCHITECTURE.md always reserved for this ("intraday
            # placeholder") and it carries WARNING rather than CRITICAL, so the
            # weight is right without anything downstream compensating.
            #
            # Withdrawn the moment a punch lands: this function re-runs on every
            # checkin edit and deletes its own previous rows first, which is why
            # NO_CHECKIN_YET has to be in INTRADAY_FLAG_CODES.
            #
            # Gated on `missing` rather than on a threshold of its own: the row
            # must appear when the first MISSING_TIME would have, not sooner.
            # Below absence_threshold_minutes there is no interval to report and
            # this list is empty, so the timing is unchanged by construction
            # rather than by arithmetic repeated in two places.
            _insert_flag(
                employee=employee,
                company=employee_company,
                attendance_date=attendance_date,
                flag_code="NO_CHECKIN_YET",
                evidence={
                    **evidence,
                    "reason": "on_shift_no_checkins_intraday",
                    # What the suppressed MISSING_TIME rows would have reported.
                    # triage_rank bands a provisional no-show on these, so that a
                    # day the engine has not finished judging does not outrank
                    # every confirmed finding in the queue.
                    "minutes": sum(extra.get("minutes") or 0 for _, extra in missing),
                },
                day_closed=0,
            )
        else:
            for flag_code, extra in missing:
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

    job_id = f"dewey_time-intraday-{frappe.scrub(employee)}-{attendance_date}"[:140]
    frappe.enqueue(
        "dewey_time.attendance_engine.intraday.refresh_intraday_flags_for_employee_date",
        queue="short",
        job_id=job_id,
        deduplicate=True,
        employee=employee,
        attendance_date=attendance_date,
    )


def enqueue_closed_day_regeneration(employee: str, attendance_date):
    """Rebuild a past day's FULL flag set after a punch correction.

    Deliberately the closeout generator rather than the intraday one: the intraday
    pass writes only INTRADAY_FLAG_CODES, as provisional, which is the wrong answer
    for a day that has already closed. Enqueued rather than run inline so a Desk
    edit's save stays fast, and coalesced per (employee, date) so a burst of
    corrections to the same day collapses into one rebuild.

    _generate_for_employee_date_isolated contains its own failures to the Error Log,
    so a bad shift or punch sequence can never make the checkin save fail.
    """
    attendance_date = str(getdate(attendance_date))
    employee = (employee or "").strip()
    if not employee:
        return

    job_id = f"dewey_time-closed-regen-{frappe.scrub(employee)}-{attendance_date}"[:140]
    frappe.enqueue(
        "dewey_time.attendance_engine.closeout._generate_for_employee_date_isolated",
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


def on_employee_checkin_on_update(doc, method=None):
    """Re-trigger flag refresh when a checkin's time or employee is corrected in Desk."""
    if not doc or not doc.get("employee") or not doc.get("time"):
        return

    try:
        before = doc.get_doc_before_save()
    except Exception:
        before = None

    # Only act when time or employee actually changed to avoid spurious re-runs.
    if before:
        if (
            str(before.get("time") or "") == str(doc.get("time") or "")
            and (before.get("employee") or "") == (doc.get("employee") or "")
        ):
            return

    new_date = getdate(doc.time)
    dates_to_refresh = {new_date}

    if before and before.get("time"):
        old_date = getdate(before.time)
        if old_date != new_date:
            dates_to_refresh.add(old_date)

    today = getdate(nowdate())

    for attendance_date in dates_to_refresh:
        if attendance_date < today:
            # A past date will never be closed out again. run_company_fallback_closeout
            # only ever processes yesterday (closeout.py:92) and only emits
            # UNNOTIFIED_ABSENCE, and generate_auto_flags_for_device_date fires once per
            # device/date off the bridge webhook.
            #
            # This branch used to delete EVERY AUTO flag and enqueue the intraday pass,
            # which rebuilds only INTRADAY_FLAG_CODES (MISSING_TIME,
            # NON_PRIMARY_SITE_PUNCH) and only as day_closed=0. LATE_START, LEFT_EARLY,
            # UNNOTIFIED_ABSENCE, ATTENDANCE_ISSUE, OFF_SHIFT_PUNCH and LATE_FROM_LUNCH
            # were therefore destroyed with nothing left to rebuild them — recoverable
            # only via the dev-only, 31-day-capped run_engine_for_employee. Correcting a
            # punch is the most common HR action while reviewing a flag, so this fired
            # constantly and silently.
            #
            # The closeout generator is the right rebuilder: it deletes both
            # day_closed=0 and =1 itself (closeout.py:473-478) and regenerates the
            # complete final set from the corrected punches, so no separate delete
            # belongs here.
            enqueue_closed_day_regeneration(doc.employee, attendance_date)
            continue

        # Today has not closed out, so the intraday pass is the correct rebuilder —
        # generating day_closed=1 rows mid-shift would invent LEFT_EARLY and
        # UNNOTIFIED_ABSENCE for a day that is not over yet.
        #
        # Scoped to provisional rows on purpose: a device that closes out early can
        # already have written finals for today, and deleting those would drop them into
        # the same nothing-rebuilds-them hole this function just fixed for past dates.
        _delete_auto_flags_for_employee_date(
            employee=doc.employee, attendance_date=attendance_date, day_closed=0
        )
        enqueue_intraday_refresh(doc.employee, attendance_date)


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
