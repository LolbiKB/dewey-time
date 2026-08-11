"""Bridge webhook: biometric enrollment snapshot ingest.

The third bridge -> Frappe feed, after device_sync and closeout, and it reuses
their authentication unchanged.
"""

from __future__ import annotations

import frappe

ENROLLMENT_DOCTYPE = "Employee Biometric Enrollment"
SETTINGS_DOCTYPE = "Dewey Time Settings"


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
    values = {
        "employee": employee,
        "pin": pin,
        # Frappe Check fields are 0/1. A bool round-trips through the ORM but
        # compares badly in db filters such as {"is_registered": 1}.
        "is_registered": 1 if is_registered else 0,
        "fingerprint_count": int(fingerprint_count or 0),
        "face_count": int(face_count or 0),
        "synced_at": synced_at,
        "bridge_env": bridge_env,
    }

    if frappe.db.exists(ENROLLMENT_DOCTYPE, employee):
        doc = frappe.get_doc(ENROLLMENT_DOCTYPE, employee)
    else:
        doc = frappe.get_doc({"doctype": ENROLLMENT_DOCTYPE, "name": employee})

    for field, value in values.items():
        setattr(doc, field, value)

    # autoname is field:employee, so the docname IS the employee id — but
    # that's only computed by Frappe once the document is saved. Setting it
    # explicitly makes the return value unambiguous immediately, rather than
    # relying on save() to have populated doc.name as a side effect.
    doc.name = employee

    doc.save(ignore_permissions=True)
    return doc.name
