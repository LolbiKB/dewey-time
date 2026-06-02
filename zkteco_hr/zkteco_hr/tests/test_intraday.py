import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


class TestIntradayRefresh(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.intraday.evaluate_missing_time_flags")
    @patch("zkteco_hr.attendance_engine.intraday._insert_flag")
    @patch("zkteco_hr.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=False)
    @patch("zkteco_hr.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("zkteco_hr.attendance_engine.intraday.missing_time_max_end_min_for_date", return_value=660)
    @patch("zkteco_hr.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.intraday.frappe.get_cached_doc")
    def test_missing_time_when_zero_checkins(
        self,
        get_cached_doc,
        delete_flags,
        get_shift,
        get_shift_meta,
        _checkins,
        _max_end,
        _open_alert,
        _delivery_failed,
        insert_flag,
        evaluate_missing,
    ):
        from zkteco_hr.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

        evaluate_missing.return_value = [
            (
                "MISSING_TIME",
                {
                    "interval_start": "2026-05-28T09:00:00",
                    "interval_end": "2026-05-28T10:00:00",
                    "minutes": 60,
                    "kind": "leading",
                    "threshold_minutes": 30,
                },
            )
        ]

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        from zkteco_hr.attendance_engine.shift_grace import enrich_shift_meta

        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = enrich_shift_meta(
            {
                "start_time": datetime(2026, 5, 28, 8, 0, 0),
                "custom_grace_minutes": 5,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
                "end_time": datetime(2026, 5, 28, 17, 0, 0),
            }
        )

        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))

        delete_flags.assert_called_once()
        self.assertEqual(delete_flags.call_args.kwargs.get("day_closed"), 0)
        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("MISSING_TIME", flag_codes)
        self.assertNotIn("UNNOTIFIED_ABSENCE", flag_codes)
        missing_call = next(c for c in insert_flag.call_args_list if c.kwargs["flag_code"] == "MISSING_TIME")
        self.assertEqual(missing_call.kwargs["day_closed"], 0)

    @patch("zkteco_hr.attendance_engine.intraday.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.intraday._insert_flag")
    @patch("zkteco_hr.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=True)
    @patch("zkteco_hr.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.intraday.frappe.get_cached_doc")
    def test_missing_time_skipped_when_delivery_failed(
        self,
        get_cached_doc,
        delete_flags,
        get_shift,
        get_shift_meta,
        _checkins,
        insert_flag,
        _delivery_failed,
        evaluate_missing,
    ):
        from zkteco_hr.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        from zkteco_hr.attendance_engine.shift_grace import enrich_shift_meta

        get_shift_meta.return_value = enrich_shift_meta(
            {
                "start_time": datetime(2026, 5, 28, 8, 0, 0),
                "custom_grace_minutes": 5,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
                "end_time": datetime(2026, 5, 28, 17, 0, 0),
            }
        )

        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))

        evaluate_missing.assert_not_called()
        flag_codes = [call.kwargs.get("flag_code") for call in insert_flag.call_args_list]
        self.assertNotIn("MISSING_TIME", flag_codes)


class TestIntradayLateStartGrace(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.intraday.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.intraday._insert_flag")
    @patch("zkteco_hr.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=False)
    @patch("zkteco_hr.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("zkteco_hr.attendance_engine.intraday.missing_time_max_end_min_for_date", return_value=660)
    @patch("zkteco_hr.attendance_engine.intraday._get_checkins_for_day")
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.intraday._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.intraday.frappe.get_cached_doc")
    def test_late_start_uses_hrms_grace_when_custom_zero(
        self,
        get_cached_doc,
        _delete_flags,
        get_shift,
        get_shift_meta,
        get_checkins,
        _max_end,
        _open_alert,
        _delivery_failed,
        insert_flag,
        _evaluate_missing,
    ):
        from zkteco_hr.attendance_engine.intraday import refresh_intraday_flags_for_employee_date
        from zkteco_hr.attendance_engine.shift_grace import enrich_shift_meta

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = enrich_shift_meta(
            {
                "start_time": datetime(2026, 5, 28, 8, 0, 0),
                "end_time": datetime(2026, 5, 28, 17, 0, 0),
                "custom_grace_minutes": 0,
                "late_entry_grace_period": 15,
                "early_exit_grace_period": 0,
            }
        )
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 28, 8, 10), "custom_device_branch": "BRANCH-A"},
        ]

        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))

        flag_codes = [call.kwargs.get("flag_code") for call in insert_flag.call_args_list]
        self.assertNotIn("LATE_START", flag_codes)

        insert_flag.reset_mock()
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 28, 8, 16), "custom_device_branch": "BRANCH-A"},
        ]
        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))
        flag_codes = [call.kwargs.get("flag_code") for call in insert_flag.call_args_list]
        self.assertIn("LATE_START", flag_codes)


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
