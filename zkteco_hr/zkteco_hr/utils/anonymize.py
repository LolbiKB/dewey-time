"""Deterministic, id-preserving PII scrub for the sandbox site. Non-skippable.

Run via: bench --site sandbox execute zkteco_hr.utils.anonymize.run
Refuses to run on a site whose name looks like production.

Column-tolerant: only columns that actually exist on the restored schema are
scrubbed (a sandbox missing some custom fields, or a table absent entirely, is
skipped rather than crashing the scrub).

Notes:
- device_id / custom_device_serial_number are deterministically masked (not nulled)
  so device-closeout correlation (closeout.py filters Employee Checkin by device_id)
  is preserved while still de-identifying the raw hardware identifiers.
"""
from __future__ import annotations

import frappe

_PROD_MARKERS = ("dewey", "frappehr.com", "prod")

# Never scrub these — the flag engine depends on them. Belt-and-suspenders: the
# specs already exclude them, and run() filters them out as well.
_ENGINE_PROTECTED = frozenset({"time", "log_type", "shift", "employee", "custom_supabase_log_id"})


def is_prod_site(site_name: str) -> bool:
    name = (site_name or "").lower()
    return any(m in name for m in _PROD_MARKERS)


def _scrub_specs() -> list[tuple[str, dict, str]]:
    """(doctype, {column: sql_value_expr}, where_clause). Deterministic + id-preserving.
    Engine-relevant columns (see _ENGINE_PROTECTED) are intentionally never keys here."""
    return [
        ("Employee", {
            "employee_name": "CONCAT('Employee ', name)",
            "first_name": "CONCAT('Employee ', name)",
            "last_name": "''",
            "personal_email": "CONCAT(name, '@example.test')",
            "company_email": "CONCAT(name, '@example.test')",
            "cell_number": "'000'",
            "bank_ac_no": "''",
            "passport_number": "''",
            "date_of_birth": "NULL",
        }, ""),
        ("Employee Checkin", {
            "employee_name": "CONCAT('Employee ', employee)",
            "device_id": "CASE WHEN device_id IS NULL THEN NULL ELSE CONCAT('DEV-', LEFT(MD5(device_id), 8)) END",
            "custom_device_serial_number": "CASE WHEN custom_device_serial_number IS NULL THEN NULL ELSE CONCAT('SN-', LEFT(MD5(custom_device_serial_number), 8)) END",
            "latitude": "0",
            "longitude": "0",
        }, ""),
        ("Attendance Flag", {
            "employee_name": "CONCAT('Employee ', employee)",
        }, ""),
        ("User", {
            "full_name": "CONCAT('User ', name)",
            "first_name": "CONCAT('User ', name)",
            "last_name": "''",
        }, "WHERE name NOT IN ('Administrator', 'Guest')"),
        ("Contact", {
            "first_name": "CONCAT('Contact ', name)",
            "last_name": "''",
            "email_id": "CONCAT(name, '@example.test')",
            "phone": "''",
            "mobile_no": "''",
        }, ""),
        ("Address", {
            "address_line1": "'redacted'",
            "address_line2": "''",
            "phone": "''",
        }, ""),
    ]


def run() -> str:
    site = frappe.local.site
    if is_prod_site(site):
        raise RuntimeError(f"refusing to anonymize a prod-looking site: {site}")
    for doctype, set_map, where in _scrub_specs():
        try:
            existing = set(frappe.db.get_table_columns(doctype))
        except Exception:
            continue  # table absent on this schema
        cols = {c: e for c, e in set_map.items()
                if c in existing and c not in _ENGINE_PROTECTED}
        if not cols:
            continue
        set_clause = ", ".join(f"`{c}` = {e}" for c, e in cols.items())
        frappe.db.sql(f"UPDATE `tab{doctype}` SET {set_clause} {where}".strip())
    frappe.db.commit()
    return f"ANONYMIZE_OK site={site}"
