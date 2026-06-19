"""Access-control tests for the get_my_week Desk read API.

get_my_week returns an employee's raw punches and flags, so it must enforce the
same access rule as the rest of the read API: HR staff see anyone, everyone else
sees only the Employee record linked to their own user. The allow/deny logic of
_require_calendar_access is covered in test_hr_calendar; here we verify that
get_my_week actually routes through that guard before returning any data.
"""

from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.attendance_engine import api as mod  # noqa: E402


def _getdate(value):
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


class TestGetMyWeekAccess(unittest.TestCase):
    def test_denied_access_aborts_before_returning_data(self):
        with patch.object(
            mod, "_require_calendar_access", side_effect=PermissionError("denied")
        ) as guard, patch.object(mod.frappe, "get_all", return_value=[]):
            with self.assertRaises(PermissionError):
                mod.get_my_week("EMP-999", "2026-06-01", "2026-06-02")
        guard.assert_called_once_with("EMP-999")

    @patch("zkteco_hr.attendance_engine.api.getdate", _getdate)
    @patch.object(mod, "_require_calendar_access", return_value=None)
    @patch.object(mod.frappe, "get_all", return_value=[])
    def test_allowed_access_returns_week(self, _get_all, guard):
        out = mod.get_my_week("EMP-001", "2026-06-01", "2026-06-01")
        self.assertEqual(out["employee"], "EMP-001")
        self.assertEqual(len(out["days"]), 1)
        guard.assert_called_once_with("EMP-001")


if __name__ == "__main__":
    unittest.main()
