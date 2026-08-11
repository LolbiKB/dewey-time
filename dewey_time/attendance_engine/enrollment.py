"""Bridge webhook: biometric enrollment snapshot ingest.

The third bridge -> Frappe feed, after device_sync and closeout, and it reuses
their authentication unchanged.
"""

from __future__ import annotations

import frappe

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
