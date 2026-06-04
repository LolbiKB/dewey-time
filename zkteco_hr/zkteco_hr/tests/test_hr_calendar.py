import unittest
from unittest.mock import patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.attendance_engine.hr_calendar import (
    _filter_auto_flags_for_calendar_day,
    _shift_schedule_assignment_start_field,
    first_checkin_date_by_employee,
    is_full_time_employment,
)


class TestHrCalendarHelpers(unittest.TestCase):
    def test_full_time_employment(self):
        self.assertTrue(is_full_time_employment("Full-time"))
        self.assertTrue(is_full_time_employment("Full Time"))
        self.assertTrue(is_full_time_employment("FULL TIME"))

    def test_not_full_time(self):
        self.assertFalse(is_full_time_employment(None))
        self.assertFalse(is_full_time_employment(""))
        self.assertFalse(is_full_time_employment("Part-time"))
        self.assertFalse(is_full_time_employment("Contract"))

    def test_ssa_start_field_prefers_create_shifts_after(self):
        with patch("zkteco_hr.attendance_engine.hr_calendar.frappe.db.has_column") as has_column:
            has_column.side_effect = lambda _dt, col: col == "create_shifts_after"
            self.assertEqual(_shift_schedule_assignment_start_field(), "create_shifts_after")

    def test_ssa_start_field_falls_back_to_from_date(self):
        with patch("zkteco_hr.attendance_engine.hr_calendar.frappe.db.has_column") as has_column:
            has_column.side_effect = lambda _dt, col: col == "from_date"
            self.assertEqual(_shift_schedule_assignment_start_field(), "from_date")

    def test_first_checkin_date_includes_offshift_rows(self):
        with patch("zkteco_hr.attendance_engine.hr_calendar.frappe.db.table_exists") as table_exists:
            with patch("zkteco_hr.attendance_engine.hr_calendar.frappe.db.sql") as sql:
                table_exists.return_value = True
                sql.return_value = [
                    {"employee": "EMP-1", "first_checkin_date": "2026-05-16"},
                ]
                out = first_checkin_date_by_employee(["EMP-1"])
                self.assertEqual(out["EMP-1"]["first_checkin_date"], "2026-05-16")
                query = sql.call_args[0][0]
                self.assertIn("MIN(DATE(`time`))", query)
                self.assertNotIn("offshift", query)
                self.assertNotIn("skip_auto_attendance", query)


class TestCalendarFlagDisplay(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.hr_calendar.has_open_device_closeout_alert", return_value=True)
    def test_open_today_shows_provisional_auto_only(self, _open_alert):
        today = "2026-06-03"
        rows = [
            {"name": "F1", "source": "AUTO", "day_closed": 1, "flag_code": "ATTENDANCE_ISSUE"},
            {"name": "F2", "source": "AUTO", "day_closed": 0, "flag_code": "MISSING_TIME"},
            {"name": "F3", "source": "HR", "day_closed": 1, "flag_code": "LATE_START"},
        ]
        out = _filter_auto_flags_for_calendar_day(
            rows,
            attendance_date=today,
            employee_branch="DIS Iconic",
            site_today=today,
        )
        self.assertEqual([row["name"] for row in out], ["F3", "F2"])

    @patch("zkteco_hr.attendance_engine.hr_calendar.has_open_device_closeout_alert", return_value=False)
    def test_closed_today_shows_final_auto(self, _open_alert):
        today = "2026-06-03"
        rows = [
            {"name": "F1", "source": "AUTO", "day_closed": 1, "flag_code": "MISSING_TIME"},
            {"name": "F2", "source": "AUTO", "day_closed": 0, "flag_code": "MISSING_TIME"},
        ]
        out = _filter_auto_flags_for_calendar_day(
            rows,
            attendance_date=today,
            employee_branch="DIS Iconic",
            site_today=today,
        )
        self.assertEqual([row["name"] for row in out], ["F1"])


if __name__ == "__main__":
    unittest.main()
