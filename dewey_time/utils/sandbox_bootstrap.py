"""Sandbox bootstrap: ensure the bench has what dewey_time's tests/engine expect.

Run via: bench --site <site> execute dewey_time.utils.sandbox_bootstrap.run

Four responsibilities, all idempotent and sandbox-only (invoked by the
frappe-sandbox harness after install-app on the test site and after seed --prod,
and by CI after creating its throwaway site — never by Frappe's prod hooks):

1. dewey_time's custom fields (reuses the app's canonical setup,
   dewey_time.setup.custom_fields), so a schema-light restore gets the same fields a
   real install/migrate creates. The app also creates these on
   after_install/after_migrate, so this is a safety net for older restores and the
   reference for the frappe-sandbox `bootstrap_method` hook.
2. ERPNext Fiscal Years spanning the current year, which HRMS's ``before_tests``
   bootstrap requires (get_fiscal_year(nowdate())) before ANY real-DB test (e.g.
   tests/test_integration_pilot_matrix.py) can run. Without these, the test runner
   aborts with FiscalYearError before reaching the test.
3. A Company — and the one ERPNext master its creation turns out to depend on.
   test_integration_pilot_matrix opens with
   ``frappe.db.get_value("Company", {}, "name")`` and links every Employee to the
   result, so with no Company the whole module dies in setUpClass. It went
   unrun for the entire life of the no-show-flag branch because of this, and
   the cause was recorded as "no Company/Country/Gender" when in fact Country
   (250) and Gender (3) were both present and only Company was missing.
   Creating one is not a one-liner on a seeded sandbox: Company.insert builds
   default warehouses and dies on ``Could not find Warehouse Type: Transit``,
   because ``seed --clean`` never runs ERPNext's setup wizard. One missing row
   is what stood between that branch and its own integration test.
4. Frappe's default Gender rows, for the same reason — `gender` is mandatory on
   Employee, so without them every Employee fixture dies on
   ``Could not find Gender: Male``. The prod-seeded sandbox already has these
   (hence item 3's note that Gender was present there); a site built by
   ``bench new-site`` does not.
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


SANDBOX_COMPANY = "Pilot Matrix Co"
SANDBOX_COMPANY_ABBR = "PMC"


def _ensure_company() -> str:
    """Idempotently guarantee at least one Company. ERPNext-guarded.

    Never touches an existing one: on a `seed --prod` restore the real
    companies are already there and this must be a no-op.
    """
    if not frappe.db.exists("DocType", "Company"):
        return "no-erpnext"
    existing = frappe.db.get_value("Company", {}, "name")
    if existing:
        return f"existing:{existing}"

    # Company.insert creates default warehouses, and the Transit one links to a
    # Warehouse Type that only ERPNext's setup wizard installs. A seeded
    # sandbox has never run that wizard, so create the row first or the insert
    # dies with LinkValidationError and takes the whole test module with it.
    if frappe.db.exists("DocType", "Warehouse Type") and not frappe.db.exists(
        "Warehouse Type", "Transit"
    ):
        frappe.get_doc({"doctype": "Warehouse Type", "name": "Transit"}).insert(
            ignore_permissions=True
        )

    doc = frappe.get_doc(
        {
            "doctype": "Company",
            "company_name": SANDBOX_COMPANY,
            "abbr": SANDBOX_COMPANY_ABBR,
            "default_currency": "USD",
            "country": "United States",
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return f"created:{doc.name}"


# Frappe's own defaults, from update_genders() in
# frappe/desk/page/setup_wizard/install_fixtures.py (v16). Spelled out rather
# than calling that function, which wraps each label in _() — on a site whose
# language is not English it would create translated names, and the Employee
# fixtures ask for the literal "Male".
DEFAULT_GENDERS = (
    "Male",
    "Female",
    "Other",
    "Transgender",
    "Genderqueer",
    "Non-Conforming",
    "Prefer not to say",
)


def _ensure_genders() -> int:
    """Idempotently create Frappe's default Gender rows.

    `gender` is mandatory on Employee, and the rows only exist on a site that
    completed the setup wizard. Never touches an existing row.
    """
    created = 0
    for gender in DEFAULT_GENDERS:
        if frappe.db.exists("Gender", gender):
            continue
        frappe.get_doc({"doctype": "Gender", "gender": gender}).insert(
            ignore_permissions=True, ignore_if_duplicate=True
        )
        created += 1
    if created:
        frappe.db.commit()
    return created


def run() -> str:
    make_custom_fields()
    fy = _ensure_fiscal_years()
    genders = _ensure_genders()
    company = _ensure_company()
    return (
        f"BOOTSTRAP_OK fiscal_years_created={fy} "
        f"genders_created={genders} company={company}"
    )
