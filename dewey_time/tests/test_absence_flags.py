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
