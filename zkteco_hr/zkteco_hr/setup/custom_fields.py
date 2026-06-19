"""Custom fields zkteco_hr depends on.

These were added to the production site outside the app and were NOT shipped with
it, so a fresh `install-app zkteco_hr` (or any clean environment) was missing them
and the flag engine failed on the absent columns. They are now created on install
and ensured on every migrate. Idempotent.

Employee Checkin definitions are authoritative (taken from the prod docfield export
"Employee Checkin DocType Fields.csv"). The Shift Type definitions are inferred from
engine usage (Int grace, Time lunch window) — reconcile against the prod Custom Field
records if they ever differ.
"""
from __future__ import annotations

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

CUSTOM_FIELDS = {
    "Employee Checkin": [
        {"fieldname": "custom_device_branch", "label": "Device Branch",
         "fieldtype": "Link", "options": "Branch", "read_only": 1},
        {"fieldname": "custom_device_serial_number", "label": "Device Serial Number",
         "fieldtype": "Data", "read_only": 1},
        {"fieldname": "custom_supabase_log_id", "label": "Supabase Log ID",
         "fieldtype": "Data", "unique": 1, "read_only": 1, "in_standard_filter": 1},
    ],
    "Shift Type": [
        {"fieldname": "custom_grace_minutes", "label": "Grace Minutes", "fieldtype": "Int"},
        {"fieldname": "custom_lunch_start", "label": "Lunch Start", "fieldtype": "Time"},
        {"fieldname": "custom_lunch_end", "label": "Lunch End", "fieldtype": "Time"},
    ],
}


def make_custom_fields() -> None:
    """Create/update zkteco_hr's custom fields. Wired to after_install + after_migrate."""
    create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)
    frappe.db.commit()
