from __future__ import annotations

from collections import defaultdict

import frappe
from frappe.utils import add_days, getdate

from dewey_time.attendance_engine import rollout
from dewey_time.attendance_engine.closeout import (
    _delete_auto_flags_for_employee_date,
    _generate_for_employee_date,
    has_delivery_or_record_failure_today,
)
from dewey_time.attendance_engine.flag_decision_api import _branch_by_employee
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


def _day_is_over(attendance_date) -> bool:
    """Whether closeout has anything to confirm about this day yet.

    Closeout writes finals. For a zero-punch day that means an
    UNNOTIFIED_ABSENCE with day_closed=1, triage rank 150, and copy reading
    "Confirmed at end-of-day device closeout". Today has earned none of that:
    someone who has not badged by 09:00 may walk in at 09:05.

    Run closeout over today and every employee not yet at their desk is
    accused, at the top of the action queue -- and because the two rows share
    a flag identity, the read path's dedup prefers the confirmed row over the
    provisional one that would have corrected it. The accusation then stands
    until that evening's real closeout rebuilds the day.
    """
    return getdate(attendance_date) < getdate()


def _clamp_end_to_today(start, end):
    """Trim a range at today rather than refusing it. Returns (end, clamped).

    Refusing outright was the first attempt and it broke the primary caller:
    RunEngineDialog defaults end_date to the displayed week's Sunday
    (RunEngineDialog.tsx, weekStart + 6), and the displayed week is the current
    one, so on every day but Sunday the dialog's out-of-the-box range ends in
    the future. A throw there is a raw server error on the button's default
    state, six days in seven.

    Asking for "this week" and getting everything in it that has happened is
    the only sensible reading, so clamp -- and say so in the response, since
    the caller asked for more days than it is getting back.

    A range starting after today has nothing left after clamping, and silently
    doing nothing is worse than saying so.
    """
    today = getdate()
    if start > today:
        frappe.throw(f"start_date cannot be after today ({today})")
    if end > today:
        return today, True
    return end, False


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
    # Capped on what was asked for, clamped after: a 200-day request is a
    # mistake whether or not most of it is in the future.
    end, end_was_clamped = _clamp_end_to_today(start, end)

    mode = (mode or "both").strip().lower()
    if mode not in VALID_MODES:
        frappe.throw(f"mode must be one of: {', '.join(sorted(VALID_MODES))}")

    current = start
    days_processed = 0
    days_protected = 0
    days_deferred = 0
    while current <= end:
        # The same protection the bulk regenerator carries, for the same
        # reason. _generate_for_employee_date's deletes are unscoped;
        # DELIVERY_FAILED is source=AUTO but arrives only from the device
        # closeout webhook's undelivered_items, so nothing here can put it
        # back. Worse, the rebuild consults exactly those rows to decide
        # whether to suppress absence flagging: one run erases the marker, and
        # a second reads "no failure" and manufactures the very no-show the
        # marker existed to prevent. A spot-check is the kind of thing people
        # re-run, so the second run is not hypothetical.
        if has_delivery_or_record_failure_today(employee, current):
            days_protected += 1
            current = add_days(current, 1)
            continue

        ran_something = False
        if mode in ("intraday", "both"):
            refresh_intraday_flags_for_employee_date(employee, current)
            ran_something = True
        if mode in ("closeout", "both"):
            if _day_is_over(current):
                _generate_for_employee_date(
                    employee=employee,
                    attendance_date=current,
                    include_unnotified_absence=True,
                )
                ran_something = True
            else:
                days_deferred += 1
        if ran_something:
            days_processed += 1
        current = add_days(current, 1)

    frappe.db.commit()

    return _build_response(
        employee=employee,
        start_date=str(start),
        end_date=str(end),
        mode=mode,
        days_processed=days_processed,
        days_protected=days_protected,
        days_deferred=days_deferred,
        end_was_clamped=end_was_clamped,
    )


