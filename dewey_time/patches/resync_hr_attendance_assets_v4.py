from dewey_time.utils.sync_hr_attendance_assets import (
    ATTENDANCE_APP_LOGO,
    force_sync_hr_attendance_assets,
)

import frappe


def execute():
    """Repair SPA 404/MIME errors by force-republishing the hr_attendance bundle."""
    force_sync_hr_attendance_assets()

    if frappe.db.exists("Desktop Icon", "Dewey Time"):
        frappe.db.set_value("Desktop Icon", "Dewey Time", "logo_url", ATTENDANCE_APP_LOGO)

    frappe.clear_cache()
