import os
import shutil

import frappe


def sync_hr_attendance_assets():
    """
    Copy Vite-built SPA assets into sites/assets for Frappe Cloud.

    bench build normally symlinks app public/, but this is a safe fallback when
    the symlink is missing (404 / text/html MIME for CSS and JS).
    """
    app = "zkteco_hr"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "hr_attendance")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "hr_attendance")

    if not os.path.isdir(src_dir):
        return

    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)

    shutil.copytree(src_dir, dest_dir)
