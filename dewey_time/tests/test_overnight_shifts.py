"""
Overnight-shift flag-engine verification (audit T2-3).

Covers a 22:00→06:00(+1d) shift for LATE_START, LEFT_EARLY, and MISSING_TIME.
Uses the same _install_frappe_mock() harness as test_closeout.py (pure in-memory,
no DB required).

Intended contract (derived from shift_times.py / closeout.py):
  - start_dt = combine_date_time(D, start_time)       → D 22:00  [correct for day D]
  - end_dt   = combine_date_time(D, end_time)          → D 06:00  [WRONG: should be D+1 06:00]
  - derive_missing_expected_intervals: bails when end_min <= start_min [WRONG for overnight]
  - _get_checkins_for_day: D 00:00–23:59 only → D+1 OUT excluded [production gap]

Tests assert the CORRECT behavior; failures confirm confirmed correctness bugs.
"""

import unittest
from datetime import date, datetime, time as dt_time, timedelta
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


def _overnight_shift_meta(grace: int = 10):
    """22:00→06:00 shift with configurable grace (applied to both start and end)."""
    from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

    return enrich_shift_meta(
        {
            "start_time": dt_time(22, 0),
            "end_time": dt_time(6, 0),
            "custom_grace_minutes": grace,
            "late_entry_grace_period": 0,
            "early_exit_grace_period": 0,
            "custom_lunch_start": None,
            "custom_lunch_end": None,
        }
    )


# ---------------------------------------------------------------------------
# LATE_START — overnight shift
# ---------------------------------------------------------------------------

class TestOvernightLateStart(unittest.TestCase):
    """
    Shift: 22:00 D → 06:00 D+1, grace 10 min.
    LATE_START threshold: D 22:10.
    """

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_late_in_with_both_punches_emits_late_start(
        self,
        get_cached_doc,
        get_shift,
        get_checkins,
        get_shift_meta,
        _delete_flags,
        insert_flag,
        _lunch,
        _missing,
        _record,
    ):
        """
        IN at D 22:30 (20 min late, 10-min grace → threshold D 22:10), OUT at D+1 06:00.
        Expects LATE_START. LATE_START start_dt arithmetic uses attendance_date only,
        so combine_date_time(D, time(22,0)) = D 22:00 — correct. With 2 punches present
        the >= 2 guard passes. This scenario should PASS.
        """
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        D = date(2026, 7, 1)
        D1 = D + timedelta(days=1)

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "NIGHT_2200_0600"}
        get_shift_meta.return_value = _overnight_shift_meta(grace=10)
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(D.year, D.month, D.day, 22, 30), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(D1.year, D1.month, D1.day, 6, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=D,
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn(
            "LATE_START",
            flag_codes,
            "Employee arrived 20 min late (threshold D 22:10); LATE_START must be emitted.",
        )

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_ontime_in_does_not_emit_late_start(
        self,
        get_cached_doc,
        get_shift,
        get_checkins,
        get_shift_meta,
        _delete_flags,
        insert_flag,
        _lunch,
        _missing,
        _record,
    ):
        """
        IN at D 22:05 (5 min late — within 10-min grace), OUT at D+1 06:00.
        LATE_START must NOT be emitted.
        """
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        D = date(2026, 7, 1)
        D1 = D + timedelta(days=1)

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "NIGHT_2200_0600"}
        get_shift_meta.return_value = _overnight_shift_meta(grace=10)
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(D.year, D.month, D.day, 22, 5), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(D1.year, D1.month, D1.day, 6, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=D,
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn(
            "LATE_START",
            flag_codes,
            "Employee arrived within grace period (22:05 ≤ 22:10 threshold); no LATE_START.",
        )

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    @unittest.expectedFailure  # T2-3 Bug A (confirmed): D+1 OUT excluded by _get_checkins_for_day → checkins_count<2 skips LATE_START. Remove marker when fixed.
    def test_late_in_production_mode_single_punch_emits_late_start(
        self,
        get_cached_doc,
        get_shift,
        get_checkins,
        get_shift_meta,
        _delete_flags,
        insert_flag,
        _lunch,
        _missing,
        _record,
    ):
        """
        Production scenario: _get_checkins_for_day fetches D 00:00–23:59 only, so the
        D+1 06:00 OUT punch is ABSENT. Only the IN at D 22:30 (late) is visible to the engine.
        checkins_count=1 fails the >= 2 guard for LATE_START → flag is never emitted.

        EXPECTED RESULT: LATE_START emitted.
        CONFIRMED BUG: with only 1 punch the guard prevents LATE_START detection entirely.
        D+1 punches must be included in the day-D checkin window for overnight shifts to work.
        """
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        D = date(2026, 7, 1)

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "NIGHT_2200_0600"}
        get_shift_meta.return_value = _overnight_shift_meta(grace=10)
        # Only the D-day IN punch — D+1 OUT not returned (production _get_checkins_for_day)
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(D.year, D.month, D.day, 22, 30), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=D,
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn(
            "LATE_START",
            flag_codes,
            "Late overnight IN (22:30 > grace threshold 22:10) must emit LATE_START. "
            "BUG: with only 1 punch (D+1 OUT excluded from window) checkins_count<2 "
            "silently skips the LATE_START check.",
        )