def _build_response(
    *,
    employee,
    start_date,
    end_date,
    mode,
    days_processed,
    days_protected=0,
    days_deferred=0,
    end_was_clamped=False,
):
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
        # Reported, not silent: a caller comparing before/after needs to know
        # why part of the range did not move. days_deferred is not disjoint
        # from days_processed -- mode="both" over today runs its intraday half
        # and defers only its closeout half, and counts in both.
        "days_protected_by_delivery_failure": days_protected,
        "closeout_days_deferred_until_the_day_ends": days_deferred,
        "end_date_clamped_to_today": end_was_clamped,
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
    end, end_was_clamped = _clamp_end_to_today(start, end)
    return start, end, end_was_clamped


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
    start, end, end_was_clamped = _validate_bulk_range(
        start_date or frappe.form_dict.get("start_date"),
        end_date or frappe.form_dict.get("end_date"),
    )
    return {
        "start_date": str(start),
        "end_date": str(end),
        "end_date_clamped_to_today": end_was_clamped,
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
    start, end, end_was_clamped = _validate_bulk_range(
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
        preview = preview_regenerate_flags_for_range_api(
            start_date=str(start), end_date=str(end)
        )
        # start and end are already clamped by the time they get here, so the
        # nested call sees a range that needs no trimming and reports none.
        # Only out here is the range the operator actually asked for still
        # known, and a preview that shows three days while flatly denying it
        # trimmed anything is worse than one that says nothing.
        preview["end_date_clamped_to_today"] = end_was_clamped
        return {"needs_confirm": True, "preview": preview}

    employees = _active_employee_names()
    days_processed = 0
    days_protected = 0
    days_deferred = 0
    days_failed = 0
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

            # Decided BEFORE the delete, and that order is the point: the
            # delete below is unscoped, so a day we are not going to rebuild
            # must not be wiped either. mode="closeout" over today would
            # otherwise destroy the day's flags and put nothing back.
            run_intraday = mode in ("intraday", "both")
            run_closeout = mode in ("closeout", "both") and _day_is_over(current)
            if mode in ("closeout", "both") and not run_closeout:
                days_deferred += 1
            if not (run_intraday or run_closeout):
                current = add_days(current, 1)
                continue

            try:
                # Wipe exactly as wide as the rebuild that follows it.
                #
                # A closeout pass rewrites the finals, so where one is running
                # the delete is unscoped -- refresh_intraday only clears its own
                # provisional rows (scoped to INTRADAY_FLAG_CODES), and without
                # this an old final nothing recomputes would sit there forever.
                #
                # Where no closeout pass is running, nothing will put a final
                # back, so deleting one is pure loss. Two ways to get there:
                # today, whose closeout half is withheld above and whose
                # day_closed=1 rows a branch device closing out at 18:00 may
                # already have written; and mode="intraday", which never
                # rebuilds finals on any date. The fallback covers only
                # yesterday and the webhook fires once per device-date, so in
                # both cases the rows are gone for good. intraday.py's own
                # delete is scoped for this exact reason and says so.
                _delete_auto_flags_for_employee_date(
                    employee=employee,
                    attendance_date=current,
                    day_closed=None if run_closeout else 0,
                )
                if run_intraday:
                    refresh_intraday_flags_for_employee_date(employee, current)
                if run_closeout:
                    _generate_for_employee_date(
                        employee=employee,
                        attendance_date=current,
                        include_unnotified_absence=True,
                    )
                days_processed += 1
            except Exception:
                # One employee-day must never abort the sweep. The engine has a
                # documented raise on an overnight interval running past minute
                # 1440 -- see _generate_for_employee_date_isolated, which exists
                # because that raise once silently starved every employee sorted
                # after a night worker. A quarter of every active employee is the
                # likeliest place to meet such data again, and aborting halfway
                # leaves exactly the two-shapes artifact this tool exists to
                # remove.
                #
                # The failing day may be left wiped with nothing rebuilt: the
                # delete and the rebuild are in the same try. That is why the
                # count comes back in the response rather than only to the Error
                # Log -- the tool is idempotent, so a re-run repairs it, but only
                # if the operator knows to re-run.
                days_failed += 1
                frappe.log_error(
                    title="Bulk flag regeneration failed for one employee-day",
                    message="employee={0} date={1}\n{2}".format(
                        employee, current, frappe.get_traceback()
                    ),
                )
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
        # Not disjoint from days_processed: mode="both" over today runs its
        # intraday half and defers only its closeout half, and counts in both.
        "closeout_days_deferred_until_the_day_ends": days_deferred,
        "end_date_clamped_to_today": end_was_clamped,
        # Logged to Error Log with the employee and date; surfaced here so a
        # re-run is an informed choice rather than a hope.
        "days_failed": days_failed,
    }


def _parse_dry_run(value) -> bool:
    """dry_run arrives as a STRING over HTTP, where "0" is truthy.

    Absent means True. The safe reading of a missing or unparseable value on a
    destructive endpoint is "do not delete anything".
    """
    if value is None:
        return True
    return _parse_confirm(value)


def _scoped_auto_flags(*, fields, extra_filters=None, branch=None):
    """AUTO flags plus their employees' branches, optionally narrowed to one branch.

    source == "AUTO" throughout: an HR-created flag on a pre-cutoff day is a
    deliberate human act and is never auto-deleted, never stamped, never counted.
    """
    filters = {"source": "AUTO"}
    if extra_filters:
        filters.update(extra_filters)
    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters=filters,
            fields=fields,
            limit_page_length=0,
        )
        or []
    )
    branch_by_employee = _branch_by_employee({row["employee"] for row in rows})
    if branch:
        rows = [
            row for row in rows if branch_by_employee.get(row["employee"]) == branch
        ]
    return rows, branch_by_employee


