"""Deterministic, id-preserving PII scrub for the sandbox site. Non-skippable.

Run via: bench --site sandbox execute zkteco_hr.utils.anonymize.run
Refuses to run on a site whose name looks like production.
"""
from __future__ import annotations

import frappe

_PROD_MARKERS = ("dewey", "frappehr.com", "prod")


def is_prod_site(site_name: str) -> bool:
    name = (site_name or "").lower()
    return any(m in name for m in _PROD_MARKERS)


def _scrub_statements() -> list[tuple[str, dict]]:
    """(sql, params) pairs. Deterministic: derive fakes from the row's own name/id.
    Engine-relevant fields (time, log_type, shift, employee, custom_supabase_log_id)
    are intentionally NOT in any SET clause."""
    return [
        ("UPDATE `tabEmployee` SET "
         "employee_name = CONCAT('Employee ', name), "
         "first_name = CONCAT('Employee ', name), last_name = '', "
         "personal_email = CONCAT(name, '@example.test'), "
         "company_email = CONCAT(name, '@example.test'), "
         "cell_number = '000', bank_ac_no = NULL, passport_number = NULL, "
         "date_of_birth = NULL", {}),
        ("UPDATE `tabEmployee Checkin` SET "
         "employee_name = CONCAT('Employee ', employee), "
         "device_id = NULL, custom_device_serial_number = NULL, "
         "latitude = NULL, longitude = NULL", {}),
        ("UPDATE `tabAttendance Flag` SET "
         "employee_name = CONCAT('Employee ', employee)", {}),
        ("UPDATE `tabUser` SET "
         "full_name = CONCAT('User ', name), first_name = CONCAT('User ', name), "
         "last_name = '' WHERE name NOT IN ('Administrator', 'Guest')", {}),
        ("UPDATE `tabContact` SET first_name = CONCAT('Contact ', name), "
         "last_name = '', email_id = CONCAT(name, '@example.test')", {}),
        ("UPDATE `tabAddress` SET address_line1 = 'redacted', "
         "address_line2 = NULL, phone = NULL", {}),
    ]


def run() -> str:
    site = frappe.local.site
    if is_prod_site(site):
        raise RuntimeError(f"refusing to anonymize a prod-looking site: {site}")
    for sql, params in _scrub_statements():
        frappe.db.sql(sql, params)
    frappe.db.commit()
    return f"ANONYMIZE_OK site={site}"
