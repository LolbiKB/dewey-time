import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, call, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()

import sys  # noqa: E402
import frappe  # noqa: E402


# A settable "today". frappe's getdate() with no argument means today, and the
# regenerators now ask it whether a day is over. Pinning it keeps every fixture
# date below unambiguously in the past no matter when the suite runs; the tests
# that exercise the today boundary move it deliberately.
_TODAY = [date(2026, 6, 1)]


def _getdate(value=None):
    if value is None:
        return _TODAY[0]
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


def _pin_dev_tools_clock(test_case):
    """Pin dev_tools' date helpers per test, not once at module scope.

    dev_tools binds getdate/add_days at import, and that import happens lazily
    inside each test below — by which time another module in a full-suite run
    has replaced frappe.utils.getdate with its own single-argument stub
    (test_flag_decision_api.py:18 and test_api.py:50 both do). That went
    unnoticed while nothing here needed today: every call passed a value, so
    any stub would do. It stopped being harmless the moment dev_tools started
    calling getdate() with no argument to ask what day it is — in the module's
    own lane the tests passed, and in the full suite fifteen of them errored.
    """
    import dewey_time.attendance_engine.dev_tools as dev_tools

    for name, replacement in (("getdate", _getdate), ("add_days", _add_days)):
        pinned = patch.object(dev_tools, name, replacement)
        test_case.addCleanup(pinned.stop)
        pinned.start()


class TestRunEngineForEmployee(unittest.TestCase):
    def setUp(self):
        _pin_dev_tools_clock(self)
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        frappe.db.exists.return_value = True
        # Default the delivery-failure guard OFF, exactly as the bulk suite
        # does. frappe.db.exists must stay True for the Employee lookup above,
        # which makes the REAL has_delivery_or_record_failure_today report a
        # failure for every day -- the tool would then correctly skip the whole
        # range and every assertion below would read zero calls. The tests that
        # care about the guard patch it themselves.
        guard = patch(
            "dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today",
            return_value=False,
        )
        self.addCleanup(guard.stop)
        guard.start()

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
        _pin_dev_tools_clock(self)
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


class TestRegeneratorsRefuseToConfirmAnUnfinishedDay(unittest.TestCase):
    """A day that has not ended has nothing for closeout to confirm.

    Closeout writes day_closed=1 UNNOTIFIED_ABSENCE at rank 150, copy reading
    "Confirmed at end-of-day device closeout". Run it over today and everyone
    who has not badged yet is accused at the top of the queue -- and because
    the provisional and confirmed rows share a flag identity, the read path's
    dedup prefers the confirmed one, so the correcting row cannot win. It
    stands until that evening's real closeout rebuilds the day.

    "Regenerate everything up to now" is the tool's most natural invocation,
    which is what makes this worth pinning rather than documenting.
    """

    def setUp(self):
        _pin_dev_tools_clock(self)
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["System Manager"]
        frappe.form_dict = {}
        # See TestRegenerateFlagsForRange.setUp: the shared mock's
        # frappe.db.exists is truthy, so the real guard would skip every day.
        guard = patch(
            "dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today",
            return_value=False,
        )
        self.addCleanup(guard.stop)
        guard.start()
        # 2026-05-02 is "today" for this class; 05-01 is over, 05-02 is not.
        previous = _TODAY[0]
        _TODAY[0] = date(2026, 5, 2)
        self.addCleanup(lambda: _TODAY.__setitem__(0, previous))

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_bulk_closes_out_yesterday_but_not_today(
        self, get_all, _count, _delete, refresh_intraday, generate_closeout
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]

        result = regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-02", confirm=True, mode="both"
        )

        closed_out = [c.kwargs["attendance_date"] for c in generate_closeout.call_args_list]
        self.assertEqual(closed_out, [date(2026, 5, 1)])
        self.assertNotIn(date(2026, 5, 2), closed_out)
        # Today still gets its intraday pass -- the provisional row is exactly
        # what should be speaking for an unfinished day.
        self.assertEqual(
            [c.args[1] for c in refresh_intraday.call_args_list],
            [date(2026, 5, 1), date(2026, 5, 2)],
        )
        self.assertEqual(result["closeout_days_deferred_until_the_day_ends"], 1)

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_closeout_mode_over_today_does_not_wipe_what_it_will_not_rebuild(
        self, get_all, _count, delete_flags, _refresh, generate_closeout
    ):
        # The delete is unscoped. Withholding only the rebuild would leave the
        # day stripped of every flag with nothing to put them back -- strictly
        # worse than doing nothing.
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]

        result = regenerate_flags_for_range_api(
            start_date="2026-05-02", end_date="2026-05-02", confirm=True, mode="closeout"
        )

        delete_flags.assert_not_called()
        generate_closeout.assert_not_called()
        self.assertEqual(result["days_processed"], 0)
        self.assertEqual(result["closeout_days_deferred_until_the_day_ends"], 1)

    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_a_range_running_past_today_is_refused(
        self, get_all, _count, _refresh, generate_closeout
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}]

        with self.assertRaises(Exception):
            regenerate_flags_for_range_api(
                start_date="2026-05-01", end_date="2026-05-09", confirm=True
            )
        generate_closeout.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_the_per_employee_tool_defers_today_too(
        self, refresh_intraday, generate_closeout, get_all
    ):
        # It shares the exposure and predates the bulk tool; the reviewer found
        # it hardened on one side only.
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        frappe.get_roles.return_value = ["HR User"]
        get_all.return_value = []

        result = run_engine_for_employee(
            employee="DI-1138",
            start_date="2026-05-01",
            end_date="2026-05-02",
            mode="both",
        )

        self.assertEqual(
            [c.kwargs["attendance_date"] for c in generate_closeout.call_args_list],
            [date(2026, 5, 1)],
        )
        self.assertEqual(result["closeout_days_deferred_until_the_day_ends"], 1)

    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_the_per_employee_tool_refuses_a_range_past_today(
        self, _refresh, generate_closeout, get_all
    ):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        frappe.get_roles.return_value = ["HR User"]
        get_all.return_value = []

        with self.assertRaises(Exception):
            run_engine_for_employee(
                employee="DI-1138",
                start_date="2026-05-01",
                end_date="2026-05-09",
                mode="both",
            )
        generate_closeout.assert_not_called()


