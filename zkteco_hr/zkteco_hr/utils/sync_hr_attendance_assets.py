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


APP_BRAND_LOGO = "/assets/zkteco_hr/images/DI-logo.svg"
APP_BRAND_LOGO_FILE = "DI-logo.svg"

# Backward-compatible alias for older patches/imports.
ATTENDANCE_APP_LOGO = APP_BRAND_LOGO


def _branding_assets_ok(base_dir: str) -> bool:
    if not base_dir or not os.path.isdir(base_dir):
        return False
    return os.path.isfile(os.path.join(base_dir, APP_BRAND_LOGO_FILE))


def _copy_branding_files(src_dir: str, dest_dir: str) -> None:
    os.makedirs(dest_dir, exist_ok=True)
    for name in os.listdir(src_dir):
        src_file = os.path.join(src_dir, name)
        if os.path.isfile(src_file):
            shutil.copy2(src_file, os.path.join(dest_dir, name))


def sync_app_branding_assets():
    """
    Publish app branding images under sites/assets/zkteco_hr/images/.

    Frappe Cloud often has hr_attendance copied via migrate but no bench symlink
    for public/images/, which breaks Desk logo_url and SPA favicon (404).
    """
    app = "zkteco_hr"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "images")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "images")

    if not os.path.isdir(src_dir):
        return

    if not os.path.lexists(dest_dir):
        shutil.copytree(src_dir, dest_dir)
        return

    try:
        resolved = os.path.realpath(dest_dir)
    except OSError:
        resolved = ""

    if os.path.islink(dest_dir) and _branding_assets_ok(resolved):
        _copy_branding_files(src_dir, resolved)
        return

    if os.path.isdir(dest_dir) and _branding_assets_ok(dest_dir):
        _copy_branding_files(src_dir, dest_dir)
        return

    _remove_dest(dest_dir)
    if os.path.lexists(dest_dir):
        return

    shutil.copytree(src_dir, dest_dir)


def force_sync_app_branding_assets():
    """Unconditionally republish public/images/ into sites/assets/."""
    app = "zkteco_hr"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "images")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "images")

    if not os.path.isdir(src_dir):
        frappe.log_error(
            title="force_sync_app_branding_assets missing source",
            message=f"Expected branding assets at {src_dir}",
        )
        return

    if os.path.lexists(dest_dir):
        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        return

    shutil.copytree(src_dir, dest_dir)


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

    sync_app_branding_assets()


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
        sync_app_branding_assets()
        return

    if os.path.lexists(dest_dir):
        try:
            resolved = os.path.realpath(dest_dir)
        except OSError:
            resolved = ""

        if _hr_attendance_bundle_ok(resolved):
            sync_app_branding_assets()
            return

        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        sync_app_branding_assets()
        return

    # index.html contains Jinja; served only via www/hr-attendance.
    shutil.copytree(
        src_dir,
        dest_dir,
        ignore=shutil.ignore_patterns("index.html"),
    )

    sync_app_branding_assets()
