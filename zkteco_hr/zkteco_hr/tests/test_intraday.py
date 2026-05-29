import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


class TestIntradayRefresh(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.intraday._insert_flag")
    @patch("zkteco_hr.attendance_engine.intraday._has_delivery_failed_today", return_value=False)
    @patch("zkteco_hr.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("zkteco_hr.attendance_engine.intraday.now_datetime")
    @patch("zkteco_hr.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.intraday.frappe.get_cached_doc")
    def test_no_checkin_yet_when_past_threshold(
        self,
        get_cached_doc,
        delete_flags,
        get_shift,
        get_shift_meta,
        _checkins,
        now_datetime,
        _open_alert,
        _delivery_failed,
        insert_flag,
    ):
        from zkteco_hr.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = {"start_time": datetime(2026, 5, 28, 8, 0, 0), "custom_grace_minutes": 5}
        now_datetime.return_value = datetime(2026, 5, 28, 11, 0, 0)

        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))

        delete_flags.assert_called_once()
        self.assertEqual(delete_flags.call_args.kwargs.get("day_closed"), 0)
        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("NO_CHECKIN_YET", flag_codes)
        self.assertNotIn("UNNOTIFIED_ABSENCE", flag_codes)
        no_checkin_call = next(c for c in insert_flag.call_args_list if c.kwargs["flag_code"] == "NO_CHECKIN_YET")
        self.assertEqual(no_checkin_call.kwargs["day_closed"], 0)

    @patch("zkteco_hr.attendance_engine.intraday._insert_flag")
    @patch("zkteco_hr.attendance_engine.intraday._has_delivery_failed_today", return_value=True)
    @patch("zkteco_hr.attendance_engine.intraday.now_datetime")
    @patch("zkteco_hr.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.intraday.frappe.get_cached_doc")
    def test_no_checkin_yet_skipped_when_delivery_failed(
        self,
        get_cached_doc,
        delete_flags,
        get_shift,
        get_shift_meta,
        _checkins,
        now_datetime,
        insert_flag,
        _delivery_failed,
    ):
        from zkteco_hr.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = {"start_time": datetime(2026, 5, 28, 8, 0, 0), "custom_grace_minutes": 5}
        now_datetime.return_value = datetime(2026, 5, 28, 11, 0, 0)

        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))

        flag_codes = [
            (call.kwargs.get("flag_code") or (call.args[3] if len(call.args) > 3 else None))
            for call in insert_flag.call_args_list
        ]
        self.assertNotIn("NO_CHECKIN_YET", flag_codes)


class TestIntradayEnqueue(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.intraday.frappe.enqueue")
    def test_checkin_hook_enqueues_coalesced_job(self, enqueue):
        from zkteco_hr.attendance_engine.intraday import on_employee_checkin_after_insert

        doc = MagicMock()
        doc.employee = "EMP-1"
        doc.time = datetime(2026, 5, 28, 9, 15, 0)

        on_employee_checkin_after_insert(doc)

        enqueue.assert_called_once()
        self.assertTrue(enqueue.call_args.kwargs.get("deduplicate"))
        self.assertIn("zkteco_hr-intraday", enqueue.call_args.kwargs.get("job_id", ""))
