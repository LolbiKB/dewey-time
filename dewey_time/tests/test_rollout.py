import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


def _settings(testing_start=None, go_live=None, rows=()):
    return SimpleNamespace(
        rollout_testing_start=testing_start,
        rollout_go_live=go_live,
        branch_rollout=list(rows),
    )


def _row(branch, testing_start, go_live=None):
    return SimpleNamespace(branch=branch, testing_start=testing_start, go_live=go_live)


class TestPhaseFor(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import rollout

        self.rollout = rollout

    def _phase(self, settings, branch, day):
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            return self.rollout.phase_for(branch=branch, attendance_date=day)

    def test_no_dates_anywhere_is_live(self):
        # The upgrade default. A migration that silently stopped the engine would be
        # far worse than one that changes nothing until an admin sets a date.
        self.assertEqual(
            self._phase(_settings(), None, date(2020, 1, 1)), self.rollout.LIVE
        )

    def test_an_unconfigured_settings_mock_is_live_not_prelaunch(self):
        # The trap this module's isinstance guard exists for: a MagicMock attribute is
        # truthy AND its __lt__ returns truthy, so without the guard every day in every
        # engine test would read PRELAUNCH.
        from unittest.mock import MagicMock

        self.assertEqual(
            self._phase(MagicMock(), "BR-A", date(2026, 8, 20)), self.rollout.LIVE
        )

    def test_before_the_global_cutoff_is_prelaunch(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 14)), self.rollout.PRELAUNCH
        )

    def test_the_cutoff_day_itself_is_testing(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 15)), self.rollout.TESTING
        )

    def test_the_go_live_day_itself_is_live(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        self.assertEqual(
            self._phase(settings, None, date(2026, 9, 1)), self.rollout.LIVE
        )

    def test_a_blank_go_live_leaves_the_pilot_open(self):
        settings = _settings(testing_start=date(2026, 8, 15))
        self.assertEqual(
            self._phase(settings, None, date(2030, 1, 1)), self.rollout.TESTING
        )

    def test_equal_dates_mean_no_pilot_window(self):
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 8, 15))
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 14)), self.rollout.PRELAUNCH
        )
        self.assertEqual(
            self._phase(settings, None, date(2026, 8, 15)), self.rollout.LIVE
        )

    def test_a_branch_row_overrides_the_global_pair(self):
        settings = _settings(
            testing_start=date(2026, 8, 15),
            go_live=date(2026, 9, 1),
            rows=[_row("BR-LATE", date(2026, 10, 1), date(2026, 11, 1))],
        )
        self.assertEqual(
            self._phase(settings, "BR-LATE", date(2026, 9, 15)), self.rollout.PRELAUNCH
        )
        self.assertEqual(
            self._phase(settings, "BR-OTHER", date(2026, 9, 15)), self.rollout.LIVE
        )

    def test_a_branch_row_is_used_whole_and_does_not_inherit_go_live(self):
        # A blank go_live on a row means "the pilot is still open for this branch",
        # NOT "fall back to the global go_live". Partial inheritance would make a
        # blank field mean two different things depending on the global config.
        settings = _settings(
            testing_start=date(2026, 8, 15),
            go_live=date(2026, 9, 1),
            rows=[_row("BR-OPEN", date(2026, 8, 15))],
        )
        self.assertEqual(
            self._phase(settings, "BR-OPEN", date(2026, 9, 15)), self.rollout.TESTING
        )

    def test_a_falsy_branch_resolves_to_the_global_pair(self):
        # hr_calendar.py:779 records that a great many employees have no branch set,
        # so this is the primary path, not an edge case.
        settings = _settings(
            testing_start=date(2026, 8, 15),
            rows=[_row("BR-A", date(2026, 10, 1))],
        )
        self.assertEqual(
            self._phase(settings, None, date(2026, 9, 1)), self.rollout.TESTING
        )
        self.assertEqual(
            self._phase(settings, "", date(2026, 9, 1)), self.rollout.TESTING
        )

    def test_string_dates_compare_correctly(self):
        # Frappe hands dates back as datetime.date from a doc field but as str from a
        # client payload; comparing the two raises rather than answering.
        settings = _settings(testing_start="2026-08-15", go_live="2026-09-01")
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            with patch.object(self.rollout, "getdate", side_effect=_real_getdate):
                self.assertEqual(
                    self.rollout.phase_for(branch=None, attendance_date="2026-08-20"),
                    self.rollout.TESTING,
                )

    def test_a_missing_attendance_date_raises(self):
        # A missing attendance_date is a caller bug with no correct answer.
        # getdate(None) resolves to today on a real bench, so silently accepting it
        # would derive the phase from "now" -- the exact failure this module exists
        # to prevent. Returning LIVE would be a guess that hides the bug instead.
        settings = _settings(testing_start=date(2026, 8, 15), go_live=date(2026, 9, 1))
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            with self.assertRaises(ValueError):
                self.rollout.phase_for(branch=None, attendance_date=None)

    def test_unset_dates_are_live_with_frappe_faithful_getdate(self):
        # test_no_dates_anywhere_is_live above passes even with the isinstance guard
        # in _as_date deleted, because the mock's getdate is identity and None stays
        # None. This test uses a Frappe-faithful getdate instead, where a falsy
        # value resolves to today: without the guard, an unset rollout_testing_start
        # would read as "testing starts today" -- the exact inverse of LIVE.
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=_settings()):
            with patch.object(self.rollout, "getdate", side_effect=_real_getdate):
                self.assertEqual(
                    self.rollout.phase_for(branch=None, attendance_date=date(2020, 1, 1)),
                    self.rollout.LIVE,
                )


