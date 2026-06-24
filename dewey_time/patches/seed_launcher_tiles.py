import frappe

from dewey_time.utils.sync_hr_attendance_assets import (
    ADMS_APP_LOGO,
    ATTENDANCE_APP_LOGO,
    SITE_FAVICON_LOGO,
)

# Seeded launcher tiles = the v1 curated registry, now data. Idempotent: only
# inserts tiles that don't already exist, so admins' later edits are preserved.
_TILES = [
    {"app_name": "dewey_time", "title": "HR Attendance", "route": "/hr-attendance", "icon": ATTENDANCE_APP_LOGO, "tile_order": 10, "is_admin": 0, "gate": "hr_or_employee"},
    {"app_name": "adms", "title": "ADMS Bridge", "route": "/adms", "icon": ADMS_APP_LOGO, "tile_order": 20, "is_admin": 1, "gate": "adms"},
    {"app_name": "desk", "title": "Frappe Desk", "route": "/desk", "icon": SITE_FAVICON_LOGO, "tile_order": 30, "is_admin": 1, "gate": "desk"},
]


def execute():
    for tile in _TILES:
        if frappe.db.exists("Launcher Tile", tile["app_name"]):
            continue
        doc = {"doctype": "Launcher Tile", "enabled": 1, **tile}
        frappe.get_doc(doc).insert(ignore_permissions=True)
    frappe.clear_cache()
