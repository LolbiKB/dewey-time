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


def _read_build_id(base_dir: str) -> str | None:
    path = os.path.join(base_dir, "assets", "build-id.txt")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            value = handle.read().strip()
            return value or None
    except OSError:
        return None


def _needs_hr_attendance_resync(src_dir: str, dest_dir: str) -> bool:
    """True when sites/assets must be republished from app public/."""
    if not os.path.lexists(dest_dir):
        return True

    try:
        resolved = os.path.realpath(dest_dir)
    except OSError:
        return True

    if not _hr_attendance_bundle_ok(resolved):
        return True

    src_build = _read_build_id(src_dir)
    dest_build = _read_build_id(resolved)
    if src_build and dest_build != src_build:
        return True

    return False


def _remove_dest(dest_dir: str) -> None:
    if os.path.islink(dest_dir):
        os.unlink(dest_dir)
    elif os.path.isdir(dest_dir):
        shutil.rmtree(dest_dir)
    elif os.path.isfile(dest_dir):
        os.remove(dest_dir)


SITE_FAVICON_LOGO = "/assets/zkteco_hr/images/DI-logo.svg"
HR_APP_LOGO = "/assets/zkteco_hr/images/attendance-svgrepo-com.svg"

# Site-wide Desk/login favicon (DI) vs ZKTeco HR app tile / SPA header (attendance).
APP_BRAND_LOGO = SITE_FAVICON_LOGO
ATTENDANCE_APP_LOGO = HR_APP_LOGO

_BRANDING_FILES = ("DI-logo.svg", "attendance-svgrepo-com.svg")


def _branding_assets_ok(base_dir: str) -> bool:
    if not base_dir or not os.path.isdir(base_dir):
        return False
    return all(os.path.isfile(os.path.join(base_dir, name)) for name in _BRANDING_FILES)


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

    if os.path.lexists(dest_dir) and not _needs_hr_attendance_resync(src_dir, dest_dir):
        sync_app_branding_assets()
        return

    if os.path.lexists(dest_dir):
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
