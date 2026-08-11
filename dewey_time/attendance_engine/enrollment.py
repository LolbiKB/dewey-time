"""Bridge webhook: biometric enrollment snapshot ingest.

The third bridge -> Frappe feed, after device_sync and closeout, and it reuses
their authentication unchanged.
"""

from __future__ import annotations

import json

import frappe
from frappe.utils import cint

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
    synced_at=None,
    bridge_env=None,
) -> str:
    """Create or update one register row. The docname IS the employee id."""
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
        "face_count": _coerce_int(face_count),
        "synced_at": synced_at,
        "bridge_env": bridge_env,
    }

    if frappe.db.exists(ENROLLMENT_DOCTYPE, employee):
        doc = frappe.get_doc(ENROLLMENT_DOCTYPE, employee)
    else:
        doc = frappe.get_doc({"doctype": ENROLLMENT_DOCTYPE, "name": employee})

    for field, value in values.items():
        setattr(doc, field, value)

    doc.save(ignore_permissions=True)
    return doc.name


#: Hard ceiling on one snapshot payload. Production carries 237 bridge users.
ENROLLMENT_SNAPSHOT_MAX_USERS = 2000
#: Reject a snapshot that lost more than half its roster...
SNAPSHOT_SHRINK_RATIO = 0.5
#: ...but only once the roster is big enough that a ratio test means anything.
SNAPSHOT_SHRINK_FLOOR = 20


def _registered_employee_ids() -> set:
    return set(
        frappe.get_all(
            ENROLLMENT_DOCTYPE,
            filters={"is_registered": 1},
            pluck="employee",
        )
    )


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


def _clear_absent_rows(absent, *, synced_at=None, bridge_env=None) -> int:
    """Mark rows absent from the snapshot as unenrolled.

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
    for employee in absent:
        frappe.db.set_value(
            ENROLLMENT_DOCTYPE,
            employee,
            {
                "is_registered": 0,
                "fingerprint_count": 0,
                "face_count": 0,
                "synced_at": synced_at,
                "bridge_env": bridge_env,
            },
            update_modified=True,
        )
    return len(absent)


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

    previous = _previous_registered_count()
    if (
        not cint(allow_shrink)
        and previous >= SNAPSHOT_SHRINK_FLOOR
        and len(linked) < previous * SNAPSHOT_SHRINK_RATIO
    ):
        frappe.throw(
            f"Refusing a partial snapshot: {len(linked)} linked users against "
            f"{previous} previously registered. A halved roster is far more likely "
            f"a truncated read than a mass departure. Set allow_shrink=1 if it is real."
        )

    # One query for the whole payload -- not one per row -- to find which
    # linked employees still have an Employee record. A bridge user whose
    # Employee was deleted must be skipped rather than crash doc.save() with
    # LinkValidationError, which would wedge this feed on every retry.
    existing_ids = _existing_employee_ids(u["frappe_employee_id"] for u in linked)

    skipped_missing_employee = 0
    seen = set()
    for user in linked:
        employee = user["frappe_employee_id"]
        if employee not in existing_ids:
            skipped_missing_employee += 1
            continue
        seen.add(employee)
        upsert_enrollment_row(
            employee=employee,
            pin=user.get("pin"),
            is_registered=_coerce_bool(user.get("is_registered")),
            fingerprint_count=user.get("fingerprint_count"),
            face_count=user.get("face_count"),
            synced_at=scanned_at,
            bridge_env=bridge_env,
        )

    absent = sorted(_registered_employee_ids() - seen)
    cleared = _clear_absent_rows(absent, synced_at=scanned_at, bridge_env=bridge_env)

    _record_snapshot_time(scanned_at)
    frappe.db.commit()

    return {
        "ok": True,
        "registered": len(seen),
        "cleared": cleared,
        "skipped_unlinked": skipped_unlinked,
        "skipped_missing_employee": skipped_missing_employee,
        "scanned_at": str(scanned_at),
    }
