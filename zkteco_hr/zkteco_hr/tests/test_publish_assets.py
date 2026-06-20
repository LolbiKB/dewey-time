"""Tests for the resilient after_migrate asset publisher.

Root cause these guard against (June 2026 incident): the whole
`/assets/zkteco_hr/` tree 404'd on prod because the `after_migrate` chain
ran a fallible DB handler (`make_custom_fields`) *before* the asset syncs,
so any failure there starved the user-facing SPA bundle. The publisher must
(1) run the asset steps first, (2) keep going if one step raises, and
(3) be wired first in `hooks.after_migrate`.

Stubbing note: the no-Docker fast runner has no real `frappe`, and the real
sync modules use `X | None` annotations (py3.10+). We stub both — as other
fast tests do (test_closeout, test_custom_fields) — so `publish_assets`'s
own orchestration logic is what's exercised here. The real imports are
covered by the Docker CI-parity gate.
"""

import sys
import types
import unittest
from unittest.mock import MagicMock, patch


def _install_stubs():
    """Try real imports first; stub only what the no-Docker fast runner lacks.

    Under the Docker CI-parity bench the real `frappe` and sync modules import
    fine (py3.10+), so we must NOT clobber them — that would corrupt the shared
    test process. Only when the real import fails (fast runner: no frappe, and
    the sync modules use `X | None` py3.10 syntax) do we install a stub.
    """
    try:
        __import__("frappe")
    except Exception:
        frappe = MagicMock(name="frappe")
        frappe.get_traceback = MagicMock(return_value="<traceback>")
        sys.modules["frappe"] = frappe

    # hooks.py also imports the two logo constants from the hr_attendance module.
    specs = (
        (
            "zkteco_hr.utils.sync_hr_attendance_assets",
            {
                "sync_hr_attendance_assets": MagicMock(
                    name="sync_hr_attendance_assets"
                ),
                "ATTENDANCE_APP_LOGO": "/assets/zkteco_hr/images/attendance.svg",
                "SITE_FAVICON_LOGO": "/assets/zkteco_hr/images/DI-logo.svg",
            },
        ),
        (
            "zkteco_hr.utils.sync_adms_assets",
            {"sync_adms_assets": MagicMock(name="sync_adms_assets")},
        ),
    )
    for name, attrs in specs:
        try:
            __import__(name)
            continue  # real module available — use it, never stub over it
        except Exception:
            mod = types.ModuleType(name)
            for a, value in attrs.items():
                setattr(mod, a, value)
            sys.modules[name] = mod


_install_stubs()

from zkteco_hr.utils import publish_assets  # noqa: E402


class TestPublishAssetsAfterMigrate(unittest.TestCase):
    def test_runs_hr_attendance_then_adms_in_order(self):
        order = []
        with patch.object(
            publish_assets,
            "sync_hr_attendance_assets",
            side_effect=lambda: order.append("hr"),
        ) as hr, patch.object(
            publish_assets,
            "sync_adms_assets",
            side_effect=lambda: order.append("adms"),
        ) as adms:
            publish_assets.publish_assets_after_migrate()

        hr.assert_called_once_with()
        adms.assert_called_once_with()
        # hr_attendance also republishes branding; it must go first.
        self.assertEqual(order, ["hr", "adms"])

    def test_step_failure_is_logged_and_does_not_abort_remaining_steps(self):
        with patch.object(
            publish_assets,
            "sync_hr_attendance_assets",
            side_effect=RuntimeError("boom"),
        ) as hr, patch.object(
            publish_assets, "sync_adms_assets"
        ) as adms, patch.object(
            publish_assets.frappe, "log_error"
        ) as log_error:
            # Must NOT raise — a file-copy failure can never abort migrate.
            publish_assets.publish_assets_after_migrate()

        hr.assert_called_once_with()
        adms.assert_called_once_with()  # second step still runs after first fails
        self.assertTrue(log_error.called, "the failing step must be logged")


class TestAfterMigrateHookWiring(unittest.TestCase):
    def test_assets_publish_first_then_fields_and_roles(self):
        from zkteco_hr import hooks

        after_migrate = hooks.after_migrate
        self.assertTrue(
            after_migrate[0].endswith(
                "publish_assets.publish_assets_after_migrate"
            ),
            f"asset publish must run first; got {after_migrate[0]!r}",
        )
        joined = "\n".join(after_migrate)
        self.assertIn("custom_fields.make_custom_fields", joined)
        self.assertIn("dashboard_auth.ensure_adms_roles", joined)


if __name__ == "__main__":
    unittest.main()
