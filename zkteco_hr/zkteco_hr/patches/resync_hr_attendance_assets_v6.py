from zkteco_hr.utils.sync_hr_attendance_assets import (
    APP_BRAND_LOGO,
    force_sync_app_branding_assets,
)

import frappe


def execute():
    """Switch site branding to DI-logo.svg (Desk, login, app tile, SPA)."""
    force_sync_app_branding_assets()

    if frappe.db.exists("Desktop Icon", "ZKTeco HR"):
        frappe.db.set_value("Desktop Icon", "ZKTeco HR", "logo_url", APP_BRAND_LOGO)

    frappe.clear_cache()
