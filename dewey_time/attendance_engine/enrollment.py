"""Bridge webhook: biometric enrollment snapshot ingest.

The third bridge -> Frappe feed, after device_sync and closeout, and it reuses
their authentication unchanged.
"""

from __future__ import annotations

import json

import frappe
from frappe.utils import cint

from dewey_time.attendance_engine import finger_slots
from dewey_time.attendance_engine.bridge_auth import validate_bridge_request

ENROLLMENT_DOCTYPE = "Employee Biometric Enrollment"
SETTINGS_DOCTYPE = "Dewey Time Settings"


def _coerce_int(value):
    """Bridge payloads are wire data, not validated input. A malformed count
    must not abort a 237-row snapshot mid-loop — mirrors device_sync._coerce_int."""
    if value in (None, ""):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def upsert_enrollment_row(
    *,
    employee: str,
    pin=None,
    is_registered: bool = False,
    fingerprint_count=None,
    face_count=None,
    finger_ids=None,
    synced_at=None,
    bridge_env=None,
) -> str:
    """Create or update one register row, keyed on the `employee` FIELD.

    A new row is named after the employee (the doctype's autoname is
    field:employee), but an existing one is found by field and never by name.
    The two are only equal at creation: frappe.rename_doc on an Employee --
    routine HR cleanup -- rewrites this doctype's `employee` Link column and
    leaves the row's docname at the old id. Assuming they still match would
    miss the row and insert a second one, which violates unique:1 on
    `employee` and wedges every subsequent snapshot, forever.

    The two paths use different write calls on purpose -- see the insert()
    branch below, which the mocked test suite cannot distinguish from save()
    but a real bench can.
    """
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")

    values = {
        "employee": employee,
        "pin": pin,
        # Frappe Check fields are 0/1. A bool round-trips through the ORM but
        # compares badly in db filters such as {"is_registered": 1}.
        "is_registered": 1 if is_registered else 0,
        "fingerprint_count": _coerce_int(fingerprint_count),
        # Sorted and deduped on the way in, so a snapshot that changed nothing
        # does not rewrite `modified` on hundreds of rows. "" for nothing, never
        # None -- _clear_absent_rows writes "" too, and the two paths must not
        # leave a row's emptiness depending on which one last touched it.
        "finger_ids": finger_slots.field_from_ids(finger_ids),
        "face_count": _coerce_int(face_count),
        "synced_at": synced_at,
        "bridge_env": bridge_env,
    }

    existing = frappe.db.get_value(ENROLLMENT_DOCTYPE, {"employee": employee}, "name")
    if existing:
        doc = frappe.get_doc(ENROLLMENT_DOCTYPE, existing)
        for field, value in values.items():
            setattr(doc, field, value)
        doc.save(ignore_permissions=True)
    else:
        # insert(), not save(): a dict-constructed doc carrying an explicit
        # `name` is treated as an existing row, so save() takes the UPDATE path
        # and check_if_latest raises DoesNotExistError on the first write.
        # autoname is field:employee, so insert() derives the name itself and
        # `name` must NOT be passed here.
        doc = frappe.get_doc({"doctype": ENROLLMENT_DOCTYPE, **values})
        doc.insert(ignore_permissions=True)

    return doc.name


#: Hard ceiling on one snapshot payload. Production carries 237 bridge users.
ENROLLMENT_SNAPSHOT_MAX_USERS = 2000
#: Reject a snapshot that lost more than half its roster...
SNAPSHOT_SHRINK_RATIO = 0.5
#: ...but only once the roster is big enough that a ratio test means anything.
SNAPSHOT_SHRINK_FLOOR = 20


def _registered_employee_docnames() -> dict:
    """Every currently-registered row as {employee value: docname}.

    Both halves are needed and they are not interchangeable. The absent set is
    computed on employee VALUES, because that is what the bridge reports and
    what `seen` holds; the clearing write must go to the DOCNAME, because that
    is what db.set_value addresses. After a frappe.rename_doc on an Employee
    the two differ, and clearing by employee value would hand db.set_value a
    name that does not exist -- zero rows updated, no error raised, and the
    snapshot marker advancing as though the write had landed.
    """
    return {
        row["employee"]: row["name"]
        for row in frappe.get_all(
            ENROLLMENT_DOCTYPE,
            filters={"is_registered": 1},
            fields=["name", "employee"],
        )
    }


def _previous_registered_count() -> int:
    return frappe.db.count(ENROLLMENT_DOCTYPE, {"is_registered": 1})


def _existing_employee_ids(employee_ids) -> set:
    """Which of the linked employee ids still have an Employee record.

    One query for the whole payload, not one per row: a bridge user whose
    Employee has been deleted must be detected cheaply, because upserting
    against a dangling Link raises LinkValidationError and — left
    unhandled — would wedge the whole feed on every retry forever.
    """
    employee_ids = list(employee_ids)
    if not employee_ids:
        return set()
    return set(
        frappe.get_all("Employee", filters={"name": ["in", employee_ids]}, pluck="name")
    )


