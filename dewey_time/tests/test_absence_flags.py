import unittest
from datetime import date, datetime, time as dt_time
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


class TestAbsenceIntervals(unittest.TestCase):
    def test_missing_expected_leading_gap_35_minutes(self):
        from dewey_time.attendance_engine.absence_intervals import compute_missing_time_intervals

        shift_meta = {
            "start_time": dt_time(9, 0),
            "end_time": dt_time(17, 0),
            "custom_grace_minutes": 15,
            "custom_lunch_start": None,
            "custom_lunch_end": None,
        }
        checkins = [
            {
                "name": "IN-1",
                "time": datetime(2026, 5, 27, 9, 35),
                "custom_device_branch": "BRANCH-A",
            },
            {
                "name": "OUT-1",
                "time": datetime(2026, 5, 27, 17, 0),
                "custom_device_branch": "BRANCH-A",
            },
        ]
        intervals = compute_missing_time_intervals(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=date(2026, 5, 27),
        )
        leading = [i for i in intervals if i.get("kind") == "leading"]
        self.assertTrue(any(i["minutes"] >= 35 for i in leading))

    def test_away_gap_between_segments(self):
        from dewey_time.attendance_engine.absence_intervals import compute_missing_time_intervals

        shift_meta = {
            "start_time": dt_time(9, 0),
            "end_time": dt_time(17, 0),
            "custom_grace_minutes": 0,
            "custom_lunch_start": dt_time(12, 0),
            "custom_lunch_end": dt_time(13, 0),
        }
        checkins = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(2026, 5, 27, 11, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "IN-2", "time": datetime(2026, 5, 27, 14, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-2", "time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]
        intervals = compute_missing_time_intervals(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=date(2026, 5, 27),
        )
        away = [i for i in intervals if i.get("kind") == "away"]
        self.assertTrue(any(i["minutes"] >= 60 for i in away))


class TestOffShiftGate(unittest.TestCase):
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_off_shift_only_off_shift_punch(
        self, get_cached_doc, get_shift, get_checkins, _delete, insert_flag
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = None
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 10, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=True,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertEqual(flag_codes, ["OFF_SHIFT_PUNCH"])


class TestOvernightIntervalDatetimes(unittest.TestCase):
    """Overnight intervals run past minute 1440 and must not crash or wrap.

    `absence_intervals` expresses an overnight shift by adding 1440 to the end
    minute, so a 22:00->06:00 shift produces intervals like {1740, 1800}.
    `_interval_datetimes` used to build `datetime.time(hour=1800 // 60)`, which
    raises `ValueError: hour must be in 0..23` — and because no batch loop in
    closeout.py wraps the per-employee call, one night worker aborted flag
    generation for every employee sorted after them while the device still
    reported healthy. Every closeout test in test_overnight_shifts.py patches
    `evaluate_missing_time_flags` out, so CI could not see it.
    """

    def test_an_interval_past_midnight_rolls_into_the_next_day(self):
        from dewey_time.attendance_engine.absence_flags import _interval_datetimes

        start_dt, end_dt = _interval_datetimes(date(2026, 7, 1), 1740, 1800)
        self.assertEqual(start_dt, datetime(2026, 7, 2, 5, 0))
        self.assertEqual(end_dt, datetime(2026, 7, 2, 6, 0))

    def test_an_interval_crossing_midnight_keeps_both_sides(self):
        from dewey_time.attendance_engine.absence_flags import _interval_datetimes

        start_dt, end_dt = _interval_datetimes(date(2026, 7, 1), 1380, 1470)
        self.assertEqual(start_dt, datetime(2026, 7, 1, 23, 0))
        self.assertEqual(end_dt, datetime(2026, 7, 2, 0, 30))

    def test_a_same_day_interval_is_unchanged(self):
        from dewey_time.attendance_engine.absence_flags import _interval_datetimes

        start_dt, end_dt = _interval_datetimes(date(2026, 7, 1), 540, 660)
        self.assertEqual(start_dt, datetime(2026, 7, 1, 9, 0))
        self.assertEqual(end_dt, datetime(2026, 7, 1, 11, 0))

    def test_the_end_is_not_wrapped_back_onto_the_same_day(self):
        """Guards the tempting wrong fix.

        `combine_date_time` accepts a timedelta but modulos it by 24h, so
        routing minute 1800 through it yields 06:00 on the SAME day — no crash,
        but a flag dated a day early, which is harder to notice than a
        traceback.
        """
        from dewey_time.attendance_engine.absence_flags import _interval_datetimes

        _, end_dt = _interval_datetimes(date(2026, 7, 1), 1740, 1800)
        self.assertNotEqual(end_dt.date(), date(2026, 7, 1))


class TestBatchFailureIsolation(unittest.TestCase):
    """One employee's bad data must not cost everyone else their flags.

    The overnight ValueError above was only catastrophic because no batch loop
    in closeout.py wrapped the per-employee call: the first night worker aborted
    generate_auto_flags_for_device_date, and every employee sorted after them
    got no flags while the Device Closeout Alert still reported the branch
    healthy. Fixing the arithmetic is not enough on its own — the next
    unanticipated failure would do the same thing.
    """

    def test_a_raising_employee_does_not_abort_the_batch(self):
        from dewey_time.attendance_engine import closeout

        processed = []

        def _fake(employee, attendance_date, **kwargs):
            if employee == "EMP-B":
                raise ValueError("hour must be in 0..23")
            processed.append(employee)

        with patch.object(closeout, "_generate_for_employee_date", side_effect=_fake), patch.object(
            closeout.frappe, "get_all", return_value=["EMP-A", "EMP-B", "EMP-C"]
        ), patch.object(closeout.frappe, "log_error") as log_error:
            closeout.generate_auto_flags_for_date(date(2026, 7, 1))

        self.assertEqual(processed, ["EMP-A", "EMP-C"], "employees after the failure must still run")
        self.assertEqual(log_error.call_count, 1, "the failure must reach the Error Log, not vanish")

    def test_the_isolating_runner_reports_failure_rather_than_raising(self):
        from dewey_time.attendance_engine import closeout

        with patch.object(
            closeout, "_generate_for_employee_date", side_effect=RuntimeError("boom")
        ), patch.object(closeout.frappe, "log_error"):
            ok = closeout._generate_for_employee_date_isolated(
                employee="EMP-A", attendance_date=date(2026, 7, 1)
            )
        self.assertFalse(ok)


class TestPresenceCoverage(unittest.TestCase):
    """Absence is measured against presence, not against branch-attributed segments.

    derive_segments only pairs punches inside a same-branch run, so a worked day
    whose OUT punch landed at another site, or whose device had no branch
    mapping, or whose evening punch was forgotten, produced ZERO segments — and
    zero coverage was billed as absence. HR saw seven hours of MISSING_TIME for
    someone who worked all day, on top of the branch flag the same punches
    already raised.
    """

    SHIFT = {
        "start_time": dt_time(9, 0),
        "end_time": dt_time(17, 0),
        "custom_grace_minutes": 0,
        "custom_lunch_start": None,
        "custom_lunch_end": None,
    }

    def _flags(self, checkins, max_end_min=None):
        from dewey_time.attendance_engine.absence_flags import evaluate_missing_time_flags

        return evaluate_missing_time_flags(
            checkins=checkins,
            shift_meta=self.SHIFT,
            attendance_date=date(2026, 7, 1),
            max_end_min=max_end_min,
        )

    @staticmethod
    def _punch(hhmm, branch="B1"):
        # Real datetimes: the suite's frappe mock makes get_datetime the identity
        # function, so a string would never be parsed.
        hh, mm = (int(part) for part in hhmm.split(":"))
        return {"time": datetime(2026, 7, 1, hh, mm), "custom_device_branch": branch}

    def test_a_cross_branch_pair_is_not_billed_as_absence(self):
        flags = self._flags([self._punch("09:00", "B1"), self._punch("17:00", "B2")])
        self.assertEqual(flags, [], "worked 09-17; the branch mismatch has its own flag")

    def test_a_branchless_pair_is_not_billed_as_absence(self):
        flags = self._flags([self._punch("09:00", None), self._punch("17:00", None)])
        self.assertEqual(flags, [], "unknown device branch has its own flag")

    def test_a_forgotten_out_punch_opens_a_session_to_shift_end(self):
        flags = self._flags([self._punch("09:00")])
        self.assertEqual(flags, [], "present since 09:00; the unpaired punch has its own flag")

    def test_an_employee_currently_at_work_is_not_flagged_intraday(self):
        """The 30-minute scheduler used to flag every present employee.

        One IN punch and no OUT yet is the normal state of everyone at work.
        Before the open-session rule this produced a CRITICAL provisional
        MISSING_TIME for the whole elapsed shift, at every tick, every morning.
        """
        flags = self._flags([self._punch("09:00")], max_end_min=11 * 60)
        self.assertEqual(flags, [])

    def test_genuine_absence_still_flags(self):
        """The guard against over-correcting: arriving late is still absence."""
        flags = self._flags([self._punch("10:30"), self._punch("17:00")])
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0][1]["minutes"], 90)
        self.assertEqual(flags[0][1]["kind"], "leading")

    def test_a_real_mid_day_gap_still_flags(self):
        flags = self._flags(
            [self._punch("09:00"), self._punch("12:00"), self._punch("14:00"), self._punch("17:00")]
        )
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0][1]["minutes"], 120)
