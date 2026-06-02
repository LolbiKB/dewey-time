import json
import sys
import unittest
from datetime import date, time as dt_time
from types import ModuleType
from unittest.mock import MagicMock, patch


def _mock_get_time(value):
    if value is None:
        return None
    if hasattr(value, "hour"):
        return value
    if isinstance(value, str):
        parts = value.split(":")
        return dt_time(
            int(parts[0]),
            int(parts[1]),
            int(parts[2]) if len(parts) > 2 else 0,
        )
    return value


def _install_frappe_mock():
    if "frappe" in sys.modules and isinstance(sys.modules["frappe"], MagicMock):
        utils = sys.modules.get("frappe.utils")
        if utils is not None and not hasattr(utils, "get_time"):
            utils.get_time = _mock_get_time
        return

    frappe = MagicMock(name="frappe")
    frappe.utils = MagicMock()
    frappe.utils.now_datetime = MagicMock(return_value=date.today())
    frappe.utils.getdate = lambda value: value
    frappe.utils.get_time = _mock_get_time
    frappe.utils.add_days = lambda value, days: value
    frappe.AuthenticationError = Exception
    frappe.throw = MagicMock(side_effect=lambda msg, exc=None: (_ for _ in ()).throw(exc or Exception(msg)))
    frappe._ = lambda value: value
    frappe.conf = MagicMock()
    frappe.conf.get = MagicMock(return_value=None)
    frappe.db = MagicMock()
    frappe.db.exists = MagicMock(return_value=False)
    frappe.db.get_value = MagicMock(return_value=None)
    frappe.db.table_exists = MagicMock(return_value=True)
    frappe.db.set_value = MagicMock()
    frappe.db.delete = MagicMock()
    frappe.db.sql = MagicMock(return_value=[])
    frappe.get_all = MagicMock(return_value=[])
    frappe.get_doc = MagicMock()
    frappe.get_cached_doc = MagicMock()
    frappe.set_user = MagicMock()
    frappe.get_request_header = MagicMock(return_value=None)
    frappe.session = MagicMock(user="Guest")
    frappe.enqueue = MagicMock()

    def _whitelist(*_args, **_kwargs):
        def _wrap(fn):
            return fn

        return _wrap

    frappe.whitelist = _whitelist

    utils_mod = ModuleType("frappe.utils")
    utils_mod.now_datetime = frappe.utils.now_datetime
    utils_mod.getdate = lambda value: value
    utils_mod.get_datetime = lambda value: value
    utils_mod.get_time = _mock_get_time
    utils_mod.add_days = lambda value, days: value
    utils_mod.nowdate = lambda: str(date.today())

    frappe.scrub = lambda value: str(value).lower().replace(" ", "-").replace("_", "-")

    password_mod = ModuleType("frappe.utils.password")
    password_mod.check_password = MagicMock(return_value=True)

    model_mod = ModuleType("frappe.model.document")

    class Document:
        def __init__(self, *args, **kwargs):
            payload = {}
            if args and isinstance(args[0], dict):
                payload.update(args[0])
            payload.update(kwargs)
            self.__dict__.update(payload)

    model_mod.Document = Document

    sys.modules["frappe"] = frappe
    sys.modules["frappe.utils"] = utils_mod
    sys.modules["frappe.utils.password"] = password_mod
    sys.modules["frappe.model.document"] = model_mod


_install_frappe_mock()


class TestCloseoutHelpers(unittest.TestCase):
    def test_parse_undelivered_requires_list_for_closed(self):
        from zkteco_hr.attendance_engine.closeout import _parse_undelivered

        self.assertEqual(_parse_undelivered(None, status="closed"), [])
        self.assertEqual(_parse_undelivered([], status="closed"), [])
        items = _parse_undelivered(
            json.dumps([{"pin": "1", "frappe_employee_id": "EMP-001"}]),
            status="closed",
        )
        self.assertEqual(items[0]["pin"], "1")

    def test_parse_undelivered_ignored_when_not_closed(self):
        from zkteco_hr.attendance_engine.closeout import _parse_undelivered

        self.assertEqual(
            _parse_undelivered(json.dumps([{"pin": "1"}]), status="deferred_offline"),
            [],
        )


