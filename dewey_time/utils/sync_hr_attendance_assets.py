# `str | None` below is PEP 604 syntax, evaluated at def time on Python 3.9 and
# a TypeError there. hooks.py imports this module first, so the failure took
# test_flag_queue_api, test_hooks_launcher_tiles and test_hr_flags_route_wiring
# out of every local run -- silently, as three collection errors nobody read.
from __future__ import annotations

import os
import shutil

import frappe

from dewey_time.utils.asset_publish import publish_tree, referenced_fonts_present

# Before changing this module or asset URLs, read docs/HR_ATTENDANCE_DEPLOY.md
# (sync onto a symlink deletes the bundle → 404 / text/html MIME on CSS).


def _hr_attendance_bundle_ok(base_dir: str) -> bool:
    if not base_dir or not os.path.isdir(base_dir):
        return False
    assets_dir = os.path.join(base_dir, "assets")
    if not (
        os.path.isfile(os.path.join(assets_dir, "index.css"))
        and os.path.isfile(os.path.join(assets_dir, "index.js"))
    ):
        return False
    # Fonts too -- see sync_miniapp_assets._bundle_ok.
    return referenced_fonts_present(base_dir)


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


SITE_FAVICON_LOGO = "/assets/dewey_time/images/DI-logo.svg"
HR_APP_LOGO = "/assets/dewey_time/images/dewey-time.svg"
ADMS_APP_LOGO = "/assets/dewey_time/images/adms-bridge.svg"

# Site-wide Desk/login favicon (DI) vs Dewey Time app tile / SPA header (attendance)
# vs the ADMS device-admin dashboard (the self-drawing Waypoints bridge mark).
APP_BRAND_LOGO = SITE_FAVICON_LOGO
ATTENDANCE_APP_LOGO = HR_APP_LOGO

_BRANDING_FILES = ("DI-logo.svg", "dewey-time.svg", "adms-bridge.svg")


def _branding_assets_ok(base_dir: str) -> bool:
    if not base_dir or not os.path.isdir(base_dir):
        return False
    return all(os.path.isfile(os.path.join(base_dir, name)) for name in _BRANDING_FILES)


def _copy_branding_files(src_dir: str, dest_dir: str) -> None:
    os.makedirs(dest_dir, exist_ok=True)
    for name in os.listdir(src_dir):
        src_file = os.path.join(src_dir, name)
        if not os.path.isfile(src_file):
            continue
        dst_file = os.path.join(dest_dir, name)
        # On Frappe Cloud sites/assets/<app> can be a symlink back to the app's
        # own public/, so src and dest resolve to the same inode — copy2 would
        # raise SameFileError and abort `bench migrate`. Skip those.
        if os.path.realpath(src_file) == os.path.realpath(dst_file):
            continue
        shutil.copy2(src_file, dst_file)


def sync_app_branding_assets():
    """
    Publish app branding images under sites/assets/dewey_time/images/.

    Frappe Cloud often has hr_attendance copied via migrate but no bench symlink
    for public/images/, which breaks Desk logo_url and SPA favicon (404).
    """
    app = "dewey_time"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "images")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "images")

    if not os.path.isdir(src_dir):
        return

    if not os.path.lexists(dest_dir):
        publish_tree(src_dir, dest_dir)
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

    if _dest_is_the_source(src_dir, dest_dir):
        # On the bench-symlink layout an incomplete-LOOKING destination IS the
        # source (e.g. a file was renamed out of _BRANDING_FILES): removing it
        # here would delete public/images itself, and this function runs on
        # EVERY migrate via sync_hr_attendance_assets. Already live — the file
        # copy above is the only publishing that makes sense, and it ran or
        # was refused above.
        return

    _remove_dest(dest_dir)
    if os.path.lexists(dest_dir):
        return

    publish_tree(src_dir, dest_dir)


