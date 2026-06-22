"""Sandbox bootstrap: ensure the bench has what dewey_time's tests/engine expect.

Run via: bench --site <site> execute dewey_time.utils.sandbox_bootstrap.run

Two responsibilities, both idempotent and sandbox-only (invoked by the
frappe-sandbox harness after install-app on the test site and after seed --prod —
never by Frappe's prod hooks):

1. dewey_time's custom fields (reuses the app's canonical setup,
   dewey_time.setup.custom_fields), so a schema-light restore gets the same fields a
   real install/migrate creates. The app also creates these on
   after_install/after_migrate, so this is a safety net for older restores and the
   reference for the frappe-sandbox `bootstrap_method` hook.
2. ERPNext Fiscal Years spanning the current year, which HRMS's ``before_tests``
   bootstrap requires (get_fiscal_year(nowdate())) before ANY real-DB test (e.g.
   tests/test_integration_pilot_matrix.py) can run. Without these, the test runner
   aborts with FiscalYearError before reaching the test.
"""
from __future__ import annotations

import frappe

from dewey_time.setup.custom_fields import make_custom_fields


def _ensure_fiscal_years() -> int:
    """Idempotently create Fiscal Years around the current year. ERPNext-guarded."""
    if not frappe.db.exists("DocType", "Fiscal Year"):
        return 0  # ERPNext not installed — nothing to do.

    from frappe.utils import getdate, nowdate

    current = getdate(nowdate()).year
    created = 0
    for year in range(current - 2, current + 3):
        name = str(year)
        if frappe.db.exists("Fiscal Year", name):
            continue
        frappe.get_doc(
            {
                "doctype": "Fiscal Year",
                "year": name,
                "year_start_date": f"{year}-01-01",
                "year_end_date": f"{year}-12-31",
            }
        ).insert(ignore_permissions=True)
        created += 1
    if created:
        frappe.db.commit()
    return created


def run() -> str:
    make_custom_fields()
    fy = _ensure_fiscal_years()
    return f"BOOTSTRAP_OK fiscal_years_created={fy}"
