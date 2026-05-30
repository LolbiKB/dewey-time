import os
import shutil

import frappe


def sync_hr_attendance_assets():
    """
    Copy Vite-built SPA into sites/assets when bench build symlinks are missing.

    When sites/assets/.../hr_attendance is already a symlink to app public/,
    files are served directly from public/ — skip copy. Copying assets/ onto the
    same path (via symlink) deletes the bundle and causes 404 / text/html MIME errors.
    """
    app = "zkteco_hr"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "hr_attendance")
    src_assets = os.path.join(src_dir, "assets")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "hr_attendance")

    if not os.path.isdir(src_assets):
        return

    if os.path.islink(dest_dir):
        return

    dest_assets = os.path.join(dest_dir, "assets")
    if os.path.exists(dest_assets):
        try:
            if os.path.samefile(src_assets, dest_assets):
                return
        except OSError:
            pass

    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)

    # index.html contains Jinja; served only via www/hr-attendance.
    shutil.copytree(
        src_dir,
        dest_dir,
        ignore=shutil.ignore_patterns("index.html"),
    )
