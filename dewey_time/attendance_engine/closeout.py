from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import add_days, cint, get_datetime, getdate, now_datetime, nowdate

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
from dewey_time.attendance_engine import rollout


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

    return _company_local_now(tz).hour == 3


def _site_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(frappe.defaults.get_global_default("time_zone") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _company_local_now(tz: ZoneInfo):
    """Now, in the company's timezone.

    now_datetime() returns a NAIVE site-local datetime. Calling .astimezone() on
    it makes Python assume the datetime is in the CONTAINER's local zone and
    convert from there — a second, silent conversion that skews the hour by the
    container/site offset (on Frappe Cloud the container is UTC). Attaching the
    site zone first makes the conversion mean what it reads as.
    """
    return now_datetime().replace(tzinfo=_site_timezone()).astimezone(tz)


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
        # The FULL device-level count, before any per-employee narrowing. A row
        # the bridge could not attribute to an Employee (pin only) vanishes from
        # every per-employee slice and from the delivery markers -- this stored
        # count is the one place "closed, but with residue" survives, and
        # feed_attested_complete refuses on it.
        #
        # None when the field was not supplied on a closed post: an ABSENT list
        # makes no claim and must not touch a stored residue, where an explicit
        # [] is the bridge positively stating "everything is delivered now"
        # (its re-close after a backfill) and may reset it. Without this line a
        # sloppy re-post of {status: closed} would zero a recorded residue and
        # the next rebuild would attest a day that lost punches.
        undelivered_count=(
            len(undelivered_items)
            if status == "closed" and undelivered not in (None, "")
            else None
        ),
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
    undelivered_count: int | None = None,
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
    # None = no claim about residue was made; an existing row keeps whatever it
    # recorded, and a new row falls to the columns' defaults -- 0/0, which the
    # predicate reads as "nothing recorded" and refuses. A number, zero
    # included, is a positive claim: it overwrites the count AND sets the
    # recorded bit. The bit exists because Frappe creates Int columns NOT NULL
    # DEFAULT 0, so the count alone cannot say whether zero was claimed or
    # merely never written.
    if undelivered_count is not None:
        values["undelivered_count"] = cint(undelivered_count)
        values["undelivered_recorded"] = 1
    elif status != "closed":
        # A day that re-opened (deferred_offline / closure_failed after a
        # close) is a day whose residue claim no longer describes it. Clear
        # the bit so a stale clean claim cannot be inherited across the
        # re-open by a later nonconforming close; a conforming close restates
        # the list and re-records.
        values["undelivered_recorded"] = 0

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
        # continue, not return: this is a per-employee loop over one company, and
        # branches inside it can be in different phases.
        if (
            rollout.phase_for(branch=employee_branch, attendance_date=attendance_date)
            == rollout.PRELAUNCH
        ):
            continue
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


def has_residue_closeout_alert(*, branch: str | None, local_date) -> bool:
    """A device at this branch closed the day admitting undelivered rows.

    `upsert_device_closeout_alert` stamps `resolved_at` on ANY closed status,
    residue included -- so a closed-with-residue day is invisible to
    `has_open_device_closeout_alert` while being exactly the state in which
    the engine must not trust silence: the bridge itself said rows exist that
    never arrived, and the pin-only residue (rows it could not attribute to
    an Employee) is recorded nowhere but this count. `feed_attested_complete`
    already refuses these rows for the lone-punch LATE_START path; without
    this, the ABSENCE path still accused a zero-checkin employee on a day
    their punches may sit in that residue -- and the Mini App then showed
    "no data came from the device" directly above "no record for this day".

    Resolved or not, deliberately: an unresolved residue row is already
    caught by the open-alert check, and filtering on resolution here would
    re-open the same hole one refactor later.
    """
    if not branch:
        return False

    local_date = getdate(local_date)
    return bool(
        frappe.db.exists(
            "Device Closeout Alert",
            {
                "branch": branch,
                "local_date": local_date,
                "undelivered_recorded": 1,
                "undelivered_count": [">", 0],
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
    # Closed-with-residue is untrustable silence too -- see
    # has_residue_closeout_alert. A flag already written for such a day is
    # retracted by the next rebuild, because this predicate re-derives from
    # the stored rows on every regeneration.
    if employee_branch and has_residue_closeout_alert(branch=employee_branch, local_date=attendance_date):
        return True
    return has_delivery_or_record_failure_today(employee, attendance_date)


def feed_attested_complete(
    *,
    employee_branch: str | None,
    punch_branch: str | None,
    punch_device: str | None,
    attendance_date,
    skip_absence: bool,
) -> bool:
    """Was this day's punch feed positively attested complete for this employee?

    `should_skip_absence_flags` asks "may the engine trust the SILENCE?" -- it
    looks for reasons to distrust. This is the opposite grip on the same
    evidence: a POSITIVE attestation that everything the devices recorded has
    arrived, used to trust a single punch rather than a missing one.

    STORED STATE ONLY, deliberately. The first version keyed on the webhook
    call's own `device_sn` parameter, and that context dies with the call:
    LATE_START lives in a delete-and-rebuild cycle, and three callers re-enter
    `_generate_for_employee_date` without it -- the 03:00 company fallback,
    the closed-day regeneration a punch edit enqueues, and the dev tools --
    each of which would wipe the flag and be unable to recreate it. Reading
    the `Device Closeout Alert` rows instead makes every rebuild re-derive
    the same answer, and makes a LATER complaint (a sibling device posting
    deferred_offline after this job ran) retract the flag on the next
    rebuild rather than never.

    The positive half is the last check: the device that recorded the lone
    punch must itself hold a CLOSED alert for this date with ZERO undelivered
    residue. The bridge reports closed only after a VERIFY_SUM count-match
    against the physical device, so that row is the device countersigning the
    day. `undelivered_count` is the FULL device-level figure the webhook
    stored -- a row the bridge could not attribute to an Employee never
    reaches the per-employee slices or the delivery markers, and this stored
    count is the one place it survives. None means the row predates the
    field, and unknown residue is refused the same as known residue.

    The branch set covers the cross-campus hole: the punch that would
    contradict a lone one is most plausibly held at whichever campus the
    person actually was, so both the home branch and the lone punch's own
    branch must be free of open alerts. An open alert whose branch was never
    recorded matches no branch query, so it is checked for by absence-of-
    branch explicitly. With NEITHER branch known, or no device on the punch
    (a Desk-entered row has no attesting device), there is nothing to
    countersign against and no attestation -- unknowable is not clean.

    ABSENCE OF COMPLAINTS IS NOT EVIDENCE, and the bridge makes that literal:
    its closure flow runs from a device's own poll or reconnect, and its
    stuck-closure sweep explicitly skips offline devices -- a device dark at
    close time posts NOTHING, not even deferred_offline, until it returns.
    (An earlier draft of this docstring claimed a 02:00 sweep posts
    deferred_offline for dark devices; the final-review pass read the bridge
    and found no such sweep exists.) So the open-alert checks above can only
    refuse on complaints that were actually filed, and the positive half
    below is a ROSTER, not a single row: Device Sync Status heartbeats one
    row per (device, branch, date) while a device is alive, so every device
    that was alive at a relevant branch on this date must itself hold a
    closed alert with a recorded zero residue. The device holding the missing
    arrival was alive that morning; its heartbeat row indicts it.

    The residue that genuinely remains -- stated at its true size, because
    undersizing it is how the first version of this docstring went wrong: the
    heartbeat is PUNCH-GATED, not liveness-gated (the bridge skips the post
    when no attendance_logs exist for the date, and the webhook requires
    last_device_log_at). So the invisible device is any device from which no
    day-D punch reached the bridge -- including one that polled all morning
    but went dark before its first delivered badge, which is exactly the
    badge that would have created the row. Its punches surface when it
    reconnects, and its own closeout then rebuilds the day and retracts
    anything they contradict.

    `undelivered_recorded` exists because Frappe creates Int columns NOT NULL
    DEFAULT 0 (NOT_NULL_TYPES in frappe/database/schema.py) -- a bare count
    cannot distinguish "zero residue was claimed" from "nothing was ever
    recorded", and after migrate every pre-existing row reads 0. The Check's
    own backfilled 0 IS the refusal, so historical rows are conservative by
    construction and no patch is needed.
    """
    if skip_absence:
        return False
    # Defensive, not decisive: a punch with no device also finds no closed
    # alert below (no alert row carries a NULL device_sn), so deleting this
    # line changes nothing observable. It stays because "a Desk-entered punch
    # has no attesting device" is a RULE, and rules stated as code survive the
    # refactor that would quietly change the query's behaviour.
    if not punch_device:
        return False
    # employee_branch is ALSO checked by skip_absence above (when set). Kept in
    # the set anyway: skip_absence's contract is "may the engine trust the
    # silence", owned by the absence path, and this predicate must not become
    # wrong the day that contract narrows.
    branches = {b for b in (employee_branch, punch_branch) if b}
    if not branches:
        return False
    if any(
        has_open_device_closeout_alert(branch=branch, local_date=attendance_date)
        for branch in branches
    ):
        return False
    # A device that reported itself unable to close, with no branch recorded:
    # it belongs to SOME branch, possibly one of ours, and nothing can say
    # which. Unknowable is not clean.
    if frappe.get_all(
        "Device Closeout Alert",
        filters={
            "local_date": getdate(attendance_date),
            "resolved_at": ["is", "not set"],
            "branch": ["is", "not set"],
        },
        limit=1,
    ):
        return False
    # THE ROSTER. Every device that delivered a day-D punch at a relevant
    # branch -- evidenced by its Device Sync Status row, which the bridge
    # posts only once attendance_logs exist for the date -- must have
    # countersigned the day, or the lone punch's missing sibling could be
    # sitting in exactly the device that went quiet. The punch's own device
    # is in the roster whether or not it heartbeated. Without the sync table
    # there is no roster and no attestation.
    if not frappe.db.table_exists("Device Sync Status"):
        return False
    alive = set()
    for branch in branches:
        alive.update(
            frappe.get_all(
                "Device Sync Status",
                filters={"branch": branch, "local_date": getdate(attendance_date)},
                pluck="device_sn",
            )
            or []
        )
    # The punch's own device must be IN the roster, not merely alongside it.
    # A device that delivered a punch and closed its day was certainly alive,
    # so in a working deployment its heartbeat row exists; its absence means
    # the sync integration is blind for this device-day, and a blind roster
    # proves nothing about who else was alive.
    if punch_device not in alive:
        return False
    return all(_device_closed_clean(device_sn, attendance_date) for device_sn in alive)


def _device_closed_clean(device_sn: str, attendance_date) -> bool:
    """One device's countersignature: closed, with a RECORDED zero residue."""
    closed = frappe.get_all(
        "Device Closeout Alert",
        filters={
            "device_sn": device_sn,
            "local_date": getdate(attendance_date),
            "status": "closed",
        },
        fields=["undelivered_count", "undelivered_recorded"],
        limit=1,
    )
    if not closed:
        return False
    row = closed[0]
    return bool(cint(row.get("undelivered_recorded"))) and cint(row.get("undelivered_count")) == 0


def delivery_failure_marker_names(employee: str, attendance_date) -> list[str]:
    """The rows recording "this employee's punches never arrived", by name.

    One query serving two questions that must never diverge: *was* there a
    failure, and *which rows say so*. If the predicate read one set and the
    delete protected a different one, the gap between them would be a marker
    destroyed while the answer still said "no failure" -- which is the exact
    failure this pair exists to prevent. Same rows, one definition, no gap.
    """
    attendance_date = getdate(attendance_date)
    names = (
        frappe.get_all(
            "Attendance Flag",
            filters={
                "employee": employee,
                "attendance_date": attendance_date,
                "flag_code": "DELIVERY_FAILED",
                "source": "AUTO",
            },
            pluck="name",
        )
        or []
    )
    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters={
                "employee": employee,
                "attendance_date": attendance_date,
                "flag_code": "ATTENDANCE_ISSUE",
                "source": "AUTO",
            },
            fields=["name", "evidence"],
        )
        or []
    )
    # ATTENDANCE_ISSUE carries several unrelated reasons (single_checkin,
    # unpaired_punch, unknown_device_branch); only the delivery_failed variant
    # is a marker. Protecting the code wholesale would strand the others, which
    # the rebuild then recreates alongside the survivors.
    names += [
        row["name"] for row in rows if "delivery_failed" in (row.get("evidence") or "")
    ]
    return names


def has_delivery_or_record_failure_today(employee: str, attendance_date) -> bool:
    return bool(delivery_failure_marker_names(employee, attendance_date))


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

    employee_doc = frappe.get_cached_doc("Employee", employee)
    employee_branch = getattr(employee_doc, "branch", None)
    employee_company = getattr(employee_doc, "company", None)

    # PRELAUNCH means the system was not watching this day, so there is nothing to
    # say about it and nothing to take back.
    #
    # Returning BEFORE the deletes below is the deliberate part.
    # _delete_auto_flags_for_employee_date carries the delivery-marker protection
    # added in #148, and running it on a day the engine has no opinion about would
    # re-open exactly the question that fix closed -- whether an ops record saying
    # "this device never delivered" survives a wipe -- in a context where the
    # answer is genuinely unclear. Removal of pre-cutoff rows has one owner
    # instead: dev_tools.reconcile_rollout_flags.
    if (
        rollout.phase_for(branch=employee_branch, attendance_date=attendance_date)
        == rollout.PRELAUNCH
    ):
        return

    # BEFORE the deletes below, and that ordering is the whole point.
    #
    # should_skip_absence_flags answers "were this employee's punches known not
    # to have arrived?", and it answers it by reading Attendance Flag rows --
    # the DELIVERY_FAILED row, and the ATTENDANCE_ISSUE variant carrying
    # delivery_failed evidence. Both are source=AUTO, so both are inside the
    # blast radius of the two deletes that follow. Asked afterwards, it reads
    # its own evidence as absent and reports "no failure", and the day earns an
    # UNNOTIFIED_ABSENCE it was deliberately spared -- a no-show recorded
    # against someone whose device simply never delivered.
    #
    # Harmless in the webhook path, which passes undelivered_items and rebuilds
    # the marker it just deleted. Reachable from any caller that does not: the
    # two dev tools, and anything added later. Captured here so the answer
    # cannot depend on which caller asked.
    skip_absence = should_skip_absence_flags(
        employee=employee,
        employee_branch=employee_branch,
        attendance_date=attendance_date,
    )

    # Reading before the delete makes THIS run correct. It does not stop the
    # delete destroying the marker, so the NEXT run over the same day reads
    # "no failure" and manufactures the no-show anyway -- the ordering fix
    # bought one run, not the property.
    #
    # So the marker survives the wipe unless something is going to rebuild it.
    # Exactly one caller does: the device-closeout webhook, which passes
    # undelivered_items and re-emits the rows from them. Sparing them there
    # would duplicate. Everywhere else -- both dev tools,
    # enqueue_closed_day_regeneration's two-punch-corrections path, and
    # anything added later -- nothing can recompute a marker that only ever
    # arrives from outside, so deleting it is pure loss.
    protected = (
        [] if undelivered_items else delivery_failure_marker_names(employee, attendance_date)
    )

    _delete_auto_flags_for_employee_date(
        employee=employee,
        attendance_date=attendance_date,
        day_closed=0,
        exclude_names=protected,
    )
    _delete_auto_flags_for_employee_date(
        employee=employee,
        attendance_date=attendance_date,
        day_closed=1,
        exclude_names=protected,
    )

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
        _insert_flags(
            employee=employee,
            company=employee_company,
            attendance_date=attendance_date,
            evidence=evidence,
            flags_to_create=flags_to_create,
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
        _insert_flags(
            employee=employee,
            company=employee_company,
            attendance_date=attendance_date,
            evidence=evidence,
            flags_to_create=flags_to_create,
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
        # `skip_absence`, captured above the deletes -- not a fresh call. See
        # the comment at the top of this function for why re-asking here reads
        # evidence this function has already destroyed.
        if include_unnotified_absence and not undelivered_items and not skip_absence:
            flags_to_create.insert(
                0, ("UNNOTIFIED_ABSENCE", {"reason": "on_shift_no_checkins"})
            )
        _insert_flags(
            employee=employee,
            company=employee_company,
            attendance_date=attendance_date,
            evidence=evidence,
            flags_to_create=flags_to_create,
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
        # THE 2-PUNCH RULE IS A PROXY, and on the webhook path the real signal
        # now exists. The rule guards against one specific false positive: the
        # lone punch whose earlier sibling -- the actual arrival -- was made
        # but LOST in transit, so "first punch at 8:34" would accuse someone
        # whose 7:55 punch is sitting in an offline device. When the bridge
        # has countersigned the day complete (feed_attested_complete), that
        # story is excluded and the guard's premise is gone: the lone punch
        # really was the only punch.
        #
        # What no attestation can exclude is the punch NEVER MADE -- a failed
        # fingerprint read leaves nothing in any pipe. Hence the window: the
        # lone punch must fall in the FIRST HALF of the shift to be read as an
        # arrival. Past the midpoint, "departure whose arrival never read" is
        # the better story and the engine stays silent, exactly as before.
        # ATTENDANCE_ISSUE(single_checkin) still fires alongside either way:
        # the day remains incomplete, and that finding stays true.
        _attested_lone_arrival = False
        # An explicit label on the punch is believed before any heuristic --
        # the same label-first rule punchDirection (attendancePunches.ts) and
        # the Telegram notifier's direction_of settled on, so one punch is
        # never described two different ways across surfaces. Only blank and
        # IN read as an arrival: an explicit OUT is a recorded DEPARTURE, and
        # anything else is a label this rule has no reading for. In production
        # the bridge writes no log_type at all, so this gate only ever fires
        # on Desk-entered or Desk-edited rows -- the window below is the
        # mitigation that carries the device stream.
        _lone_label = (
            str(checkins[0].get("log_type") or "").strip().upper() if checkins else ""
        )
        # `not _is_overnight` is provably inert -- on an overnight day the
        # window end lands BEFORE the start, so it can never coincide with
        # first_in > late_threshold -- but the exclusion is a stated rule
        # (overnight has its own 1-punch rule and must not also pay for these
        # queries), not an accident of the arithmetic.
        if (
            not _is_overnight
            and checkins_count == 1
            and shift_meta.get("end_time") is not None
            and first_in_dt
            and _lone_label in ("", "IN")
        ):
            _lone_branch = (checkins[0].get("custom_device_branch") or "").strip() or None
            _lone_device = (checkins[0].get("device_id") or "").strip() or None
            if feed_attested_complete(
                employee_branch=employee_branch,
                punch_branch=_lone_branch,
                punch_device=_lone_device,
                attendance_date=attendance_date,
                skip_absence=skip_absence,
            ):
                _end_dt = _combine_date_time(attendance_date, shift_meta["end_time"])
                # Measured from the shift START, not the late threshold: the
                # window answers "is a lone punch here credibly an arrival",
                # which is a fact about the shape of the shift, not about how
                # much lateness this shift forgives.
                _arrival_window_end = start_dt + (_end_dt - start_dt) / 2
                _attested_lone_arrival = first_in_dt <= _arrival_window_end
        _min_punches_for_late = 1 if (_is_overnight or _attested_lone_arrival) else 2
        if checkins_count >= _min_punches_for_late and first_in_dt and first_in_dt > late_threshold:
            _late_evidence = {
                **grace_evidence(shift_meta),
                "first_in": first_in_dt.isoformat(),
                "late_threshold": late_threshold.isoformat(),
            }
            if _attested_lone_arrival:
                # HR sees WHY the engine dared on one punch: the feed was
                # countersigned, and the punch sat inside the arrival window.
                _late_evidence["feed_attested"] = True
                _late_evidence["single_punch"] = True
                _late_evidence["arrival_window_end"] = _arrival_window_end.isoformat()
                _late_evidence["attesting_device"] = _lone_device
            flags_to_create.append(("LATE_START", _late_evidence))

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

    _insert_flags(
        employee=employee,
        company=employee_company,
        attendance_date=attendance_date,
        evidence=evidence,
        flags_to_create=flags_to_create,
    )


def _delete_auto_flags_for_employee_date(
    *,
    employee: str,
    attendance_date,
    day_closed: int | None = None,
    flag_codes: list[str] | None = None,
    exclude_names: list[str] | None = None,
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
    if exclude_names:
        # By name, not by code: the rows worth sparing sit inside a code whose
        # other rows must still go.
        filters["name"] = ["not in", exclude_names]
    frappe.db.delete("Attendance Flag", filters)


def _insert_flags(*, employee, company, attendance_date, evidence, flags_to_create):
    """Insert each flag independently, so one bad row cannot cost the others.

    Before this, all four call sites looped over `_insert_flag` bare. A single
    raise escaped the loop and was caught by
    `_generate_for_employee_date_isolated`, which logged it and moved to the
    next employee -- silently dropping every flag for this one that had not
    been written yet. Two delivery failures in one closeout did exactly that,
    via a duplicate docname (fixed in attendance_flag.py), but any future
    insert failure would have had the same blast radius.

    Failures go to the Error Log rather than being swallowed; the batch
    continues.
    """
    for flag_code, extra_evidence in flags_to_create:
        try:
            _insert_flag(
                employee=employee,
                company=company,
                attendance_date=attendance_date,
                flag_code=flag_code,
                evidence={**evidence, **extra_evidence},
            )
        except Exception:
            frappe.log_error(
                title="Attendance flag insert failed",
                message="employee={0} date={1} flag_code={2}\n{3}".format(
                    employee, attendance_date, flag_code, frappe.get_traceback()
                ),
            )


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
            # Derived from THIS flag's attendance_date, never from today. AUTO flags
            # are deleted and re-inserted on every checkin, so a phase read from the
            # current date would re-label the entire pilot window the moment go-live
            # passed. Only TESTING or LIVE can appear: the PRELAUNCH guards upstream
            # mean this function never runs for a pre-cutoff day.
            "rollout_phase": rollout.phase_for_employee(
                employee=employee, attendance_date=attendance_date
            ),
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
        # Returning None here makes the day look UNSCHEDULED to every caller,
        # which silently downgrades a real shift to an off day and suppresses
        # the flags that depend on it. A missing Shift Type is a configuration
        # error and an infra fault is transient; neither should be indistinguishable
        # from "this employee was not rostered", so leave a trace.
        frappe.log_error(
            title="Shift Type lookup failed",
            message="shift_type={0}\n{1}".format(shift_type, frappe.get_traceback()),
        )
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