class TestDeviceCloseoutWebhook(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.closeout.frappe.enqueue")
    @patch("zkteco_hr.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("zkteco_hr.attendance_engine.closeout.validate_bridge_request")
    def test_closed_enqueues_flag_generation(self, _auth, upsert, enqueue):
        from zkteco_hr.attendance_engine.closeout import notify_device_closeout_status

        upsert.return_value = "DCA-dev1-2026-05-27"
        undelivered = json.dumps([{"pin": "99", "frappe_employee_id": "EMP-1"}])

        result = notify_device_closeout_status(
            device_sn="dev1",
            local_date="2026-05-27",
            status="closed",
            device_branch="BRANCH-A",
            undelivered=undelivered,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["enqueued"])
        upsert.assert_called_once()
        enqueue.assert_called_once()
        kwargs = enqueue.call_args.kwargs
        self.assertEqual(kwargs["device_sn"], "dev1")
        self.assertEqual(kwargs["local_date"], "2026-05-27")
        self.assertEqual(len(kwargs["undelivered"]), 1)

    @patch("zkteco_hr.attendance_engine.closeout.frappe.enqueue")
    @patch("zkteco_hr.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("zkteco_hr.attendance_engine.closeout.validate_bridge_request")
    def test_deferred_offline_creates_alert_without_enqueue(self, _auth, upsert, enqueue):
        from zkteco_hr.attendance_engine.closeout import notify_device_closeout_status

        upsert.return_value = "DCA-dev1-2026-05-27"

        result = notify_device_closeout_status(
            device_sn="dev1",
            local_date="2026-05-27",
            status="deferred_offline",
            device_branch="BRANCH-A",
            last_error="offline",
        )

        self.assertFalse(result["enqueued"])
        enqueue.assert_not_called()
        upsert.assert_called_once()
        self.assertEqual(upsert.call_args.kwargs["status"], "deferred_offline")

    @patch("zkteco_hr.attendance_engine.closeout.frappe.enqueue")
    @patch("zkteco_hr.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("zkteco_hr.attendance_engine.closeout.validate_bridge_request")
    def test_webhook_idempotent_upsert(self, _auth, upsert, enqueue):
        from zkteco_hr.attendance_engine.closeout import notify_device_closeout_status

        upsert.return_value = "DCA-dev1-2026-05-27"

        notify_device_closeout_status(
            device_sn="dev1",
            local_date="2026-05-27",
            status="closure_failed",
            device_branch="BRANCH-A",
        )
        notify_device_closeout_status(
            device_sn="dev1",
            local_date="2026-05-27",
            status="closed",
            device_branch="BRANCH-A",
        )

        self.assertEqual(upsert.call_count, 2)
        self.assertEqual(upsert.call_args_list[-1].kwargs["status"], "closed")
        enqueue.assert_called_once()


class TestLateAndEarlyFlags(unittest.TestCase):
    def _shift_meta_with_grace(self, **grace_fields):
        from zkteco_hr.attendance_engine.shift_grace import enrich_shift_meta

        return enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": dt_time(17, 0),
                "custom_lunch_start": None,
                "custom_lunch_end": None,
                **grace_fields,
            }
        )

    @patch("zkteco_hr.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_closeout_late_start_and_left_early(
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
        from datetime import datetime

        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta_with_grace(
            custom_grace_minutes=10,
            late_entry_grace_period=0,
            early_exit_grace_period=10,
        )
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 8, 30), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(2026, 5, 27, 16, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("LATE_START", flag_codes)
        self.assertIn("LEFT_EARLY", flag_codes)

    @patch("zkteco_hr.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_late_start_respects_hrms_grace_when_custom_zero(
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
        from datetime import datetime

        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta_with_grace(
            custom_grace_minutes=0,
            late_entry_grace_period=15,
            early_exit_grace_period=0,
        )

        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 8, 10), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]
        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )
        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn("LATE_START", flag_codes)

        insert_flag.reset_mock()
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 8, 16), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]
        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )
        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("LATE_START", flag_codes)
        late_call = next(c for c in insert_flag.call_args_list if c.kwargs["flag_code"] == "LATE_START")
        self.assertEqual(late_call.kwargs["evidence"]["grace_minutes"], 15)
        self.assertEqual(late_call.kwargs["evidence"]["late_entry_grace_period"], 15)

    @patch("zkteco_hr.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_late_start_not_flagged_for_timedelta_shift_start(
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
        from datetime import datetime, timedelta

        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta_with_grace(
            start_time=timedelta(hours=8),
            end_time=timedelta(hours=17),
            custom_grace_minutes=15,
            late_entry_grace_period=0,
            early_exit_grace_period=15,
        )
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 8, 10), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn("LATE_START", flag_codes)

    @patch("zkteco_hr.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_late_start_suppressed_with_single_punch(
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
        from datetime import datetime

        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta_with_grace(
            custom_grace_minutes=0,
            late_entry_grace_period=0,
            early_exit_grace_period=0,
        )
        # Only one punch — no complete pair, no LATE_START even though it's after shift start.
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn("LATE_START", flag_codes)

    @patch("zkteco_hr.attendance_engine.closeout.holiday_by_date_for_company")
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_meta")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day")
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_holiday_wins_emits_only_off_shift_punch_when_checkins_exist(
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
        holiday_by_date,
    ):
        from datetime import datetime

        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta_with_grace(custom_grace_minutes=0)
        holiday_by_date.return_value = {"2026-05-27": {"description": "Holiday", "weekly_off": False}}
        get_checkins.return_value = [
            {"name": "IN-1", "time": datetime(2026, 5, 27, 8, 0), "custom_device_branch": "BRANCH-A"},
            {"name": "OUT-1", "time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )

        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertEqual(flag_codes, ["OFF_SHIFT_PUNCH"])

    @patch("zkteco_hr.attendance_engine.closeout.holiday_by_date_for_company")
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_holiday_wins_creates_no_flags_when_no_checkins(
        self,
        get_cached_doc,
        get_shift,
        _checkins,
        _delete_flags,
        insert_flag,
        holiday_by_date,
    ):
        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        holiday_by_date.return_value = {"2026-05-27": {"description": "Holiday", "weekly_off": False}}

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=True,
        )
        insert_flag.assert_not_called()


class TestDeviceCloseoutFlags(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.closeout._on_shift_zero_checkin_employees_at_branch", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._device_closeout_branch", return_value="BRANCH-A")
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._generate_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._employees_for_device_closeout", return_value=["EMP-1"])
    def test_closed_routes_to_device_scoped_generation(self, employees, generate, insert_flag, _branch, _sweep):
        from zkteco_hr.attendance_engine.closeout import generate_auto_flags_for_device_date

        generate_auto_flags_for_device_date(
            device_sn="dev1",
            local_date="2026-05-27",
            undelivered=[{"pin": "42", "frappe_employee_id": "EMP-1"}],
        )

        employees.assert_called_once()
        generate.assert_called_once()
        self.assertTrue(generate.call_args.kwargs["include_unnotified_absence"])
        insert_flag.assert_not_called()

    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_device_closeout_creates_delivery_failed_without_absence(
        self, get_cached_doc, get_shift, _checkins, delete_flags, insert_flag
    ):
        from zkteco_hr.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date="2026-05-27",
            include_unnotified_absence=False,
            device_sn="dev1",
            undelivered_items=[{"pin": "42", "frappe_employee_id": "EMP-1"}],
        )

        self.assertEqual(delete_flags.call_count, 2)
        self.assertEqual(delete_flags.call_args_list[0].kwargs.get("day_closed"), 0)
        self.assertEqual(delete_flags.call_args_list[1].kwargs.get("day_closed"), 1)
        flag_codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("ATTENDANCE_ISSUE", flag_codes)
        self.assertNotIn("UNNOTIFIED_ABSENCE", flag_codes)

    @patch("zkteco_hr.attendance_engine.closeout.has_open_device_closeout_alert", return_value=True)
    @patch("zkteco_hr.attendance_engine.closeout._insert_flag")
    @patch("zkteco_hr.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("zkteco_hr.attendance_engine.closeout._get_shift_assignment")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_all")
    @patch("zkteco_hr.attendance_engine.closeout.frappe.get_cached_doc")
    def test_company_fallback_skips_open_branch_alert(
        self, get_cached_doc, get_all, get_shift, _checkins, insert_flag, _open_alert
    ):
        from zkteco_hr.attendance_engine.closeout import _generate_company_fallback_for_date

        get_all.return_value = ["EMP-1"]
        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}

        _generate_company_fallback_for_date(company="Test Co", attendance_date=date(2026, 5, 27))

        insert_flag.assert_not_called()


class TestDeviceCloseoutAlertDoc(unittest.TestCase):
    def test_autoname_is_stable_per_device_and_date(self):
        from zkteco_hr.zkteco_hr.doctype.device_closeout_alert.device_closeout_alert import (
            DeviceCloseoutAlert,
        )

        doc = DeviceCloseoutAlert(
            {
                "doctype": "Device Closeout Alert",
                "device_sn": "SN-100",
                "local_date": "2026-05-27",
                "status": "deferred_offline",
            }
        )
        doc.autoname()
        self.assertEqual(doc.name, "DCA-sn-100-2026-05-27")