# ---------------------------------------------------------------------------
# LEFT_EARLY — overnight shift
# ---------------------------------------------------------------------------

class TestOvernightLeftEarly(unittest.TestCase):
    """
    Shift: 22:00 D → 06:00 D+1, grace 10 min.
    LEFT_EARLY threshold: D+1 05:50 (06:00 − 10 min).
    Engine computes: end_dt = combine_date_time(D, time(6,0)) = D 06:00  [WRONG].
    """

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    @unittest.expectedFailure  # T2-3 Bug B (confirmed): end_dt=combine_date_time(D,06:00)=D 06:00 not D+1 → LEFT_EARLY threshold on wrong day. Remove marker when fixed.
    def test_early_out_emits_left_early(
        self,
        get_cached_doc,
        get_shift,
        get_checkins,
        get_shift_meta,
        _delete_flags,
        insert_flag,
        _lunch,
        _missing,
        _record,
    ):
        """
        IN on time (D 22:00), OUT at D+1 05:00 — 1 hour early (well outside 10-min grace).
        LEFT_EARLY must be emitted.

        CONFIRMED BUG: end_dt = combine_date_time(D, time(6,0)) = D 06:00 (same-day, not D+1).
        early_threshold = D 05:50. last_out_dt = D+1 05:00.
        D+1 05:00 < D 05:50 is FALSE (D+1 > D), so LEFT_EARLY is never triggered.
        The engine needs to detect end_time < start_time and roll end_dt to D+1.
        """
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        D = date(2026, 7, 1)
        D1 = D + timedelta(days=1)

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "NIGHT_2200_0600"}
        get_shift_meta.return_value = _overnight_shift_meta(grace=10)
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(D.year, D.month, D.day, 22, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(D1.year, D1.month, D1.day, 5, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=D,
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn(
            "LEFT_EARLY",
            flag_codes,
            "Employee left at D+1 05:00, 1 hour before the 06:00 shift end; LEFT_EARLY must be emitted. "
            "BUG: end_dt = combine_date_time(D, time(6,0)) = D 06:00 (not D+1 06:00); "
            "early_threshold = D 05:50; D+1 05:00 < D 05:50 is FALSE → LEFT_EARLY silently missed.",
        )

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_ontime_out_does_not_emit_left_early(
        self,
        get_cached_doc,
        get_shift,
        get_checkins,
        get_shift_meta,
        _delete_flags,
        insert_flag,
        _lunch,
        _missing,
        _record,
    ):
        """
        IN at D 22:00, OUT at D+1 06:00 (exactly on time). No LEFT_EARLY expected.
        This passes — D+1 06:00 > D 05:50 (wrong reason: end_dt on wrong day, but
        the accidental comparison is still correct for this edge case).
        """
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        D = date(2026, 7, 1)
        D1 = D + timedelta(days=1)

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "NIGHT_2200_0600"}
        get_shift_meta.return_value = _overnight_shift_meta(grace=10)
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(D.year, D.month, D.day, 22, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(D1.year, D1.month, D1.day, 6, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=D,
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn(
            "LEFT_EARLY",
            flag_codes,
            "Employee left at D+1 06:00 (on time); LEFT_EARLY must NOT be emitted.",
        )


# ---------------------------------------------------------------------------
# MISSING_TIME — overnight gap crossing midnight
# ---------------------------------------------------------------------------

class TestOvernightMissingTime(unittest.TestCase):
    """
    Direct tests of absence_intervals.derive_missing_expected_intervals and
    compute_missing_time_intervals for overnight shifts.

    Bug: derive_missing_expected_intervals returns [] when end_min <= start_min
    (absence_intervals.py line: "if end_min <= start_min: return []").
    For 22:00→06:00: end_min=360, start_min=1320 → 360 <= 1320 → bail out.
    MISSING_TIME detection is completely disabled for overnight shifts.
    """

    @unittest.expectedFailure  # T2-3 Bug C (confirmed): absence_intervals.py:66 `end_min<=start_min: return []` disables overnight MISSING_TIME. Remove marker when fixed.
    def test_derive_missing_expected_returns_intervals_for_overnight_shift(self):
        """
        shift 22:00→06:00, no checkins (segments=[]).
        Expected: at least one missing-expected interval covering the shift span.
        CONFIRMED BUG: end_min(360) <= start_min(1320) → function returns [].
        """
        from dewey_time.attendance_engine.absence_intervals import derive_missing_expected_intervals

        shift_meta = {
            "start_time": dt_time(22, 0),
            "end_time": dt_time(6, 0),
            "custom_grace_minutes": 0,
            "custom_lunch_start": None,
            "custom_lunch_end": None,
        }
        intervals = derive_missing_expected_intervals(
            shift_meta=shift_meta,
            segments=[],
            max_end_min=None,
        )
        self.assertTrue(
            len(intervals) > 0,
            "Overnight shift (22:00→06:00) with no checkins must produce missing-expected intervals. "
            "BUG: derive_missing_expected_intervals returns [] when end_min(360) <= start_min(1320).",
        )

    @unittest.expectedFailure  # T2-3 Bug C (confirmed): overnight gap across midnight not detected (minutes-since-midnight scale + D+1 date mismatch). Remove marker when fixed.
    def test_compute_missing_time_detects_gap_crossing_midnight(self):
        """
        Shift 22:00→06:00(+1d). Employee works D 22:00–23:00, away 90 min (23:00→00:30+1d),
        returns D+1 00:30, exits at D+1 06:00. The 90-min gap should produce a MISSING_TIME
        interval of >= 30 min.

        CONFIRMED BUG: derive_missing_expected_intervals bails (end_min <= start_min);
        derive_away_gap_intervals also fails because minutes_from_checkin_time returns None
        for D+1 punches (date != attendance_date), leaving segment end_min=None → no gap detected.
        """
        from dewey_time.attendance_engine.absence_intervals import compute_missing_time_intervals

        D = date(2026, 7, 1)
        D1 = D + timedelta(days=1)

        shift_meta = {
            "start_time": dt_time(22, 0),
            "end_time": dt_time(6, 0),
            "custom_grace_minutes": 0,
            "custom_lunch_start": None,
            "custom_lunch_end": None,
            "effective_start_grace_minutes": 0,
            "effective_end_grace_minutes": 0,
            "effective_lunch_return_grace_minutes": 0,
        }
        # Gap: 23:00→00:30+1d (90 min away across midnight)
        checkins = [
            {"name": "IN-1", "time": datetime(D.year, D.month, D.day, 22, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(D.year, D.month, D.day, 23, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "IN-2", "time": datetime(D1.year, D1.month, D1.day, 0, 30), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-2", "time": datetime(D1.year, D1.month, D1.day, 6, 0), "custom_device_branch": "BRANCH-A"},
        ]

        intervals = compute_missing_time_intervals(
            checkins=checkins,
            shift_meta=shift_meta,
            attendance_date=D,
        )
        total_minutes = sum(i["minutes"] for i in intervals)
        self.assertGreaterEqual(
            total_minutes,
            30,
            "90-minute gap crossing midnight must produce >= 30 min of MISSING_TIME intervals. "
            "BUG: absence_intervals module operates in minutes-since-midnight (0-1439) with no "
            "day-boundary awareness; end_min<=start_min guard and D+1 date mismatch both eliminate detection.",
        )
