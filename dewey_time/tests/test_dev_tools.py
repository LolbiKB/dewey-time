import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, call, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()

import sys  # noqa: E402
import frappe  # noqa: E402


def _getdate(value):
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    return value


def _add_days(value, days):
    return _getdate(value) + timedelta(days=days)


frappe.utils.getdate = _getdate
frappe.utils.add_days = _add_days
sys.modules["frappe.utils"].getdate = _getdate
sys.modules["frappe.utils"].add_days = _add_days

frappe.get_roles = MagicMock(return_value=["HR User"])
frappe.session.user = "hr@example.com"
frappe.db.exists = MagicMock(return_value=True)
frappe.db.commit = MagicMock()

# dev_tools binds getdate/add_days at import time — reload after fixing mocks.
for mod_name in list(sys.modules):
    if mod_name.startswith("dewey_time.attendance_engine.dev_tools"):
        del sys.modules[mod_name]


class TestRunEngineForEmployee(unittest.TestCase):
    def setUp(self):
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        frappe.db.exists.return_value = True

    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_mode_intraday_calls_intraday_only(self, refresh_intraday, generate_closeout, get_all):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        get_all.return_value = [
            {"attendance_date": date(2026, 5, 17), "flag_code": "LATE_START"},
        ]

        result = run_engine_for_employee(
            employee="DI-1138",
            start_date="2026-05-17",
            end_date="2026-05-17",
            mode="intraday",
        )

        refresh_intraday.assert_called_once_with("DI-1138", date(2026, 5, 17))
        generate_closeout.assert_not_called()
        frappe.db.commit.assert_called_once()
        self.assertEqual(result["mode"], "intraday")
        self.assertEqual(result["days_processed"], 1)
        self.assertEqual(result["flags_after"], 1)
        self.assertEqual(result["days"][0]["flag_codes"], ["LATE_START"])

    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all", return_value=[])
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_mode_closeout_calls_closeout_with_unnotified_absence(
        self, refresh_intraday, generate_closeout, _get_all
    ):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        run_engine_for_employee(
            employee="DI-1138",
            start_date="2026-05-18",
            end_date="2026-05-18",
            mode="closeout",
        )

        refresh_intraday.assert_not_called()
        generate_closeout.assert_called_once_with(
            employee="DI-1138",
            attendance_date=date(2026, 5, 18),
            include_unnotified_absence=True,
        )

    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all", return_value=[])
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_mode_both_calls_intraday_then_closeout_per_day(
        self, refresh_intraday, generate_closeout, _get_all
    ):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        run_engine_for_employee(
            employee="DI-1138",
            start_date="2026-05-16",
            end_date="2026-05-17",
            mode="both",
        )

        self.assertEqual(
            refresh_intraday.call_args_list,
            [
                call("DI-1138", date(2026, 5, 16)),
                call("DI-1138", date(2026, 5, 17)),
            ],
        )
        self.assertEqual(
            generate_closeout.call_args_list,
            [
                call(
                    employee="DI-1138",
                    attendance_date=date(2026, 5, 16),
                    include_unnotified_absence=True,
                ),
                call(
                    employee="DI-1138",
                    attendance_date=date(2026, 5, 17),
                    include_unnotified_absence=True,
                ),
            ],
        )

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_range_over_31_days_throws(self, _refresh, _generate):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        with self.assertRaises(Exception) as ctx:
            run_engine_for_employee(
                employee="DI-1138",
                start_date="2026-05-01",
                end_date="2026-06-01",
                mode="both",
            )
        self.assertIn("31", str(ctx.exception))

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_invalid_mode_throws(self, _refresh, _generate):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        with self.assertRaises(Exception) as ctx:
            run_engine_for_employee(
                employee="DI-1138",
                start_date="2026-05-16",
                end_date="2026-05-16",
                mode="invalid",
            )
        self.assertIn("mode", str(ctx.exception).lower())

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_guest_user_not_permitted(self, _refresh, _generate):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        frappe.session.user = "Guest"
        frappe.get_roles.return_value = []

        with self.assertRaises(Exception) as ctx:
            run_engine_for_employee(
                employee="DI-1138",
                start_date="2026-05-16",
                end_date="2026-05-16",
                mode="both",
            )
        self.assertIn("Not permitted", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
