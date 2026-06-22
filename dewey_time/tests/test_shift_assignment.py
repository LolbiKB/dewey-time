import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()

SITE_TODAY = date(2026, 6, 3)


class TestShiftAssignmentQuery(unittest.TestCase):
    def setUp(self):
        import frappe

        frappe.get_all = MagicMock(return_value=[])
        frappe.db.has_column = MagicMock(return_value=True)

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_tuesday_in_mon_sat_block_is_assigned(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = [
            {
                "name": "HR-SHA-26-05-00013",
                "shift_type": "FT_Standard",
                "start_date": date(2026, 6, 1),
                "end_date": date(2026, 6, 6),
                "status": "Active",
            }
        ]

        row = _get_shift_assignment_query("DI-1138", date(2026, 6, 2))
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "HR-SHA-26-05-00013")

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_wednesday_in_mon_sat_june_block_is_assigned(self, _now):
        """HR-SHA style range row: start Mon, end Sat — mid-week dates must match."""
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = [
            {
                "name": "HR-SHA-26-05-00013",
                "shift_type": "FT_Standard",
                "start_date": date(2026, 6, 1),
                "end_date": date(2026, 6, 6),
                "status": "Active",
            }
        ]

        row = _get_shift_assignment_query("DI-1138", date(2026, 6, 3))
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "HR-SHA-26-05-00013")
        self.assertEqual(row["start_date"], "2026-06-01")
        self.assertEqual(row["end_date"], "2026-06-06")

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_sunday_after_june_block_end_is_not_assigned(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        row = _get_shift_assignment_query("DI-1138", date(2026, 6, 7))
        self.assertIsNone(row)

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_friday_in_mon_sat_block_queries_active_first(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = [
            {
                "name": "SA-001",
                "shift_type": "FT_Standard",
                "start_date": date(2026, 5, 25),
                "end_date": date(2026, 5, 30),
                "status": "Active",
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

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_sunday_after_block_end_is_not_assigned(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        row = _get_shift_assignment_query("EMP-1", date(2026, 5, 31))
        self.assertIsNone(row)

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_draft_assignment_not_returned(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        _get_shift_assignment_query("EMP-1", date(2026, 5, 27))
        self.assertEqual(frappe.get_all.call_args.kwargs["filters"]["docstatus"], 1)

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_historical_inactive_row_is_assigned_with_superseded(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        inactive_row = {
            "name": "HR-SHA-26-06-00002",
            "shift_type": "FT_0800_1700",
            "start_date": date(2026, 5, 18),
            "end_date": date(2026, 5, 23),
            "status": "Inactive",
        }

        def _get_all_side_effect(*_args, **kwargs):
            if kwargs.get("filters", {}).get("status") == "Active":
                return []
            if kwargs.get("filters", {}).get("status") == "Inactive":
                return [inactive_row]
            return []

        frappe.get_all.side_effect = _get_all_side_effect

        row = _get_shift_assignment_query("DI-1138", date(2026, 5, 20))
        self.assertIsNotNone(row)
        self.assertEqual(row["shift_type"], "FT_0800_1700")
        self.assertTrue(row["schedule_superseded"])
        self.assertEqual(row["assignment_status"], "Inactive")
        self.assertEqual(frappe.get_all.call_count, 2)

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_today_inactive_only_is_not_assigned(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        frappe.get_all.return_value = []

        row = _get_shift_assignment_query("DI-1138", SITE_TODAY)
        self.assertIsNone(row)
        frappe.get_all.assert_called_once()
        self.assertEqual(frappe.get_all.call_args.kwargs["filters"]["status"], "Active")

    @patch("dewey_time.attendance_engine.shift_assignment.nowdate", return_value=SITE_TODAY)
    def test_historical_prefers_active_over_inactive(self, _now):
        from dewey_time.attendance_engine.shift_assignment import _get_shift_assignment_query

        import frappe

        active_row = {
            "name": "SA-ACTIVE",
            "shift_type": "FT_A",
            "start_date": date(2026, 5, 18),
            "end_date": date(2026, 5, 23),
            "status": "Active",
        }
        frappe.get_all.return_value = [active_row]

        row = _get_shift_assignment_query("EMP-1", date(2026, 5, 20))
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "SA-ACTIVE")
        self.assertNotIn("schedule_superseded", row)
        frappe.get_all.assert_called_once()

    @patch("dewey_time.attendance_engine.shift_assignment._get_shift_assignment_query")
    @patch("dewey_time.attendance_engine.shift_assignment._get_shift_assignment_hrms")
    def test_hrms_without_db_row_is_not_assigned(self, hrms_mock, query_mock):
        """Weekly off: HRMS may return a shift even when no SA row exists for that date."""
        from dewey_time.attendance_engine.shift_assignment import get_shift_assignment

        hrms_mock.return_value = {
            "name": "SA-HRMS",
            "shift_type": "FT_A",
            "start_date": "2026-06-07",
            "end_date": "2026-06-07",
        }
        query_mock.return_value = None

        row = get_shift_assignment(employee="EMP-1", attendance_date=date(2026, 6, 7))
        self.assertIsNone(row)

    @patch("dewey_time.attendance_engine.shift_assignment._get_shift_assignment_hrms")
    def test_query_path_used_for_assigned_day(self, hrms_mock):
        from dewey_time.attendance_engine.shift_assignment import get_shift_assignment

        hrms_mock.return_value = None

        with patch(
            "dewey_time.attendance_engine.shift_assignment._get_shift_assignment_query"
        ) as query_mock:
            query_mock.return_value = {
                "name": "SA-1",
                "shift_type": "FT_A",
                "start_date": "2026-06-02",
                "end_date": "2026-06-06",
            }
            row = get_shift_assignment(employee="EMP-1", attendance_date=date(2026, 6, 3))
            self.assertEqual(row["shift_type"], "FT_A")
            query_mock.assert_called_once()
            hrms_mock.assert_not_called()


class TestShiftContextForDay(unittest.TestCase):
    @patch("dewey_time.attendance_engine.hr_calendar._get_shift_meta")
    @patch("dewey_time.attendance_engine.hr_calendar._get_shift_assignment")
    def test_shift_assigned_true_on_friday_in_block(self, get_assignment, get_meta):
        from dewey_time.attendance_engine.hr_calendar import _shift_context_for_day

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

    @patch("dewey_time.attendance_engine.hr_calendar._get_shift_meta")
    @patch("dewey_time.attendance_engine.hr_calendar._get_shift_assignment")
    def test_shift_context_passes_superseded_metadata(self, get_assignment, get_meta):
        from dewey_time.attendance_engine.hr_calendar import _shift_context_for_day

        get_assignment.return_value = {
            "shift_type": "FT_Standard",
            "assignment_status": "Inactive",
            "schedule_superseded": True,
        }
        get_meta.return_value = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "custom_grace_minutes": 15,
        }

        ctx = _shift_context_for_day(employee="EMP-1", attendance_date=date(2026, 5, 20))
        self.assertTrue(ctx["shift_assigned"])
        self.assertTrue(ctx["schedule_superseded"])
        self.assertEqual(ctx["assignment_status"], "Inactive")

    @patch("dewey_time.attendance_engine.hr_calendar._get_shift_assignment")
    def test_shift_assigned_false_when_no_assignment(self, get_assignment):
        from dewey_time.attendance_engine.hr_calendar import _shift_context_for_day

        get_assignment.return_value = None
        ctx = _shift_context_for_day(employee="EMP-1", attendance_date=date(2026, 5, 31))
        self.assertFalse(ctx["shift_assigned"])


if __name__ == "__main__":
    unittest.main()