def _coerce_bool(value) -> bool:
    """Bridge payloads are wire data: a string "0"/"false" must not
    round-trip through bare bool() as True the way any non-empty string
    would — mirrors the scepticism _coerce_int applies to counts."""
    if isinstance(value, str):
        return value.strip().lower() not in ("", "0", "false", "no", "off")
    return bool(value)


def _aggregate_by_employee(linked) -> tuple:
    """Collapse the payload to one entry per employee. Returns (entries, dupes).

    The bridge's `users` table is one row per device PIN, and nothing stops two
    PINs mapping to one employee -- a re-enrolment under a new PIN with the
    stale row left behind is the ordinary way it happens. Upserting both would
    let the LAST array element win, so a stale entry carrying
    is_registered: false sorting after the live one flips that employee's
    register row to 0. For a leaver that is silent and serious:
    classify("Left", is_registered=False) returns None, so LEAVER_STILL_ENROLLED
    -- the security finding this whole report exists to surface -- simply
    disappears from the page with nothing anywhere reporting an error.

    So: OR the flags (enrolled on any device is enrolled), take the max of each
    count (the bigger number is the one that describes the person), and keep the
    first non-empty pin so a stale blank cannot erase the provenance a
    technician needs at the device. The duplicate count is returned rather than
    swallowed -- it is a real bridge-side data problem and the operator only
    finds out if we say so. It counts merged-away ENTRIES, not distinct
    employees (three PINs for one person is 2), because that is the number of
    stale rows there are to go and delete.
    """
    merged = {}
    duplicates = 0
    for user in linked:
        employee = user["frappe_employee_id"]
        current = merged.get(employee)
        if current is None:
            merged[employee] = {
                "frappe_employee_id": employee,
                "pin": user.get("pin"),
                "is_registered": _coerce_bool(user.get("is_registered")),
                "fingerprint_count": _coerce_int(user.get("fingerprint_count")),
                "face_count": _coerce_int(user.get("face_count")),
                "finger_ids": finger_slots.normalize_ids(user.get("finger_ids")),
            }
            continue

        duplicates += 1
        current["is_registered"] = current["is_registered"] or _coerce_bool(
            user.get("is_registered")
        )
        current["fingerprint_count"] = max(
            current["fingerprint_count"], _coerce_int(user.get("fingerprint_count"))
        )
        current["face_count"] = max(
            current["face_count"], _coerce_int(user.get("face_count"))
        )
        # UNION, not replace -- the same rule as OR-ing the flags. A template
        # that exists only on the other device is still one of this person's
        # fingers, and taking the last row's list would silently drop it.
        current["finger_ids"] = finger_slots.normalize_ids(
            current["finger_ids"] + finger_slots.normalize_ids(user.get("finger_ids"))
        )
        if not current["pin"]:
            current["pin"] = user.get("pin")

    return list(merged.values()), duplicates


def _clear_absent_rows(docnames, *, synced_at=None, bridge_env=None) -> int:
    """Mark rows absent from the snapshot as unenrolled.

    Takes DOCNAMES, not employee ids: see _registered_employee_docnames for why
    those are not the same value after an Employee rename, and why writing to
    the wrong one fails silently.

    Cleared rather than deleted: is_registered = 0 IS the "not enrolled" fact,
    and the row keeps its pin for anyone investigating a vanished template.

    Written with db.set_value rather than upsert_enrollment_row deliberately.
    A full doc.save() re-validates the `employee` Link, so a row whose Employee
    record was force-deleted would raise LinkValidationError and abort the whole
    snapshot on every retry — the same permanent wedge the missing-employee skip
    guards against on the upsert path. It is also 237 document saves for what is
    a status update. An orphaned row left behind is harmless: the read API
    iterates Employee and joins the register, so a register row with no Employee
    is never rendered.
    """
    for docname in docnames:
        frappe.db.set_value(
            ENROLLMENT_DOCTYPE,
            docname,
            {
                "is_registered": 0,
                "fingerprint_count": 0,
                "face_count": 0,
                # Cleared with the counts, and this is the load-bearing one: a
                # surviving "3,6" beside is_registered=0 would have the Mini App
                # naming two fingers directly under the words "Not set up".
                "finger_ids": "",
                "synced_at": synced_at,
                "bridge_env": bridge_env,
            },
            update_modified=True,
        )
    return len(docnames)


