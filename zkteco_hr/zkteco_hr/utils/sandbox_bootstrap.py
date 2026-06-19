"""Sandbox bootstrap: create the custom fields zkteco_hr's engine reads.

Run via: bench --site <site> execute zkteco_hr.utils.sandbox_bootstrap.run

These custom fields exist on the production site (added outside the app) but the
app does NOT ship them as fixtures, so a vanilla `install-app zkteco_hr` (or a
schema-light backup) lacks them and the engine fails on the missing columns.
This recreates them for a sandbox/test bench. Idempotent.

This is also the reference example for the frappe-sandbox `bootstrap_method` hook:
any custom Frappe app can provide its own such module to set up the custom fields,
masters, or config its sandbox needs.
"""
from __future__ import annotations

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

_CUSTOM_FIELDS = {
    "Employee Checkin": [
        {"fieldname": "custom_device_branch", "label": "Device Branch", "fieldtype": "Data"},
        {"fieldname": "custom_device_serial_number", "label": "Device Serial Number", "fieldtype": "Data"},
        {"fieldname": "custom_supabase_log_id", "label": "Supabase Log ID", "fieldtype": "Data"},
    ],
    "Shift Type": [
        {"fieldname": "custom_grace_minutes", "label": "Grace Minutes", "fieldtype": "Int"},
        {"fieldname": "custom_lunch_start", "label": "Lunch Start", "fieldtype": "Time"},
        {"fieldname": "custom_lunch_end", "label": "Lunch End", "fieldtype": "Time"},
    ],
}


def run() -> str:
    create_custom_fields(_CUSTOM_FIELDS, ignore_validate=True)
    frappe.db.commit()
    n = sum(len(v) for v in _CUSTOM_FIELDS.values())
    return f"BOOTSTRAP_OK custom_fields={n}"
