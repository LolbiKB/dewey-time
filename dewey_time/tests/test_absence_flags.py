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


class TestAutoFlagIdentity(unittest.TestCase):
    """day_closed is part of an AUTO flag's identity.

    Without it, a provisional (day_closed=0) and a final (day_closed=1) row for
    the same employee/date/code share a name. Intraday deletes only its own
    provisional rows, so refreshing a past date that closeout had already
    finalized collided with the existing final rather than writing a flag.

    Only provisionals carry the marker, so every finalized name is unchanged and
    no historical row is orphaned.
    """

    def _name_for(self, day_closed):
        from dewey_time.dewey_time.doctype.attendance_flag.attendance_flag import (
            AttendanceFlag,
        )

        doc = AttendanceFlag.__new__(AttendanceFlag)
        doc.employee = "EMP-001"
        doc.attendance_date = "2026-07-01"
        doc.flag_code = "LATE_START"
        doc.source = "AUTO"
        doc.severity = None
        doc.company = "ACME"
        doc.day_closed = day_closed
        doc.before_insert()
        return doc.name

    def test_provisional_and_final_do_not_share_a_name(self):
        self.assertNotEqual(self._name_for(0), self._name_for(1))

    def test_only_the_provisional_carries_the_marker(self):
        """Finalized names must be byte-identical to what is already stored.

        Asserted as a relationship rather than a literal: frappe.scrub differs
        between the suite's mock and real Frappe, so a hard-coded string would
        pin the mock instead of the property that matters.
        """
        final = self._name_for(1)
        self.assertFalse(final.endswith("-prov"), "finalized rows must keep their existing names")
        self.assertEqual(self._name_for(0), f"{final}-prov")