def _record_snapshot_time(scanned_at):
    frappe.db.set_single_value(SETTINGS_DOCTYPE, "last_enrollment_snapshot_at", scanned_at)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def notify_enrollment_snapshot(bridge_env=None, scanned_at=None, users=None, allow_shrink=0):
    """Bridge webhook: the complete biometric enrollment roster.

    Auth: API key (Authorization: token key:secret) + optional X-Bridge-Secret,
    identical to notify_device_sync_status.

    This is a SNAPSHOT, never a delta. A delta cannot express "this template was
    deleted", which is precisely the offboarding signal the report exists for.
    Any employee absent from `users` is therefore recorded as not enrolled --
    which is also why a truncated payload is dangerous enough to reject.

    All-or-nothing, no partial commit: `seen` is populated *before* each row's
    upsert runs (see the loop below), so if an upsert were caught and skipped
    rather than left to propagate, that employee would both dodge the
    absent-clearing pass below AND still let `_record_snapshot_time` /
    `frappe.db.commit` advance the marker -- telling every downstream reader
    the register is current when a row silently failed to write. Unlike
    `_coerce_int`'s per-field tolerance for one bad count, a raise from
    `upsert_enrollment_row` here is meant to abort the whole snapshot, not be
    swallowed. The one exception is a deleted Employee (see
    `_existing_employee_ids` below): a known, enumerable condition that gets
    a count instead of a crash, precisely because it is not unexpected.
    """
    validate_bridge_request()

    if not scanned_at:
        frappe.throw("scanned_at is required")

    if isinstance(users, str):
        # frappe.parse_json delegates to json.loads for a string body that is
        # a JSON array/object, so calling json.loads directly here is
        # production-equivalent.
        try:
            users = json.loads(users)
        except json.JSONDecodeError as exc:
            frappe.throw(f"users must be valid JSON: {exc}")
    if not isinstance(users, list):
        frappe.throw("users must be a list")

    if len(users) > ENROLLMENT_SNAPSHOT_MAX_USERS:
        frappe.throw(
            f"Refusing a partial snapshot: {len(users)} users exceeds the "
            f"{ENROLLMENT_SNAPSHOT_MAX_USERS} ceiling"
        )

    # Non-dict elements (a bare string, a number, None) are silently dropped
    # here rather than crashing on `.get(...)` -- mirrors
    # closeout._parse_undelivered's `isinstance(item, dict)` filter. They
    # fall out of `linked` and are counted in skipped_unlinked below same as
    # a proper row with no frappe_employee_id.
    linked = [u for u in users if isinstance(u, dict) and u.get("frappe_employee_id")]
    skipped_unlinked = len(users) - len(linked)

    # One entry per EMPLOYEE from here on, not per device PIN -- see
    # _aggregate_by_employee for why a duplicate would otherwise be able to
    # erase a leaver's enrollment flag. The shrink guard compares against a
    # per-employee count too, so it must run on the aggregated list.
    entries, duplicate_employee_ids = _aggregate_by_employee(linked)

    previous = _previous_registered_count()
    if (
        not cint(allow_shrink)
        and previous >= SNAPSHOT_SHRINK_FLOOR
        and len(entries) < previous * SNAPSHOT_SHRINK_RATIO
    ):
        frappe.throw(
            f"Refusing a partial snapshot: {len(entries)} linked users against "
            f"{previous} previously registered. A halved roster is far more likely "
            f"a truncated read than a mass departure. Set allow_shrink=1 if it is real."
        )

    # One query for the whole payload -- not one per row -- to find which
    # linked employees still have an Employee record. A bridge user whose
    # Employee was deleted must be skipped rather than crash doc.save() with
    # LinkValidationError, which would wedge this feed on every retry.
    existing_ids = _existing_employee_ids(e["frappe_employee_id"] for e in entries)

    skipped_missing_employee = 0
    seen = set()
    for entry in entries:
        employee = entry["frappe_employee_id"]
        if employee not in existing_ids:
            skipped_missing_employee += 1
            continue
        seen.add(employee)
        upsert_enrollment_row(
            employee=employee,
            pin=entry["pin"],
            is_registered=entry["is_registered"],
            fingerprint_count=entry["fingerprint_count"],
            face_count=entry["face_count"],
            finger_ids=entry["finger_ids"],
            synced_at=scanned_at,
            bridge_env=bridge_env,
        )

    # `seen` holds employee ids, so the absent set is computed on employee
    # values -- but the write goes to the docname, which a rename can make a
    # different string. See _registered_employee_docnames.
    registered = _registered_employee_docnames()
    absent = sorted(set(registered) - seen)
    cleared = _clear_absent_rows(
        [registered[employee] for employee in absent],
        synced_at=scanned_at,
        bridge_env=bridge_env,
    )

    _record_snapshot_time(scanned_at)

    frappe.db.commit()

    # AFTER the commit, deliberately. Invalidating first leaves a window in
    # which a concurrent get_enrollment_report rebuilds the payload from
    # pre-commit state and re-caches it for the full TTL -- worse than not
    # invalidating at all. The doc_events invalidations are inherently
    # pre-commit, so this explicit call is the only one that can close that
    # window, and it is also the only one a clear-only snapshot fires at all:
    # _clear_absent_rows writes through db.set_value, which runs no doc hooks.
    # Imported inside the function because enrollment_api imports
    # ENROLLMENT_DOCTYPE from this module, so a module-level import would be
    # circular (the same deferred idiom device_sync.py:169 uses).
    from dewey_time.attendance_engine.enrollment_api import invalidate_enrollment_cache

    invalidate_enrollment_cache()

    return {
        "ok": True,
        "registered": len(seen),
        "cleared": cleared,
        "skipped_unlinked": skipped_unlinked,
        "skipped_missing_employee": skipped_missing_employee,
        "duplicate_employee_ids": duplicate_employee_ids,
        "scanned_at": str(scanned_at),
    }
