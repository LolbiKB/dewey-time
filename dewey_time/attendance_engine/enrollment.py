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


def _clear_absent_rows(absent, *, synced_at=None, bridge_env=None) -> int:
    """Mark rows absent from the snapshot as unenrolled.

    Cleared rather than deleted: is_registered = 0 IS the "not enrolled" fact,
    and keeping the row preserves the pin and the last-seen counts for anyone
    investigating why a template disappeared.
    """
    for employee in absent:
        upsert_enrollment_row(
            employee=employee,
            pin=frappe.db.get_value(ENROLLMENT_DOCTYPE, employee, "pin"),
            is_registered=False,
            fingerprint_count=0,
            face_count=0,
            synced_at=synced_at,
            bridge_env=bridge_env,
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
    """
    validate_bridge_request()

    if isinstance(users, str):
        # frappe.parse_json is the framework's usual call for this, but it is
        # not present on the shared MagicMock the test suite runs against
        # (nothing in this codebase has needed it before), so json.loads --
        # what parse_json delegates to for a plain array/object body --
        # is used directly. Same behaviour against the bridge's real payload.
        users = json.loads(users)
    if not isinstance(users, list):
        frappe.throw("users must be a list")

    if len(users) > ENROLLMENT_SNAPSHOT_MAX_USERS:
        frappe.throw(
            f"Refusing a partial snapshot: {len(users)} users exceeds the "
            f"{ENROLLMENT_SNAPSHOT_MAX_USERS} ceiling"
        )

    linked = [u for u in users if (u or {}).get("frappe_employee_id")]
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

    seen = set()
    for user in linked:
        employee = user["frappe_employee_id"]
        seen.add(employee)
        upsert_enrollment_row(
            employee=employee,
            pin=user.get("pin"),
            is_registered=bool(user.get("is_registered")),
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
        "registered": len(linked),
        "cleared": cleared,
        "skipped_unlinked": skipped_unlinked,
        "scanned_at": str(scanned_at),
    }