class TestBranchForEmployee(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import rollout

        self.rollout = rollout

    def test_branch_for_employee_reads_the_employee_branch_field(self):
        with patch.object(
            self.rollout.frappe, "get_cached_value", return_value="BR-A"
        ) as mock_get_cached_value:
            result = self.rollout.branch_for_employee("EMP-0001")
        mock_get_cached_value.assert_called_once_with("Employee", "EMP-0001", "branch")
        self.assertEqual(result, "BR-A")

    def test_phase_for_employee_routes_the_employees_branch_into_the_lookup(self):
        # A stamp path and a refusal path that read the employee's branch through two
        # different code paths could disagree. Proving phase_for_employee actually
        # uses what branch_for_employee returns -- not the global pair regardless --
        # is what keeps them from being able to.
        settings = _settings(
            testing_start=date(2026, 8, 15),
            go_live=date(2026, 9, 1),
            rows=[_row("BR-LATE", date(2026, 10, 1), date(2026, 11, 1))],
        )
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            with patch.object(
                self.rollout.frappe, "get_cached_value", return_value="BR-LATE"
            ):
                self.assertEqual(
                    self.rollout.phase_for_employee(
                        employee="EMP-0002", attendance_date=date(2026, 9, 15)
                    ),
                    self.rollout.PRELAUNCH,
                )
            with patch.object(
                self.rollout.frappe, "get_cached_value", return_value=None
            ):
                self.assertEqual(
                    self.rollout.phase_for_employee(
                        employee="EMP-0002", attendance_date=date(2026, 9, 15)
                    ),
                    self.rollout.LIVE,
                )


class TestPhasesConfigured(unittest.TestCase):
    def setUp(self):
        from dewey_time.attendance_engine import rollout

        self.rollout = rollout

    def _configured(self, settings):
        with patch.object(self.rollout.frappe, "get_cached_doc", return_value=settings):
            return self.rollout.phases_configured()

    def test_nothing_set_is_not_configured(self):
        self.assertFalse(self._configured(_settings()))

    def test_a_global_start_is_configured(self):
        self.assertTrue(self._configured(_settings(testing_start=date(2026, 8, 15))))

    def test_a_branch_row_alone_is_configured(self):
        self.assertTrue(
            self._configured(_settings(rows=[_row("BR-A", date(2026, 8, 15))]))
        )


def _real_getdate(value):
    """The mock's getdate is identity, which cannot turn "2026-08-15" into a date,
    nor turn a falsy value into today. Real frappe.utils.getdate does both; this
    stand-in is needed by the string-dates test and by the production-semantics
    test for an unset rollout date."""
    from datetime import datetime

    if not value:
        return date.today()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
