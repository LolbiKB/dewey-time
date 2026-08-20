# PEP 604 `str | None` below needs this on Python 3.9, where a bare def-time
# annotation is a TypeError that takes the whole module import down — it took
# three unrelated test modules out of every local 3.9 run via hooks.py.
from __future__ import annotations

import os
import shutil

import frappe

from dewey_time.utils.asset_publish import publish_tree

# Same deploy rules as sync_hr_attendance_assets.py — read
# docs/HR_ATTENDANCE_DEPLOY.md before changing this module or asset URLs
# (sync onto a symlink deletes the bundle → 404 / text/html MIME on CSS).

APP = "dewey_time"
BUNDLE = "adms"


def _bundle_ok(base_dir: str) -> bool:
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


def _needs_resync(src_dir: str, dest_dir: str) -> bool:
    if not os.path.lexists(dest_dir):
        return True

    try:
        resolved = os.path.realpath(dest_dir)
    except OSError:
        return True

    if not _bundle_ok(resolved):
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


def _dest_is_the_source(src_dir: str, dest_dir: str) -> bool:
    """True when "publishing" here would delete the thing being published.

    On a bench, `sites/assets/<app>` is itself a symlink into the app's own
    `public/`. So `sites/assets/<app>/<bundle>` is not a symlink — it is an
    ordinary directory that resolves straight back to `src_dir`. `_remove_dest`
    checks the LEAF for a symlink, sees a plain directory, and hands it to
    `shutil.rmtree`, which deletes the source bundle.

    The blast radius is the whole point: every phone 404s, and `bench migrate`
    can no longer repair it, because the source check now fails too. Only a
    redeploy brings it back. The trigger is an operator running the documented
    repair helper for a bundle that looks stale.

    A destination that already IS the source is live by construction and needs
    no publishing at all, so returning early is both safe and correct.
    """
    try:
        return os.path.realpath(src_dir) == os.path.realpath(dest_dir)
    except OSError:
        return False


def sync_adms_assets():
    """Publish the ADMS dashboard bundle from app public/ to sites/assets/."""
    app_path = frappe.get_app_path(APP)
    src_dir = os.path.join(app_path, "public", BUNDLE)
    dest_dir = os.path.join(frappe.local.sites_path, "assets", APP, BUNDLE)

    if not _bundle_ok(src_dir):
        # App ships without the dashboard bundle until the first
        # scripts/build-frappe.mjs publish — nothing to sync.
        return

    if not _needs_resync(src_dir, dest_dir):
        return

    if _dest_is_the_source(src_dir, dest_dir):
        # The destination resolves back to the source; removing it would delete
        # the bundle. Already live — nothing to publish.
        return

    _remove_dest(dest_dir)
    if os.path.lexists(dest_dir):
        return

    publish_tree(src_dir, dest_dir)


def force_sync_adms_assets():
    """Unconditionally republish the ADMS bundle (bench console helper)."""
    app_path = frappe.get_app_path(APP)
    src_dir = os.path.join(app_path, "public", BUNDLE)
    dest_dir = os.path.join(frappe.local.sites_path, "assets", APP, BUNDLE)

    if not _bundle_ok(src_dir):
        frappe.log_error(
            title="force_sync_adms_assets missing source",
            message=f"Expected bundle at {src_dir}",
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
