import frappe


def execute():
    """Drop the leftover "test_theme" Website Theme that breaks web pages.

    Its compiled CSS ships `@import "frappe/public/css/fonts/inter/inter.css"`,
    a relative path that 404s on Frappe Cloud (it resolves under
    /files/website_theme/), so the browser logs a `text/html` MIME stylesheet
    error on every web page. The theme was default-equivalent (primary stayed at
    Frappe's #171717, no brand customization), so reverting the site to the
    Standard web theme silences the error and changes nothing visible. The
    branded /login is styled by login_brand.css, independent of the web theme.

    Defensive + idempotent: only acts when the active theme is test_theme, and
    never aborts the migrate. Mirrors cleanup_zkteco_hr_desk_artifacts.
    """
    try:
        current = frappe.db.get_single_value("Website Settings", "website_theme")
    except Exception:
        return

    if not current or current.strip().lower().replace(" ", "_") != "test_theme":
        return

    # Unsetting the link is enough to stop loading the broken theme CSS.
    try:
        frappe.db.set_single_value("Website Settings", "website_theme", None)
    except Exception:
        frappe.log_error(title="reset_broken_website_theme", message=frappe.get_traceback())
        return

    # Best-effort removal of the orphaned theme record; harmless if it stays.
    if frappe.db.exists("Website Theme", current):
        try:
            frappe.delete_doc(
                "Website Theme", current, force=1, ignore_permissions=True, ignore_missing=True
            )
        except Exception:
            frappe.log_error(title="reset_broken_website_theme", message=frappe.get_traceback())

    frappe.clear_cache()