def force_sync_app_branding_assets():
    """Unconditionally republish public/images/ into sites/assets/."""
    app = "dewey_time"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "images")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "images")

    if not os.path.isdir(src_dir):
        frappe.log_error(
            title="force_sync_app_branding_assets missing source",
            message=f"Expected branding assets at {src_dir}",
        )
        return

    if _dest_is_the_source(src_dir, dest_dir):
        # The destination resolves back to the source; removing it would delete
        # the bundle. Already live — nothing to publish.
        return

    if os.path.lexists(dest_dir):
        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        return

    publish_tree(src_dir, dest_dir)


def force_sync_hr_attendance_assets():
    """Unconditionally republish SPA assets from app public/ to sites/assets/."""
    app = "dewey_time"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "hr_attendance")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "hr_attendance")

    # The SAME completeness bar as the migrate path: force-publishing a
    # degraded source (an aborted vite build) replaces a working deployment
    # with a broken one on any layout where the copy actually happens.
    if not _hr_attendance_bundle_ok(src_dir):
        frappe.log_error(
            title="force_sync_hr_attendance_assets missing source",
            message=f"Expected a complete bundle at {src_dir}",
        )
        return

    if _dest_is_the_source(src_dir, dest_dir):
        # The destination resolves back to the source; removing it would delete
        # the bundle. Already live — nothing to publish.
        return

    if os.path.lexists(dest_dir):
        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        return

    publish_tree(src_dir, dest_dir, ignore=shutil.ignore_patterns("index.html"))

    sync_app_branding_assets()


def _dest_is_the_source(src_dir: str, dest_dir: str) -> bool:
    """True when "publishing" here would delete the thing being published.

    On a bench, `sites/assets/<app>` is itself a symlink into the app's own
    `public/`, so `sites/assets/<app>/<bundle>` is not a symlink — it is an
    ordinary directory resolving straight back to `src_dir`. `_remove_dest`
    checks the LEAF for a symlink, sees a plain directory, and `shutil.rmtree`
    then deletes the source. See docs/HR_ATTENDANCE_DEPLOY.md.
    """
    try:
        return os.path.realpath(src_dir) == os.path.realpath(dest_dir)
    except OSError:
        return False


def sync_hr_attendance_assets():
    """
    Copy Vite-built SPA into sites/assets when the bundle is missing or unreachable.

    When sites/assets/.../hr_attendance already exposes index.js + index.css (symlink
    or copy), skip — never partial-sync into a healthy tree.

    When the bundle is missing (empty dir, broken symlink, or symlink target wiped),
    remove dest and full copytree from app public/. Never rmtree/copy only assets/
    through a symlink (that deletes the app bundle).
    """
    app = "dewey_time"
    app_path = frappe.get_app_path(app)
    src_dir = os.path.join(app_path, "public", "hr_attendance")
    dest_dir = os.path.join(frappe.local.sites_path, "assets", app, "hr_attendance")

    # A COMPLETE source, not merely an assets/ directory. An aborted vite
    # build (emptyOutDir wipes first) leaves assets/ present with index.*
    # missing; publishing that would replace a working deployment with a
    # broken one — and on the bench-symlink layout, without the guard below,
    # the old isdir check let _remove_dest delete the app's own bundle.
    # The miniapp and adms syncs have always checked their source this way.
    if not _hr_attendance_bundle_ok(src_dir):
        sync_app_branding_assets()
        return

    if os.path.lexists(dest_dir) and not _needs_hr_attendance_resync(src_dir, dest_dir):
        sync_app_branding_assets()
        return

    if _dest_is_the_source(src_dir, dest_dir):
        # THE after_migrate PATH of the guard the force helper already has: on
        # a bench, sites/assets/dewey_time is a symlink into the app's own
        # public/, so a "stale-looking" destination here IS the source and
        # removing it deletes the committed bundle from the app tree.
        sync_app_branding_assets()
        return

    if os.path.lexists(dest_dir):
        _remove_dest(dest_dir)

    if os.path.lexists(dest_dir):
        sync_app_branding_assets()
        return

    # index.html contains Jinja; served only via www/hr-attendance.
    publish_tree(src_dir, dest_dir, ignore=shutil.ignore_patterns("index.html"))

    sync_app_branding_assets()
