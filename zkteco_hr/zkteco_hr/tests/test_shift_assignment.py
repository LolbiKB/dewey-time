import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


class TestShiftAssignmentQuery(unittest.TestCase):
    def setUp(self):
        import frappe

        frappe.get_all = MagicMock(return_value=[])

    def test_wednesday_in_mon_sat_june_block_is_assigned(self):
        """HR-SHA style range row: start Mon, end Sat — mid-week dates must match."""
        from zkteco_hr.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = [
            {
                "name": "HR-SHA-26-05-00013",
                "shift_type": "FT_Standard",
                "start_date": date(2026, 6, 1),
                "end_date": date(2026, 6, 6),
            }
        ]

        row = _get_shift_assignment_query("DI-1138", date(2026, 6, 3))
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "HR-SHA-26-05-00013")
        self.assertEqual(row["start_date"], "2026-06-01")
        self.assertEqual(row["end_date"], "2026-06-06")

    def test_sunday_after_june_block_end_is_not_assigned(self):
        from zkteco_hr.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        row = _get_shift_assignment_query("DI-1138", date(2026, 6, 7))
        self.assertIsNone(row)

    def test_friday_in_mon_sat_block_is_assigned(self):
        from zkteco_hr.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = [
            {
                "name": "SA-001",
                "shift_type": "FT_Standard",
                "start_date": date(2026, 5, 25),
                "end_date": date(2026, 5, 30),
            }
        ]

        row = _get_shift_assignment_query("EMP-1", date(2026, 5, 29))
        self.assertIsNotNone(row)
        self.assertEqual(row["shift_type"], "FT_Standard")
        self.assertEqual(row["end_date"], "2026-05-30")

        frappe.get_all.assert_called_once()
        call_kwargs = frappe.get_all.call_args.kwargs
        self.assertEqual(call_kwargs["filters"]["docstatus"], 1)
        self.assertEqual(call_kwargs["filters"]["status"], "Active")
        self.assertEqual(call_kwargs["filters"]["start_date"], ["<=", date(2026, 5, 29)])

    def test_sunday_after_block_end_is_not_assigned(self):
        from zkteco_hr.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        row = _get_shift_assignment_query("EMP-1", date(2026, 5, 31))
        self.assertIsNone(row)

    def test_draft_assignment_not_returned(self):
        from zkteco_hr.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        _get_shift_assignment_query("EMP-1", date(2026, 5, 27))
        self.assertEqual(frappe.get_all.call_args.kwargs["filters"]["docstatus"], 1)

    @patch("zkteco_hr.attendance_engine.shift_assignment._get_shift_assignment_hrms")
    def test_hrms_path_used_when_available(self, hrms_mock):
        from zkteco_hr.attendance_engine.shift_assignment import get_shift_assignment

        hrms_mock.return_value = {
            "name": "SA-HRMS",
            "shift_type": "FT_A",
            "start_date": "2026-05-27",
            "end_date": "2026-06-06",
        }

        row = get_shift_assignment(employee="EMP-1", attendance_date=date(2026, 5, 27))
        self.assertEqual(row["shift_type"], "FT_A")
        hrms_mock.assert_called_once()


class TestShiftContextForDay(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.hr_calendar._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.hr_calendar._get_shift_assignment")
    def test_shift_assigned_true_on_friday_in_block(self, get_assignment, get_meta):
        from zkteco_hr.attendance_engine.hr_calendar import _shift_context_for_day

        get_assignment.return_value = {"shift_type": "FT_Standard"}
        get_meta.return_value = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "custom_grace_minutes": 15,
            "custom_lunch_start": "12:00:00",
            "custom_lunch_end": "13:00:00",
        }

        ctx = _shift_context_for_day(employee="EMP-1", attendance_date=date(2026, 5, 29))
        self.assertTrue(ctx["shift_assigned"])
        self.assertEqual(ctx["shift_type"], "FT_Standard")

    @patch("zkteco_hr.attendance_engine.hr_calendar._get_shift_assignment")
    def test_shift_assigned_false_when_no_assignment(self, get_assignment):
        from zkteco_hr.attendance_engine.hr_calendar import _shift_context_for_day

        get_assignment.return_value = None
        ctx = _shift_context_for_day(employee="EMP-1", attendance_date=date(2026, 5, 31))
        self.assertFalse(ctx["shift_assigned"])


if __name__ == "__main__":
    unittest.main()
