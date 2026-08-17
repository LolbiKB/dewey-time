"""Biometric enrollment read API.

Backs the HR-only Biometric Enrollment view (/hr-schedule/coverage/biometrics).

Shaped after coverage_api: HR role gate, a briefly-cached payload, and FLAT
rows plus counts. This module groups nothing -- the client does -- which is what
makes adding a third grouping axis a one-line change rather than a payload
redesign.
"""

from __future__ import annotations

import frappe
from frappe.query_builder.functions import Count
from frappe.utils import add_days, getdate

from dewey_time.attendance_engine import finger_slots
from dewey_time.attendance_engine.enrollment import ENROLLMENT_DOCTYPE, SETTINGS_DOCTYPE
from dewey_time.attendance_engine.enrollment_buckets import (
    ENROLLED_NOT_PUNCHING,
    LEAVER_STILL_ENROLLED,
    NEEDS_ENROLLMENT,
    OK,
    REPORTED_STATUSES,
    classify,
    days_since,
)
from dewey_time.attendance_engine.hr_calendar import _require_hr_role

# The version suffix is tied to the SHAPE of the cached payload, not to this
# module's behaviour: bump it whenever a field is added, renamed or removed
# anywhere in what get_enrollment_report returns. A deploy does not clear
# Redis, so for the whole TTL afterwards a key written by the OLD code can
# still answer a request from the NEW frontend; a new prefix simply cannot be
# hit by pre-deploy entries.
#
# v2: rows gained custom_khmer_last_name / custom_khmer_first_name.
_CACHE_KEY = "enrollment_report:v2"
_CACHE_TTL_SECONDS = 120

#: Matches COVERAGE_EMPLOYEE_LIMIT: this is meant to be an exhaustive roster.
ENROLLMENT_EMPLOYEE_LIMIT = 2000

#: How far back a check-in counts as "this template works". Two weeks clears
#: ordinary leave. Deliberately a constant and not a setting -- an unused
#: setting is a config surface someone must reason about forever.
NOT_PUNCHING_WINDOW_DAYS = 14

_BUCKET_COUNT_KEYS = {
    NEEDS_ENROLLMENT: "needs_enrollment",
    ENROLLED_NOT_PUNCHING: "enrolled_not_punching",
    OK: "ok",
    LEAVER_STILL_ENROLLED: "leaver_still_enrolled",
}


def _today():
    """Today as a real `date`. days_since subtracts it, so a string here would
    raise TypeError mid-render."""
    return getdate()


def _list_employees() -> list[dict]:
    fields = ["name", "employee_name", "status", "branch", "department", "relieving_date"]
    # Installed by dewey_time.setup.custom_fields, but a site mid-migration may
    # not have them yet -- and an unknown column makes frappe.get_all raise,
    # taking the whole enrollment register down rather than losing one
    # optional fact.
    for khmer_field in ("custom_khmer_last_name", "custom_khmer_first_name"):
        if frappe.db.has_column("Employee", khmer_field):
            fields.append(khmer_field)
    return frappe.get_all(
        "Employee",
        filters={"status": ["in", list(REPORTED_STATUSES) + ["Inactive", "Suspended"]]},
        fields=fields,
        limit_page_length=ENROLLMENT_EMPLOYEE_LIMIT,
        order_by="employee_name asc",
    )


def _register_rows() -> list[dict]:
    return frappe.get_all(
        ENROLLMENT_DOCTYPE,
        fields=["employee", "is_registered", "fingerprint_count", "face_count"],
        limit_page_length=0,
    )


def _checkin_counts(since) -> dict:
    """One aggregate for the whole roster -- never a query per employee.

    Built with frappe.qb rather than `fields=["count(name) as n"]`. Frappe v16
    rejects SQL functions written as strings in SELECT ("SQL functions are not
    allowed as strings in SELECT: count(name) as n"), so the string form threw
    on every call and took the whole report down with it. No mocked test could
    see that -- get_all is a MagicMock -- and this idiom has no precedent
    elsewhere in the app. Caught on a real bench.
    """
    checkin = frappe.qb.DocType("Employee Checkin")
    rows = (
        frappe.qb.from_(checkin)
        .select(checkin.employee, Count(checkin.name).as_("n"))
        .where(checkin.time >= since)
        .groupby(checkin.employee)
    ).run(as_dict=True)
    return {row["employee"]: row["n"] for row in rows}


#: A Single Datetime that was set and later cleared reads back as this, not
#: as None -- and it is TRUTHY.
_ZERO_DATETIME_PREFIX = "0001-01-01"


def _last_snapshot_at():
    """The freshness marker, or None when the bridge has never reported.

    Normalising the zero datetime is load-bearing, not tidiness. Clearing a
    Single's Datetime stores 0001-01-01 00:00:00 rather than NULL, and the
    client's feed gate is a truthiness check -- so a cleared marker would sail
    through it and render the entire roster as unenrolled, which is exactly the
    plumbing-failure-as-data misreading the gate exists to prevent. Observed on
    a real bench.
    """
    value = frappe.db.get_single_value(SETTINGS_DOCTYPE, "last_enrollment_snapshot_at")
    if not value or str(value).startswith(_ZERO_DATETIME_PREFIX):
        return None
    return value


