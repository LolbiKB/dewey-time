"""Resilient ``after_migrate`` entrypoint that publishes all app assets.

Why this exists (June 2026 incident): the whole ``/assets/zkteco_hr/`` tree
404'd on prod. ``after_migrate`` ran a fallible DB handler
(``make_custom_fields``) *before* the asset syncs, so a single failure there
aborted the chain and the user-facing SPA bundle was never published.

This module fixes the ordering and the fragility: it runs the asset publish
steps FIRST and guards each one, so no later handler — and no single failing
step — can starve the bundle. A failure is logged via ``frappe.log_error`` but
never aborts migrate. See ``docs/HR_ATTENDANCE_DEPLOY.md``.
"""

import frappe

from zkteco_hr.utils.sync_adms_assets import sync_adms_assets
from zkteco_hr.utils.sync_hr_attendance_assets import sync_hr_attendance_assets


def publish_assets_after_migrate():
    """Publish SPA + branding + ADMS assets, resiliently.

    ``sync_hr_attendance_assets`` also republishes branding (``public/images/``),
    so it runs before ``sync_adms_assets``. Each step is independently guarded:
    a file-copy failure can never abort migrate or the remaining steps.
    """
    for step in (sync_hr_attendance_assets, sync_adms_assets):
        try:
            step()
        except Exception:
            # The error path must never itself raise (e.g. a step without
            # __name__), or it would abort migrate — the very thing we prevent.
            name = getattr(step, "__name__", repr(step))
            frappe.log_error(
                title=f"after_migrate asset publish failed: {name}",
                message=frappe.get_traceback(),
            )
