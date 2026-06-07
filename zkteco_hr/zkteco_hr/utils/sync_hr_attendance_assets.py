import os
import shutil

import frappe

# Before changing this module or asset URLs, read docs/HR_ATTENDANCE_DEPLOY.md
# (sync onto a symlink deletes the bundle → 404 / text/html MIME on CSS).


def _hr_attendance_bundle_ok(base_dir: str) -> bool:
    if not base_dir or not os.path.isdir(base_dir):
        return False
    assets_dir = os.path.join(base_dir, "assets")
    return os.path.isfile(os.path.join(assets_dir, "index.css")) and os.path.isfile(
        os.path.join(assets_dir, "index.js")
    )


def _remove_dest(dest_dir: str) -> None:
    if os.path.islink(dest_dir):
        os.unlink(dest_dir)
    elif os.path.isdir(dest_dir):
        shutil.rmtree(dest_dir)
    elif os.path.isfile(dest_dir):
        os.remove(dest_dir)


ATTENDANCE_APP_LOGO = "/assets/zkteco_hr/images/attendance-svgrepo-com.svg"


def force_sync_hr_attendance_assets():
    """Unconditionally republish SPA assets from app public/ to sites/assets/."""
    app = "zkteco_hr"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "hr_attendance")
    src_assets = os.path.join(src_dir, "assets")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "hr_attendance")

    if not os.path.isdir(src_assets):
        frappe.log_error(
            title="force_sync_hr_attendance_assets missing source",
            message=f"Expected bundle at {src_assets}",
        )
        return

    if os.path.lexists(dest_dir):
        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        return

    shutil.copytree(
        src_dir,
        dest_dir,
        ignore=shutil.ignore_patterns("index.html"),
    )


def sync_hr_attendance_assets():
    """
    Copy Vite-built SPA into sites/assets when the bundle is missing or unreachable.

    When sites/assets/.../hr_attendance already exposes index.js + index.css (symlink
    or copy), skip — never partial-sync into a healthy tree.

    When the bundle is missing (empty dir, broken symlink, or symlink target wiped),
    remove dest and full copytree from app public/. Never rmtree/copy only assets/
    through a symlink (that deletes the app bundle).
    """
    app = "zkteco_hr"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "hr_attendance")
    src_assets = os.path.join(src_dir, "assets")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "hr_attendance")

    if not os.path.isdir(src_assets):
        return

    if os.path.lexists(dest_dir):
        try:
            resolved = os.path.realpath(dest_dir)
        except OSError:
            resolved = ""

        if _hr_attendance_bundle_ok(resolved):
            return

        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        return

    # index.html contains Jinja; served only via www/hr-attendance.
    shutil.copytree(
        src_dir,
        dest_dir,
        ignore=shutil.ignore_patterns("index.html"),
    )