def _build_enrollment_payload() -> dict:
    """Three queries flat, whatever the roster size: one Employee scan, one
    register read, one check-in aggregate.

    Iterates Employee and joins the register, never the reverse: a register row
    whose Employee was deleted (enrollment._clear_absent_rows leaves those
    behind on purpose) is then simply never rendered.
    """
    employees = _list_employees()
    register = {row["employee"]: row for row in _register_rows()}
    today = _today()
    counts = {key: 0 for key in _BUCKET_COUNT_KEYS.values()}
    counts["excluded_status"] = 0

    since = add_days(today, -NOT_PUNCHING_WINDOW_DAYS)
    checkins = _checkin_counts(since)

    rows = []
    for employee in employees:
        # No register row and a row with is_registered 0 are the same fact: the
        # bridge records an absent user by clearing the flag, not by deleting.
        reg = register.get(employee["name"]) or {}
        is_registered = bool(reg.get("is_registered"))
        bucket = classify(
            status=employee.get("status") or "",
            is_registered=is_registered,
            checkin_count=checkins.get(employee["name"], 0),
        )
        if bucket is None:
            # classify() returns None for two different reasons and only one of
            # them is counted.
            #
            # A status outside REPORTED_STATUSES (Inactive, Suspended) IS
            # counted: those people exist and were considered, so totals that
            # did not add up would read as a bug in the report rather than a
            # deliberate exclusion.
            #
            # A Left employee with no template is NOT counted. They are cleanly
            # offboarded -- there is nothing to do about them and nothing to
            # tell HR -- so they get neither a row nor an exclusion. That makes
            # reported + excluded_status strictly less than len(employees), on
            # purpose. Pinned by
            # test_a_cleanly_offboarded_leaver_is_neither_reported_nor_counted,
            # so "fixing the totals" fails a test instead of putting
            # already-finished work back in front of HR.
            if employee.get("status") not in REPORTED_STATUSES:
                counts["excluded_status"] += 1
            continue

        counts[_BUCKET_COUNT_KEYS[bucket]] += 1
        rows.append(
            {
                "id": employee["name"],
                "employee_name": employee.get("employee_name"),
                # Emitted, not merely selected. A field in the SELECT list that
                # the output dict drops is a production no-op returning None
                # forever. `.get` because the SELECT above is conditional.
                "custom_khmer_last_name": employee.get("custom_khmer_last_name"),
                "custom_khmer_first_name": employee.get("custom_khmer_first_name"),
                "branch": employee.get("branch"),
                "department": employee.get("department"),
                "status": employee.get("status"),
                "bucket": bucket,
                "is_registered": is_registered,
                "fingerprint_count": int(reg.get("fingerprint_count") or 0),
                "face_count": int(reg.get("face_count") or 0),
                # getdate() because a date column comes back as a string on some
                # paths, and days_since subtracts it from `today`.
                "days_since_relieving": days_since(
                    getdate(employee["relieving_date"]) if employee.get("relieving_date") else None,
                    today,
                ),
            }
        )

    counts["reported"] = len(rows)
    counts["truncated"] = len(employees) >= ENROLLMENT_EMPLOYEE_LIMIT

    return {
        "rows": rows,
        "counts": counts,
        "last_snapshot_at": _last_snapshot_at(),
        "window_days": NOT_PUNCHING_WINDOW_DAYS,
    }


def invalidate_enrollment_cache(doc=None, method=None):
    """Drop the cached payload. Wired to register doc events so a fresh
    snapshot shows up immediately rather than after the TTL."""
    frappe.cache().delete_value(_CACHE_KEY)


@frappe.whitelist()
def get_enrollment_report():
    """HR-only: every reported employee with their enrollment bucket."""
    _require_hr_role()

    cached = frappe.cache().get_value(_CACHE_KEY)
    if cached:
        return cached

    payload = _build_enrollment_payload()
    frappe.cache().set_value(_CACHE_KEY, payload, expires_in_sec=_CACHE_TTL_SECONDS)
    return payload


def enrollment_status(employee: str) -> dict:
    """Enrollment facts for one employee.

    The integration seam. The page is one consumer; a future onboarding or
    offboarding checklist is another, and it must be able to ask without
    building a whole report.

    `last_snapshot_at` is part of the answer on purpose: without it a caller
    cannot tell "this person is not enrolled" from "we have never heard from
    the bridge".
    """
    # Looked up by the `employee` FIELD, never by docname. The two are only
    # equal at creation: frappe.rename_doc on an Employee moves the field and
    # leaves the row's name behind, so a by-name lookup would find nothing and
    # this seam would answer "not enrolled" for someone who is. The same reason
    # enrollment.upsert_enrollment_row stopped keying on the docname.
    fields = ["employee", "is_registered", "fingerprint_count", "face_count", "synced_at"]
    # Guarded, the way _identity guards the Khmer name pair: on a site whose
    # migrate has not run, an unknown column makes the whole select raise --
    # which would take the Mini App's Profile tab down to lose one optional row.
    if frappe.db.has_column(ENROLLMENT_DOCTYPE, "finger_ids"):
        fields.append("finger_ids")

    row = frappe.db.get_value(
        ENROLLMENT_DOCTYPE,
        {"employee": employee},
        fields,
        as_dict=True,
    )
    return {
        "employee": employee,
        "is_registered": bool(row and row.get("is_registered")),
        "fingerprint_count": int((row or {}).get("fingerprint_count") or 0),
        "face_count": int((row or {}).get("face_count") or 0),
        # PARSED here rather than at each consumer: "3,6" is a storage detail,
        # and every caller re-parsing it is one caller getting it wrong.
        "finger_ids": finger_slots.ids_from_field((row or {}).get("finger_ids")),
        "synced_at": (row or {}).get("synced_at"),
        "last_snapshot_at": _last_snapshot_at(),
    }
