import json
import os
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


# Resolved from __file__, never the CWD — bench run-tests runs from the bench
# directory, not this repo, so a repo-relative path silently fails to open
# there. Same idiom as test_flag_decision_doctype.py:91-106.
_DOCTYPE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dewey_time", "doctype")
)


def _load_doctype_json(doctype_folder, filename):
    with open(os.path.join(_DOCTYPE_DIR, doctype_folder, filename)) as fh:
        return json.load(fh)


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


class TestSettingsValidation(unittest.TestCase):
    """The controller is directly testable because frappe.model.document.Document is a
    REAL class in this suite's mock (test_closeout.py:78-88), whose __init__ copies
    kwargs onto __dict__. Construct with every field the validator reads."""

    def _doc(self, testing_start=None, go_live=None, rows=()):
        from dewey_time.dewey_time.doctype.dewey_time_settings.dewey_time_settings import (
            DeweyTimeSettings,
        )

        return DeweyTimeSettings(
            rollout_testing_start=testing_start,
            rollout_go_live=go_live,
            branch_rollout=list(rows),
        )

    def test_a_valid_config_passes(self):
        self._doc(date(2026, 8, 15), date(2026, 9, 1)).validate()

    def test_an_empty_config_passes(self):
        self._doc().validate()

    def test_a_go_live_without_a_testing_start_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(None, date(2026, 9, 1)).validate()
        self.assertIn("testing start date", str(caught.exception))

    def test_a_reversed_global_pair_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(date(2026, 9, 1), date(2026, 8, 15)).validate()
        self.assertIn("global", str(caught.exception))

    def test_a_reversed_branch_pair_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(rows=[_row("BR-A", date(2026, 9, 1), date(2026, 8, 15))]).validate()
        self.assertIn("BR-A", str(caught.exception))

    def test_a_duplicate_branch_row_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            self._doc(
                rows=[
                    _row("BR-A", date(2026, 8, 15)),
                    _row("BR-A", date(2026, 9, 1)),
                ]
            ).validate()
        self.assertIn("twice", str(caught.exception))

    def test_a_branch_row_with_a_blank_go_live_passes(self):
        self._doc(rows=[_row("BR-A", date(2026, 8, 15))]).validate()

    def test_equal_dates_pass_at_both_scopes(self):
        # A branch that should skip the pilot sets testing_start == go_live. This
        # rests entirely on the `>` in _throw_if_reversed: flipping it to `>=`
        # would make the escape hatch unsavable while every other test here stays
        # green. Mirrors TestPhaseFor.test_equal_dates_mean_no_pilot_window, which
        # pins the same boundary on the read side.
        self._doc(date(2026, 8, 15), date(2026, 8, 15)).validate()
        self._doc(
            rows=[_row("BR-A", date(2026, 8, 15), date(2026, 8, 15))]
        ).validate()

    def test_a_reversed_pair_is_rejected_with_string_dates(self):
        # The mock's getdate is identity, and every other test here passes
        # datetime.date objects -- so deleting the getdate() calls in
        # _throw_if_reversed would leave every other test green. On a real bench
        # a Single's values come back from tabSingles as strings, and
        # "2026-09-01" > "2026-08-15" happening to sort correctly as raw strings
        # is luck, not design: an unpadded day breaks that luck (raw string
        # "2026-08-10" < "2026-08-9", but the real dates are reversed), so this
        # only passes if getdate() actually runs.
        from dewey_time.dewey_time.doctype.dewey_time_settings import (
            dewey_time_settings as settings_module,
        )

        with patch.object(settings_module, "getdate", side_effect=_real_getdate):
            with self.assertRaises(Exception) as caught:
                self._doc("2026-08-10", "2026-08-9").validate()
        self.assertIn("global", str(caught.exception))

    def test_two_blank_branch_rows_do_not_raise_duplicate(self):
        # Frappe runs validate() before the reqd mandatory check, so a blank
        # branch reaching the duplicate check would surface a confusing "Branch
        # None appears twice" instead of letting reqd report "Branch is
        # required".
        self._doc(
            rows=[
                _row(None, date(2026, 8, 15)),
                _row(None, date(2026, 9, 1)),
            ]
        ).validate()


class TestAttendanceFlagRolloutPhaseField(unittest.TestCase):
    """The Select options and this module's constants have to be the same two
    strings, and nothing else in the app checks.

    If they drift, Frappe's Select validation rejects EVERY AUTO flag insert on
    a real bench, closeout._insert_flags' bare `except Exception` logs it and
    moves on, and the engine goes silently flag-free. CI cannot catch it: CI
    runs `run-tests --app dewey_time`, under which the one module that touches a
    real bench (test_integration_pilot_matrix) self-skips by design. Two
    assertions against the JSON on disk are the whole defence.
    """

    def setUp(self):
        from dewey_time.attendance_engine import rollout

        self.rollout = rollout
        self.doctype_json = _load_doctype_json("attendance_flag", "attendance_flag.json")

    def test_rollout_phase_is_in_field_order(self):
        # A field absent from field_order is not imported onto the DocType at
        # all, so the column never appears and every insert naming it fails.
        self.assertIn("rollout_phase", self.doctype_json["field_order"])

    def test_the_select_options_are_exactly_the_two_phases_a_flag_can_carry(self):
        # The leading "" is the blank option, and it is required rather than
        # incidental: every row written before this feature has a blank
        # rollout_phase, read as LIVE. PRELAUNCH is deliberately absent -- the
        # engine's guards refuse to write one, and offering the value would
        # invite a row that contradicts them.
        options = {
            field["options"]
            for field in self.doctype_json["fields"]
            if field["fieldname"] == "rollout_phase"
        }.pop()
        self.assertEqual(
            set(options.split("\n")),
            {"", self.rollout.TESTING, self.rollout.LIVE},
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
