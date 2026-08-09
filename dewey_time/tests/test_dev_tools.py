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


class TestRegenerateFlagsForRange(unittest.TestCase):
    """Bulk wipe-and-rebuild, so the queue speaks one language after a change.

    The module-level setup in this file installs real getdate/add_days and
    reloads dev_tools; the shared frappe mock's add_days is a no-op that would
    hang every date loop below.
    """

    def setUp(self):
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["System Manager"]
        # Not optional. frappe is a MagicMock, so without this
        # frappe.form_dict.get("confirm") returns a truthy MagicMock and the
        # confirm gate opens on its own — every unconfirmed-path test would
        # then pass for the wrong reason, or wipe in a test that meant not to.
        # Same line the existing clear_* suites carry (test_clear_employee_
        # schedule.py:22).
        frappe.form_dict = {}
        # Default the delivery-failure guard OFF. The shared mock's
        # frappe.db.exists returns True, so the REAL
        # has_delivery_or_record_failure_today reports a failure for every day
        # and the regenerator correctly skips the whole range — which would
        # make every wipe assertion in this class read zero calls. The two
        # tests that care about the guard patch it themselves.
        guard = patch(
            "dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today",
            return_value=False,
        )
        self.addCleanup(guard.stop)
        guard.start()

    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=7)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_without_confirm_it_previews_and_changes_nothing(self, get_all, _count):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}, {"name": "DI-2"}]

        with patch(
            "dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date"
        ) as delete_flags:
            result = regenerate_flags_for_range_api(
                start_date="2026-05-01", end_date="2026-05-03"
            )

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["employees"], 2)
        self.assertEqual(result["preview"]["days"], 3)
        self.assertEqual(result["preview"]["auto_flags_in_range"], 7)
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_confirmed_it_wipes_and_rebuilds_every_employee_day(
        self, get_all, _count, delete_flags, refresh_intraday, generate_closeout
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}, {"name": "DI-2"}]

        result = regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-02", confirm=True
        )

        # 2 employees x 2 days
        self.assertEqual(delete_flags.call_count, 4)
        self.assertEqual(refresh_intraday.call_count, 4)
        self.assertEqual(generate_closeout.call_count, 4)
        self.assertEqual(result["employees_processed"], 2)
        self.assertEqual(result["days_processed"], 4)

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_the_wipe_is_not_scoped_to_the_intraday_codes(
        self, get_all, _count, delete_flags, _refresh_intraday, _generate_closeout
    ):
        # refresh_intraday deletes only its own provisional rows, scoped to
        # INTRADAY_FLAG_CODES. A rebuild that inherited that scope would leave
        # stale finals behind and the queue would still show two shapes.
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]

        regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-01", confirm=True
        )

        kwargs = delete_flags.call_args.kwargs
        self.assertIsNone(kwargs.get("flag_codes"))
        self.assertIsNone(kwargs.get("day_closed"))

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_mode_intraday_skips_closeout(
        self, get_all, _count, _delete_flags, refresh_intraday, generate_closeout
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]

        regenerate_flags_for_range_api(
            start_date="2026-05-01",
            end_date="2026-05-01",
            confirm=True,
            mode="intraday",
        )

        refresh_intraday.assert_called_once()
        generate_closeout.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_a_non_system_manager_is_refused_before_anything_is_read(
        self, get_all, delete_flags
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        frappe.get_roles.return_value = ["HR User"]

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-05-01", end_date="2026-05-02", confirm=True
            )

        # The gate runs before employees are enumerated, so a refused call
        # cannot even read, let alone delete.
        get_all.assert_not_called()
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    def test_an_over_long_range_is_refused(self, delete_flags):
        from dewey_time.attendance_engine.dev_tools import (
            MAX_BULK_RANGE_DAYS,
            regenerate_flags_for_range_api,
        )

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-01-01",
                end_date=str(date(2026, 1, 1) + timedelta(days=MAX_BULK_RANGE_DAYS)),
                confirm=True,
            )
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    def test_an_unknown_mode_is_refused(self, delete_flags):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-05-01",
                end_date="2026-05-01",
                confirm=True,
                mode="sideways",
            )
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_a_day_whose_punches_never_arrived_is_left_alone(
        self, get_all, _count, delete_flags, refresh_intraday, generate_closeout, failed
    ):
        # DELIVERY_FAILED is source=AUTO but comes only from the device-closeout
        # webhook -- nothing here can recompute it. Wiping it makes
        # has_delivery_or_record_failure_today read "no failure", and the rebuild
        # then raises UNNOTIFIED_ABSENCE against someone whose device simply
        # never delivered. The tool must not manufacture that accusation.
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]
        failed.side_effect = lambda _employee, day: day == date(2026, 5, 2)

        result = regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-03", confirm=True
        )

        wiped = [c.kwargs["attendance_date"] for c in delete_flags.call_args_list]
        self.assertEqual(wiped, [date(2026, 5, 1), date(2026, 5, 3)])
        self.assertNotIn(date(2026, 5, 2), wiped)
        self.assertEqual(result["days_processed"], 2)
        self.assertEqual(result["days_protected_by_delivery_failure"], 1)

    @patch("dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_the_protection_check_runs_before_the_wipe_not_after(
        self, get_all, _count, delete_flags, _refresh, _generate, failed
    ):
        # Order is the whole point: checked after the delete, the marker is
        # already gone and the check always reports "no failure".
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]
        order = []
        failed.side_effect = lambda _e, _d: order.append("check") or False
        delete_flags.side_effect = lambda **_kw: order.append("delete")

        regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-01", confirm=True
        )

        self.assertEqual(order, ["check", "delete"])


if __name__ == "__main__":
    unittest.main()
