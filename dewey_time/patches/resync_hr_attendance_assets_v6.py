from dewey_time.utils.sync_hr_attendance_assets import (
    APP_BRAND_LOGO,
    force_sync_app_branding_assets,
)

import frappe


def execute():
    """Switch site branding to DI-logo.svg (Desk, login, app tile, SPA)."""
    force_sync_app_branding_assets()

    if frappe.db.exists("Desktop Icon", "Dewey Time"):
        frappe.db.set_value("Desktop Icon", "Dewey Time", "logo_url", APP_BRAND_LOGO)

    frappe.clear_cache()