class TestPerEmployeeToolProtectsUndeliveredDays(unittest.TestCase):
    """The guard 8995bfec put on the bulk tool, on the tool 250 lines above it.

    _generate_for_employee_date's deletes are unscoped, and DELIVERY_FAILED can
    only be rebuilt from the device-closeout webhook's undelivered_items. One
    run erases the marker; a second reads "no failure" and manufactures the
    no-show the marker existed to prevent. Spot-checks get re-run.
    """

    def setUp(self):
        _pin_dev_tools_clock(self)
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        frappe.db.exists.return_value = True

    @patch("dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_a_marker_day_is_skipped_entirely(
        self, refresh_intraday, generate_closeout, get_all, failed
    ):
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        get_all.return_value = []
        failed.side_effect = lambda _employee, day: day == date(2026, 5, 2)

        result = run_engine_for_employee(
            employee="DI-1138",
            start_date="2026-05-01",
            end_date="2026-05-03",
            mode="both",
        )

        touched = [c.kwargs["attendance_date"] for c in generate_closeout.call_args_list]
        self.assertEqual(touched, [date(2026, 5, 1), date(2026, 5, 3)])
        self.assertNotIn(date(2026, 5, 2), touched)
        self.assertEqual(
            [c.args[1] for c in refresh_intraday.call_args_list],
            [date(2026, 5, 1), date(2026, 5, 3)],
        )
        self.assertEqual(result["days_processed"], 2)
        self.assertEqual(result["days_protected_by_delivery_failure"], 1)

    @patch("dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    def test_the_check_runs_before_the_engine_not_after(
        self, _refresh, generate_closeout, get_all, failed
    ):
        # Checked after, the marker is already gone and the answer is always
        # "no failure" -- the check would pass and protect nothing.
        from dewey_time.attendance_engine.dev_tools import run_engine_for_employee

        get_all.return_value = []
        order = []
        failed.side_effect = lambda _e, _d: order.append("check") or False
        generate_closeout.side_effect = lambda **_kw: order.append("generate")

        run_engine_for_employee(
            employee="DI-1138",
            start_date="2026-05-01",
            end_date="2026-05-01",
            mode="closeout",
        )

        self.assertEqual(order, ["check", "generate"])


class TestBulkSweepSurvivesOneBadEmployeeDay(unittest.TestCase):
    """One employee's data must never abort the sweep.

    _generate_for_employee_date_isolated exists because an overnight interval
    running past minute 1440 raised inside evaluate_missing_time_flags and
    starved every employee sorted after the night worker. A quarter of every
    active employee is the likeliest place to meet such data again, and a
    half-finished sweep leaves precisely the two-shapes artifact this tool
    exists to remove.
    """

    def setUp(self):
        _pin_dev_tools_clock(self)
        frappe.db.commit.reset_mock()
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["System Manager"]
        frappe.form_dict = {}
        guard = patch(
            "dewey_time.attendance_engine.dev_tools.has_delivery_or_record_failure_today",
            return_value=False,
        )
        self.addCleanup(guard.stop)
        guard.start()

    @patch("dewey_time.attendance_engine.dev_tools.frappe.log_error")
    @patch("dewey_time.attendance_engine.dev_tools._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.refresh_intraday_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.dev_tools.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.dev_tools.frappe.get_all")
    def test_a_raise_on_one_day_does_not_stop_the_rest(
        self, get_all, _count, _delete, _refresh, generate_closeout, log_error
    ):
        from dewey_time.attendance_engine.dev_tools import (
            regenerate_flags_for_range_api,
        )

        get_all.return_value = [{"name": "DI-1"}, {"name": "DI-2"}]

        def blow_up_on_one_day(**kwargs):
            if kwargs["employee"] == "DI-1" and kwargs["attendance_date"] == date(2026, 5, 2):
                raise ValueError("interval ends past minute 1440")

        generate_closeout.side_effect = blow_up_on_one_day

        result = regenerate_flags_for_range_api(
            start_date="2026-05-01", end_date="2026-05-03", confirm=True
        )

        # 2 employees x 3 days = 6; one raised.
        self.assertEqual(result["days_processed"], 5)
        self.assertEqual(result["days_failed"], 1)
        # DI-2's whole range still ran -- the point of the isolation.
        self.assertEqual(
            [
                c.kwargs["attendance_date"]
                for c in generate_closeout.call_args_list
                if c.kwargs["employee"] == "DI-2"
            ],
            [date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3)],
        )
        log_error.assert_called_once()


if __name__ == "__main__":
    unittest.main()
