from dewey_time.utils.sync_hr_attendance_assets import (
    ATTENDANCE_APP_LOGO,
    force_sync_app_branding_assets,
    force_sync_hr_attendance_assets,
)

import frappe


def execute():
    """Publish branding SVG to sites/assets (fixes Desk logo + favicon 404 on Cloud)."""
    force_sync_hr_attendance_assets()
    force_sync_app_branding_assets()

    if frappe.db.exists("Desktop Icon", "Dewey Time"):
        frappe.db.set_value("Desktop Icon", "Dewey Time", "logo_url", ATTENDANCE_APP_LOGO)

    frappe.clear_cache()