@frappe.whitelist()
def purge_testing_flags(branch=None, dry_run=1):
    """Delete every AUTO flag written inside a pilot window.

    The "remove the trial data" operation: run it once a branch is confidently live
    and its calibration flags have served their purpose.

    Backend-only on purpose. No button, no dialog -- punch-list item T1-5 was a
    finding about destructive controls being too visible in the SPA.

    Purged flags leave their Attendance Flag Decision rows pointing at nothing.
    That is already a state the queue reports (flag_grouping._orphans), and it is
    the honest outcome: the decision was practice, and so was the flag.
    """
    _require_system_manager_for_clear()
    dry_run = _parse_dry_run(dry_run)

    rows, branch_by_employee = _scoped_auto_flags(
        fields=["name", "employee"],
        extra_filters={"rollout_phase": rollout.TESTING},
        branch=branch,
    )

    by_branch = defaultdict(int)
    for row in rows:
        by_branch[branch_by_employee.get(row["employee"]) or ""] += 1

    if not dry_run and rows:
        frappe.db.delete("Attendance Flag", {"name": ["in", [r["name"] for r in rows]]})
        frappe.db.commit()

    return {
        "scanned": len(rows),
        "deleted": 0 if dry_run else len(rows),
        "by_branch": dict(by_branch),
        "dry_run": dry_run,
    }


@frappe.whitelist()
def reconcile_rollout_flags(branch=None, dry_run=1):
    """Make the flag table agree with the current rollout configuration.

    Two actions, per AUTO flag, computed from its own (employee's branch,
    attendance_date): a PRELAUNCH row is deleted, and any other row whose stored
    rollout_phase disagrees is restamped.

    This is the single owner of pre-cutoff removal. The engine's guards return
    before their deletes precisely so that policy lives in one place, which means
    running this is a step of setting or moving a date, not optional cleanup.

    An employee who has changed branch is judged by their CURRENT one -- a flag
    does not store the branch it was written under. Denormalising branch onto every
    flag to fix that would cost a column and a backfill to correct a case that
    arises only when someone transfers during a rollout window.
    """
    _require_system_manager_for_clear()
    dry_run = _parse_dry_run(dry_run)

    rows, branch_by_employee = _scoped_auto_flags(
        fields=["name", "employee", "attendance_date", "rollout_phase"],
        branch=branch,
    )

    to_delete = []
    to_restamp = []
    by_branch = defaultdict(lambda: {"deleted": 0, "restamped": 0})

    for row in rows:
        employee_branch = branch_by_employee.get(row["employee"])
        phase = rollout.phase_for(
            branch=employee_branch, attendance_date=row["attendance_date"]
        )
        key = employee_branch or ""
        if phase == rollout.PRELAUNCH:
            to_delete.append(row["name"])
            by_branch[key]["deleted"] += 1
        elif (row.get("rollout_phase") or None) != phase:
            to_restamp.append((row["name"], phase))
            by_branch[key]["restamped"] += 1

    if not dry_run:
        if to_delete:
            frappe.db.delete("Attendance Flag", {"name": ["in", to_delete]})
        for name, phase in to_restamp:
            # update_modified=False: a bulk backfill should not churn every row's
            # timestamp and make the whole table look freshly edited.
            frappe.db.set_value(
                "Attendance Flag", name, "rollout_phase", phase, update_modified=False
            )
        frappe.db.commit()

    return {
        "scanned": len(rows),
        "deleted": len(to_delete),
        "restamped": len(to_restamp),
        "by_branch": {key: dict(value) for key, value in by_branch.items()},
        "dry_run": dry_run,
    }
