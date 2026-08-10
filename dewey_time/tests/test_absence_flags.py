import pathlib
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
    # should_skip_absence_flags is stubbed because 4edfbdda hoisted it to the
    # top of _generate_for_employee_date -- above the deletes, so its answer
    # cannot be read from evidence those deletes have already destroyed. It now
    # runs on every path including this one, where it was previously
    # unreachable behind the on-shift branch, and it reads two Attendance Flag
    # queries this test has no opinion about. The read-before-delete ordering
    # it exists for is pinned in test_closeout.py, not here.
    @patch("dewey_time.attendance_engine.closeout.should_skip_absence_flags", return_value=False)
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_off_shift_only_off_shift_punch(
        self, get_cached_doc, get_shift, get_checkins, _delete, insert_flag, _skip_absence
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


class TestCompanyFallbackSchedule(unittest.TestCase):
    """The company fallback closeout had two independent reasons never to run.

    It gates on each company's local hour being 03:00, but hooks.py registered
    it under scheduler_events["daily"], which Frappe fires once around site
    midnight — so the gate could essentially never match. And it computed the
    local hour by calling .astimezone() on now_datetime(), which is NAIVE
    site-local: Python then assumes the container's zone and converts a second
    time, skewing the hour by the container/site offset.
    """

    def test_the_job_is_registered_hourly_so_its_gate_can_match(self):
        # resolve from this file, not the CWD: bench run-tests runs from the
        # bench directory, where a repo-relative path does not exist
        hooks = (pathlib.Path(__file__).resolve().parents[1] / "hooks.py").read_text()
        job = "closeout.run_company_fallback_closeout"
        self.assertIn(job, hooks)
        hourly = hooks.split('"hourly"', 1)
        self.assertEqual(len(hourly), 2, "expected an hourly scheduler bucket")
        # the job must appear inside the hourly list, before the next bucket
        after = hourly[1].split("]", 1)[0]
        self.assertIn(job, after, "the fallback must be hourly, not daily")

    def test_local_now_is_not_double_converted(self):
        from zoneinfo import ZoneInfo

        from dewey_time.attendance_engine import closeout

        site = ZoneInfo("Africa/Nairobi")   # UTC+3, no DST
        target = ZoneInfo("Africa/Nairobi")
        naive_site_local = datetime(2026, 7, 1, 3, 30)

        with patch.object(closeout, "now_datetime", return_value=naive_site_local), patch.object(
            closeout, "_site_timezone", return_value=site
        ):
            local = closeout._company_local_now(target)

        self.assertEqual(local.hour, 3, "same zone in and out must not shift the hour")


# TestAutoFlagIdentity lived here. It pinned AttendanceFlag.before_insert's
# deterministic AUTO naming, deleted with the custom:1 fix (T3-11) -- so it was
# deleted with the behaviour it tested, not because it failed.
#
# It is worth remembering how it read while it was here. It did
# `AttendanceFlag.__new__(AttendanceFlag)` and called `before_insert()`
# directly, bypassing Frappe entirely, and passed for months against a
# controller Frappe never loaded. That is what a green test over inert code
# looks like from the inside.
#
# Identity now has one owner: flag_identity, tested in test_flag_identity.py.


class TestUnattendedLunchBridging(unittest.TestCase):
    """A lunch nobody was there to take must not split one absence into two.

    Shift times are dt_time, never datetime: shift_time_to_minutes parses a
    datetime by falling through to string splitting and returns None, after
    which every case yields zero intervals and these tests pass vacuously.
    """

    SHIFT = {
        "start_time": dt_time(8, 0),
        "end_time": dt_time(17, 0),
        "custom_grace_minutes": 0,
        "custom_lunch_start": dt_time(12, 0),
        "custom_lunch_end": dt_time(13, 0),
    }
    DAY = date(2026, 5, 28)

    def _intervals(self, checkins):
        from dewey_time.attendance_engine.absence_intervals import (
            compute_missing_time_intervals,
        )

        return compute_missing_time_intervals(
            checkins=checkins, shift_meta=self.SHIFT, attendance_date=self.DAY
        )

    def _punch(self, hour, minute):
        return {
            "name": f"P-{hour:02d}{minute:02d}",
            "time": datetime(2026, 5, 28, hour, minute),
            "custom_device_branch": "BRANCH-A",
        }

    def test_stray_punch_day_is_one_absence_not_two(self):
        # Badged in and straight out again at 08:05, then nothing. Before this
        # change: 08:05-12:00 and 13:00-17:00, two findings for one absence.
        intervals = self._intervals([self._punch(8, 0), self._punch(8, 5)])

        self.assertEqual(len(intervals), 1, f"expected one absence, got {intervals}")
        self.assertEqual(intervals[0]["startMin"], 8 * 60 + 5)
        self.assertEqual(intervals[0]["endMin"], 17 * 60)

    def test_bridged_minutes_exclude_the_unpaid_lunch(self):
        # 235 + 240, NOT the 535-minute span. The lunch hour is not owed.
        intervals = self._intervals([self._punch(8, 0), self._punch(8, 5)])

        self.assertEqual(intervals[0]["minutes"], 475)
        self.assertNotEqual(
            intervals[0]["minutes"],
            intervals[0]["endMin"] - intervals[0]["startMin"],
            "minutes must be the sum of the parts, not the span",
        )

    def test_zero_punch_day_is_one_absence(self):
        intervals = self._intervals([])

        self.assertEqual(len(intervals), 1, f"expected one absence, got {intervals}")
        self.assertEqual(intervals[0]["startMin"], 8 * 60)
        self.assertEqual(intervals[0]["endMin"], 17 * 60)
        self.assertEqual(intervals[0]["minutes"], 480)

    def test_worked_the_morning_only_is_unchanged(self):
        # The regression guard for the rule that was rejected. This person
        # stopped exactly at lunch; billing them for the lunch hour would be
        # wrong, and a naive "don't carve the lunch when nobody is there
        # after it" rule does exactly that.
        intervals = self._intervals([self._punch(8, 0), self._punch(12, 0)])

        self.assertEqual(len(intervals), 1)
        self.assertEqual(intervals[0]["startMin"], 13 * 60)
        self.assertEqual(intervals[0]["endMin"], 17 * 60)
        self.assertEqual(intervals[0]["minutes"], 240)

    def test_a_gap_that_merely_contains_the_lunch_is_not_bridged(self):
        # Only an EXACT abutment on both sides is a lunch split. Two intervals
        # that happen to sit either side of midday without touching it are two
        # real findings and must stay two.
        from dewey_time.attendance_engine.absence_intervals import (
            _bridge_scheduled_lunch,
        )

        intervals = [
            {"startMin": 480, "endMin": 700, "minutes": 220, "kind": "leading"},
            {"startMin": 800, "endMin": 1020, "minutes": 220, "kind": "leading"},
        ]
        out = _bridge_scheduled_lunch(intervals, lunch_start=720, lunch_end=780)

        self.assertEqual(len(out), 2)

    def test_no_scheduled_lunch_configured_is_a_no_op(self):
        from dewey_time.attendance_engine.absence_intervals import (
            _bridge_scheduled_lunch,
        )

        intervals = [
            {"startMin": 480, "endMin": 720, "minutes": 240, "kind": "leading"},
            {"startMin": 780, "endMin": 1020, "minutes": 240, "kind": "leading"},
        ]
        out = _bridge_scheduled_lunch(intervals, lunch_start=None, lunch_end=None)

        self.assertEqual(len(out), 2)

    def test_a_real_zero_punch_day_yields_a_flag_above_the_threshold(self):
        # intraday.py gates the no-show on this list being non-empty. Every
        # test on both sides of that gate mocks this function, so without this
        # an early `if not checkins: return []` added here would silence the
        # no-show forever with both suites still green.
        from dewey_time.attendance_engine.absence_flags import (
            evaluate_missing_time_flags,
        )

        flags = evaluate_missing_time_flags(
            checkins=[], shift_meta=self.SHIFT, attendance_date=self.DAY
        )

        self.assertEqual([code for code, _ in flags], ["MISSING_TIME"])
        self.assertEqual(flags[0][1]["minutes"], 480)

    def test_a_real_zero_punch_day_below_the_threshold_yields_nothing(self):
        # The other half of the gate: 29 minutes in, no row -- which is why the
        # no-show cannot appear earlier than the MISSING_TIME it replaces.
        from dewey_time.attendance_engine.absence_flags import (
            evaluate_missing_time_flags,
        )

        flags = evaluate_missing_time_flags(
            checkins=[],
            shift_meta=self.SHIFT,
            attendance_date=self.DAY,
            max_end_min=8 * 60 + 29,
        )

        self.assertEqual(flags, [])
