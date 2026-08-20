import json
import sys
import unittest
from datetime import date, datetime, time as dt_time
from types import ModuleType
from unittest.mock import MagicMock, patch


def _mock_cint(value, default=0):
    """Stand-in for frappe.utils.cint: real Frappe tries int() first, falls
    back through float() for numeric strings, and returns `default` for
    anything else -- a broad except in both stages, not just
    (TypeError, ValueError), since this is shared across every backend test
    module and a narrower catch here would silently diverge from production
    for inputs neither of us has hit yet."""
    try:
        return int(value)
    except Exception:
        try:
            return int(float(value))
        except Exception:
            return default


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
    # Same reason as AuthenticationError above: frappe.throw's side_effect does
    # `generator.throw(exc)`, and an auto-MagicMock attribute is not a
    # BaseException subclass, so `frappe.throw(msg, frappe.PermissionError)`
    # would die with a TypeError instead of the error the caller intended.
    frappe.PermissionError = Exception
    frappe.ValidationError = Exception
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
    # frappe.utils is a real ModuleType, not a MagicMock, so anything absent
    # here is a hard ImportError at `from frappe.utils import ...` rather than
    # an auto-stub. Added for the Telegram link tokens' expiry arithmetic.
    utils_mod.add_to_date = lambda value, **kwargs: value
    # Computes for real rather than returning a constant: the Mini App's range
    # cap is enforced with this, and a stubbed 0 would make both the
    # oversized-range test and the at-the-limit test pass no matter what the
    # cap said.
    utils_mod.date_diff = lambda end, start: (
        date.fromisoformat(str(end)) - date.fromisoformat(str(start))
    ).days
    utils_mod.nowdate = lambda: str(date.today())
    utils_mod.cint = _mock_cint
    # Added for the /hr-me page module (www/hr-me.py), whose boot carries the
    # site timezone for the Mini App's clock arithmetic.
    utils_mod.get_system_timezone = lambda: "Asia/Phnom_Penh"
    # An https site by default, because that is what production is and what
    # the Telegram Mini App URL fallback needs to produce a usable button.
    # Tests that care about the value patch `transport.get_url` directly.
    utils_mod.get_url = lambda path="": f"https://example.test{path}"

    frappe.scrub = lambda value: str(value).lower().replace(" ", "-").replace("_", "-")

    password_mod = ModuleType("frappe.utils.password")
    password_mod.check_password = MagicMock(return_value=True)
    # bridge_auth reads api_secret back out of __Auth with this; the default
    # stub keeps every caller that is not testing the comparison itself green.
    password_mod.get_decrypted_password = MagicMock(return_value="SECRET")

    # enrollment_api builds its check-in aggregate with frappe.qb, because
    # Frappe v16 rejects SQL functions written as strings in SELECT. The mock
    # only has to make the IMPORT resolve -- every test patches _checkin_counts
    # wholesale, and the query itself is proven on a real bench instead.
    qb_functions_mod = ModuleType("frappe.query_builder.functions")
    qb_functions_mod.Count = MagicMock(name="Count")
    query_builder_mod = ModuleType("frappe.query_builder")
    query_builder_mod.functions = qb_functions_mod
    frappe.qb = MagicMock(name="qb")

    model_mod = ModuleType("frappe.model.document")

    class Document:
        def __init__(self, *args, **kwargs):
            payload = {}
            if args and isinstance(args[0], dict):
                payload.update(args[0])
            payload.update(kwargs)
            self.__dict__.update(payload)

    model_mod.Document = Document

    sys.modules["frappe.query_builder"] = query_builder_mod
    sys.modules["frappe.query_builder.functions"] = qb_functions_mod
    sys.modules["frappe"] = frappe
    sys.modules["frappe.utils"] = utils_mod
    sys.modules["frappe.utils.password"] = password_mod
    sys.modules["frappe.model.document"] = model_mod


_install_frappe_mock()


class TestCloseoutHelpers(unittest.TestCase):
    def test_parse_undelivered_requires_list_for_closed(self):
        from dewey_time.attendance_engine.closeout import _parse_undelivered

        self.assertEqual(_parse_undelivered(None, status="closed"), [])
        self.assertEqual(_parse_undelivered([], status="closed"), [])
        items = _parse_undelivered(
            json.dumps([{"pin": "1", "frappe_employee_id": "EMP-001"}]),
            status="closed",
        )
        self.assertEqual(items[0]["pin"], "1")

    def test_parse_undelivered_ignored_when_not_closed(self):
        from dewey_time.attendance_engine.closeout import _parse_undelivered

        self.assertEqual(
            _parse_undelivered(json.dumps([{"pin": "1"}]), status="deferred_offline"),
            [],
        )


class TestDeviceCloseoutWebhook(unittest.TestCase):
    @patch("dewey_time.attendance_engine.closeout.frappe.enqueue")
    @patch("dewey_time.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("dewey_time.attendance_engine.closeout.validate_bridge_request")
    def test_closed_enqueues_flag_generation(self, _auth, upsert, enqueue):
        from dewey_time.attendance_engine.closeout import notify_device_closeout_status

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

    @patch("dewey_time.attendance_engine.closeout.frappe.enqueue")
    @patch("dewey_time.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("dewey_time.attendance_engine.closeout.validate_bridge_request")
    def test_deferred_offline_creates_alert_without_enqueue(self, _auth, upsert, enqueue):
        from dewey_time.attendance_engine.closeout import notify_device_closeout_status

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

    @patch("dewey_time.attendance_engine.closeout.frappe.enqueue")
    @patch("dewey_time.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("dewey_time.attendance_engine.closeout.validate_bridge_request")
    def test_webhook_idempotent_upsert(self, _auth, upsert, enqueue):
        from dewey_time.attendance_engine.closeout import notify_device_closeout_status

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

    @patch("dewey_time.attendance_engine.closeout.frappe.enqueue")
    @patch("dewey_time.attendance_engine.closeout.upsert_device_closeout_alert")
    @patch("dewey_time.attendance_engine.closeout.validate_bridge_request")
    def test_undelivered_count_none_when_field_absent_number_when_supplied(
        self, _auth, upsert, enqueue
    ):
        # The residue ratchet. An ABSENT undelivered field makes no claim and
        # must reach the upsert as None (leave any stored residue alone); an
        # explicit list -- empty included -- is a positive claim and reaches it
        # as its length. Without the distinction, a sloppy re-post of
        # {status: closed} zeroes a recorded residue and the next rebuild
        # attests a day that lost punches.
        from dewey_time.attendance_engine.closeout import notify_device_closeout_status

        upsert.return_value = "DCA-dev1-2026-05-27"

        notify_device_closeout_status(
            device_sn="dev1", local_date="2026-05-27", status="closed",
            device_branch="BRANCH-A",
            undelivered=json.dumps([{"pin": "42"}, {"pin": "43"}]),
        )
        self.assertEqual(upsert.call_args.kwargs["undelivered_count"], 2)

        notify_device_closeout_status(
            device_sn="dev1", local_date="2026-05-27", status="closed",
            device_branch="BRANCH-A",
        )
        self.assertIsNone(upsert.call_args.kwargs["undelivered_count"])

        notify_device_closeout_status(
            device_sn="dev1", local_date="2026-05-27", status="closed",
            device_branch="BRANCH-A", undelivered="[]",
        )
        self.assertEqual(upsert.call_args.kwargs["undelivered_count"], 0)

    def test_upsert_leaves_stored_residue_alone_when_no_claim_is_made(self):
        # The upsert half of the ratchet: undelivered_count=None must not put
        # the key into the update payload at all, where 0 must.
        from dewey_time.attendance_engine.closeout import upsert_device_closeout_alert

        with patch(
            "dewey_time.attendance_engine.closeout.frappe.db.exists", return_value=True
        ), patch(
            "dewey_time.attendance_engine.closeout.frappe.db.set_value"
        ) as set_value:
            upsert_device_closeout_alert(
                device_sn="dev1", local_date=date(2026, 5, 27), status="closed",
            )
            self.assertNotIn("undelivered_count", set_value.call_args.args[2])

            upsert_device_closeout_alert(
                device_sn="dev1", local_date=date(2026, 5, 27), status="closed",
                undelivered_count=0,
            )
            self.assertEqual(set_value.call_args.args[2]["undelivered_count"], 0)
            self.assertEqual(set_value.call_args.args[2]["undelivered_recorded"], 1)

            # A re-opened day drops its stale clean claim: deferred_offline
            # after a close clears the recorded bit, so a later nonconforming
            # close cannot inherit it.
            upsert_device_closeout_alert(
                device_sn="dev1", local_date=date(2026, 5, 27),
                status="deferred_offline",
            )
            self.assertEqual(set_value.call_args.args[2]["undelivered_recorded"], 0)
            self.assertNotIn("undelivered_count", set_value.call_args.args[2])


class TestLateAndEarlyFlags(unittest.TestCase):
    def _shift_meta_with_grace(self, **grace_fields):
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        return enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": dt_time(17, 0),
                "custom_lunch_start": None,
                "custom_lunch_end": None,
                **grace_fields,
            }
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

        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
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

        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
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

        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
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

        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company")
    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
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

        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company")
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_holiday_wins_creates_no_flags_when_no_checkins(
        self,
        get_cached_doc,
        get_shift,
        _checkins,
        _delete_flags,
        insert_flag,
        holiday_by_date,
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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


class TestAttestedSinglePunchLateStart(unittest.TestCase):
    """The 2-punch rule is a proxy for feed completeness. When the stored
    Device Closeout Alert state positively attests the feed -- the lone
    punch's own device closed with zero undelivered residue, no open alert at
    either relevant branch, no branchless open alert, no delivery markers --
    a lone unlabelled punch in the first half of the shift may carry
    LATE_START. Every other situation must keep today's silence.

    The attestation is STORED-STATE ONLY (no call-time device_sn), so the
    positive test here runs through the fallback signature too: the same
    delete-and-rebuild that used to destroy the flag must now recreate it.

    Each breaker test corresponds to one clause of the predicate. The first
    review of this feature proved by mutation that several clauses had no
    covering test; every clause now has a test that fails when it alone is
    deleted.
    """

    DATE = date(2026, 5, 27)

    def setUp(self):
        # Patcher-based rather than decorator stacks: ten collaborators per
        # test. evaluate_record_issue_flags is deliberately NOT patched -- the
        # lone punch must produce a real ATTENDANCE_ISSUE(single_checkin)
        # NEXT TO the new LATE_START, and a stubbed [] would stage that
        # coexistence instead of proving it. frappe.get_all and
        # rollout.phase_for are pinned because the frappe mock is shared
        # module state under `unittest discover` and this class must not
        # inherit another module's leavings.
        specs = {
            "get_cached_doc": patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc"),
            "get_all": patch("dewey_time.attendance_engine.closeout.frappe.get_all"),
            "get_shift": patch("dewey_time.attendance_engine.closeout._get_shift_assignment"),
            "get_checkins": patch("dewey_time.attendance_engine.closeout._get_checkins_for_day"),
            "get_shift_meta": patch("dewey_time.attendance_engine.closeout._get_shift_meta"),
            "delete_flags": patch(
                "dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date"
            ),
            "insert_flag": patch("dewey_time.attendance_engine.closeout._insert_flag"),
            "lunch": patch(
                "dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[]
            ),
            "missing": patch(
                "dewey_time.attendance_engine.closeout.evaluate_missing_time_flags",
                return_value=[],
            ),
            "open_alert": patch(
                "dewey_time.attendance_engine.closeout.has_open_device_closeout_alert",
                return_value=False,
            ),
            "phase_for": patch(
                "dewey_time.attendance_engine.closeout.rollout.phase_for", return_value="LIVE"
            ),
        }
        self.mocks = {}
        for key, patcher in specs.items():
            self.mocks[key] = patcher.start()
            self.addCleanup(patcher.stop)

        # One discriminating side_effect instead of a flat []: the predicate's
        # frappe.get_all consumers (delivery markers, the branchless
        # open-alert probe, the device-sync roster, each device's closed
        # alert) must each be steerable independently, or their clauses are
        # untestable -- the first review deleted `or skip_absence` and the
        # whole suite stayed green precisely because a flat [] neutered the
        # marker query. FULL filter fidelity on the date/resolved_at keys,
        # because the final review proved a mutation dropping `local_date`
        # from the closed-alert query survived a looser mock: one closed day
        # EVER would have attested every later date for that device.
        self.marker_rows = []  # DELIVERY_FAILED pluck rows
        self.issue_rows = []  # ATTENDANCE_ISSUE marker rows (name+evidence)
        self.branchless_open_alerts = []  # open alerts with no branch recorded
        self.closed_alerts = {}  # (device_sn, date) -> alert row
        self.sync_rows = {}  # branch -> [device_sn] heartbeats for DATE

        def _get_all(doctype, **kwargs):
            filters = kwargs.get("filters") or {}
            if doctype == "Attendance Flag":
                if filters.get("flag_code") == "DELIVERY_FAILED":
                    return list(self.marker_rows)
                if filters.get("flag_code") == "ATTENDANCE_ISSUE":
                    return list(self.issue_rows)
                return []
            if doctype == "Device Sync Status":
                if filters.get("local_date") != self.DATE:
                    return []
                return list(self.sync_rows.get(filters.get("branch"), []))
            if doctype == "Device Closeout Alert":
                if filters.get("local_date") != self.DATE:
                    return []
                if filters.get("branch") == ["is", "not set"]:
                    if filters.get("resolved_at") != ["is", "not set"]:
                        return []
                    return list(self.branchless_open_alerts)
                if filters.get("status") == "closed":
                    row = self.closed_alerts.get(filters.get("device_sn"))
                    return [row] if row else []
                return []
            return []

        self.mocks["get_all"].side_effect = _get_all

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        self.mocks["get_cached_doc"].return_value = employee
        self.employee_doc = employee
        self.mocks["get_shift"].return_value = {"shift_type": "FT_0800_1700"}
        self._set_shift_meta()

        # The attesting device: alive on the roster, closed, RECORDED zero
        # residue -- the positive baseline every breaker test then subtracts
        # one condition from.
        self.closed_alerts["DEV-1"] = {"undelivered_count": 0, "undelivered_recorded": 1}
        self.sync_rows["BRANCH-A"] = ["DEV-1"]

    def _set_shift_meta(self, **grace):
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        # 8:00-17:00 default: late_threshold 8:00 + grace, arrival window ends
        # 12:30 (midpoint of the shift, grace-independent).
        meta = {
            "start_time": dt_time(8, 0),
            "end_time": dt_time(17, 0),
            "custom_lunch_start": None,
            "custom_lunch_end": None,
            "custom_grace_minutes": 0,
            "late_entry_grace_period": 0,
            "early_exit_grace_period": 0,
        }
        meta.update(grace)
        self.mocks["get_shift_meta"].return_value = enrich_shift_meta(meta)

    def _lone_punch(self, hour, minute=0, branch="BRANCH-A", device="DEV-1", log_type=None):
        self.mocks["get_checkins"].return_value = [
            {
                "name": "IN-1",
                "time": datetime(2026, 5, 27, hour, minute),
                "log_type": log_type,
                "device_id": device,
                "custom_device_branch": branch,
            }
        ]

    def _generate(self, **overrides):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        kwargs = {
            "employee": "EMP-1",
            "attendance_date": self.DATE,
            "include_unnotified_absence": False,
            "device_sn": "DEV-1",
            "undelivered_items": [],
        }
        kwargs.update(overrides)
        _generate_for_employee_date(**kwargs)

    def _flag_codes(self):
        return [call.kwargs["flag_code"] for call in self.mocks["insert_flag"].call_args_list]

    def _late_call(self):
        return next(
            c
            for c in self.mocks["insert_flag"].call_args_list
            if c.kwargs["flag_code"] == "LATE_START"
        )

    def test_attested_lone_morning_punch_now_carries_late_start(self):
        self._lone_punch(9)
        self._generate()

        codes = self._flag_codes()
        self.assertIn("LATE_START", codes)
        # The day is still incomplete, and that finding survives alongside.
        self.assertIn("ATTENDANCE_ISSUE", codes)

        evidence = self._late_call().kwargs["evidence"]
        self.assertIs(evidence["feed_attested"], True)
        self.assertIs(evidence["single_punch"], True)
        self.assertEqual(evidence["arrival_window_end"], "2026-05-27T12:30:00")
        self.assertEqual(evidence["attesting_device"], "DEV-1")

    def test_the_rebuild_recreates_what_it_deleted(self):
        # THE BLOCKER FROM THE FIRST REVIEW. The 03:00 fallback and the
        # punch-edit regeneration re-enter without device_sn, wipe every AUTO
        # flag, and rebuild. The attestation now lives in stored alert state,
        # so the rebuild must re-derive it and recreate the LATE_START it
        # just deleted -- not silently drop it.
        self._lone_punch(9)
        self._generate(device_sn=None, undelivered_items=None)

        self.assertIn("LATE_START", self._flag_codes())
        self.assertIs(self._late_call().kwargs["evidence"]["feed_attested"], True)

    def test_no_closed_alert_for_the_punch_device_means_no_attestation(self):
        # The positive half: without the device's own countersigned close,
        # "nobody complained" is not an attestation.
        self.closed_alerts.clear()
        self._lone_punch(9)
        self._generate()

        codes = self._flag_codes()
        self.assertNotIn("LATE_START", codes)
        self.assertIn("ATTENDANCE_ISSUE", codes)

    def test_closed_with_undelivered_residue_is_not_attestation_grade(self):
        # A closed report that named ANY undelivered rows -- including rows
        # the bridge could not attribute to an employee, which vanish from
        # every per-employee slice -- breaks the attestation via the stored
        # device-level count.
        self.closed_alerts["DEV-1"] = {"undelivered_count": 3, "undelivered_recorded": 1}
        self._lone_punch(9)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_the_migrate_backfill_shape_is_not_attestation_grade(self):
        # Frappe creates Int columns NOT NULL DEFAULT 0 (NOT_NULL_TYPES in
        # frappe/database/schema.py, verified on a real bench), so after
        # migrate EVERY pre-existing closed row reads count=0 -- including
        # days that closed WITH residue. The recorded bit's own backfilled 0
        # is what keeps those rows refused; count alone cannot.
        self.closed_alerts["DEV-1"] = {"undelivered_count": 0, "undelivered_recorded": 0}
        self._lone_punch(9)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_every_device_alive_at_the_branch_must_have_countersigned(self):
        # THE ROSTER, from the final review: a device dark at close time
        # posts NOTHING -- not even deferred_offline -- until it reconnects,
        # so absence of complaints proves nothing. DEV-2 heartbeated at the
        # home branch this date (it was alive that morning, exactly when the
        # missing arrival would have been badged) and never closed: refuse.
        self.sync_rows["BRANCH-A"] = ["DEV-1", "DEV-2"]
        self._lone_punch(9)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_a_fully_countersigned_roster_attests(self):
        self.sync_rows["BRANCH-A"] = ["DEV-1", "DEV-2"]
        self.closed_alerts["DEV-2"] = {"undelivered_count": 0, "undelivered_recorded": 1}
        self._lone_punch(9)
        self._generate()

        self.assertIn("LATE_START", self._flag_codes())

    def test_a_punch_device_with_no_heartbeat_row_cannot_attest(self):
        # The device closed its day but never heartbeated a Device Sync
        # Status row for the date: the sync integration is blind for this
        # device-day, and a blind roster proves nothing about who else was
        # alive. Closed alert alone is not enough.
        self.sync_rows["BRANCH-A"] = []
        self._lone_punch(9)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_a_label_that_is_neither_blank_nor_in_is_not_an_arrival(self):
        # Only blank and IN read as an arrival. A junk label is a label this
        # rule has no reading for -- refuse, same as OUT.
        self._lone_punch(9, log_type="AUTO")
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_delivery_failure_marker_breaks_the_attestation(self):
        # skip_absence's marker half, un-neutered: a DELIVERY_FAILED row for
        # this employee-date must refuse the attestation even with the
        # device's alert closed and every branch clean.
        self.marker_rows = ["FLAG-DF-1"]
        self._lone_punch(9)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_open_alert_at_home_branch_breaks_it_even_for_a_foreign_punch(self):
        # employee_branch's own limb, ISOLATED: the punch is at clean BRANCH-B
        # and only the HOME branch has the open alert. skip_absence would also
        # catch this (it checks the home branch first), so it is pinned False
        # here -- otherwise this test passes through skip_absence and the
        # branch-set limb has zero coverage, which is exactly what the first
        # review proved by deleting the limb with the suite green.
        skip_patch = patch(
            "dewey_time.attendance_engine.closeout.should_skip_absence_flags",
            return_value=False,
        )
        skip_patch.start()
        self.addCleanup(skip_patch.stop)
        self.mocks["open_alert"].side_effect = (
            lambda *, branch, local_date: branch == "BRANCH-A"
        )
        self.closed_alerts["DEV-B"] = {"undelivered_count": 0, "undelivered_recorded": 1}
        self.sync_rows["BRANCH-B"] = ["DEV-B"]
        self._lone_punch(9, branch="BRANCH-B", device="DEV-B")
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_open_alert_at_the_punch_campus_breaks_it(self):
        # punch_branch's limb, isolated: home branch clean, the lone punch
        # came from BRANCH-B and a device THERE has not closed.
        self.mocks["open_alert"].side_effect = (
            lambda *, branch, local_date: branch == "BRANCH-B"
        )
        self.closed_alerts["DEV-B"] = {"undelivered_count": 0, "undelivered_recorded": 1}
        self.sync_rows["BRANCH-B"] = ["DEV-B"]
        self._lone_punch(9, branch="BRANCH-B", device="DEV-B")
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_branchless_open_alert_breaks_it(self):
        # A deferred_offline posted without device_branch matches no branch
        # query. It belongs to SOME branch -- possibly ours -- so its mere
        # existence on this date refuses the attestation.
        self.branchless_open_alerts = [{"name": "DCA-mystery-2026-05-27"}]
        self._lone_punch(9)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_neither_branch_known_is_not_clean(self):
        # "Unknowable is not clean": no home branch, no branch on the punch,
        # nowhere to check -- even though the device's alert is closed.
        self.employee_doc.branch = None
        self._lone_punch(9, branch="")
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_a_punch_with_no_device_cannot_be_attested(self):
        # A Desk-entered punch has no device_id: nothing countersigned it.
        self._lone_punch(9, device="")
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_an_explicit_out_label_is_believed_over_the_window(self):
        # Label-first, the rule punchDirection and notify.direction_of both
        # follow: an explicit OUT at 11:30 is a recorded DEPARTURE, and
        # reading it as a late arrival is the exact accusation the guard
        # exists to prevent -- whatever the clock says.
        self._lone_punch(11, 30, log_type="OUT")
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_afternoon_lone_punch_stays_silent(self):
        # 14:00 is past the 12:30 midpoint: "departure whose arrival never
        # read" is the better story, and no attestation can exclude it.
        self._lone_punch(14)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_a_punch_exactly_at_the_midpoint_is_still_an_arrival(self):
        # The boundary itself: <= midpoint, not < midpoint.
        self._lone_punch(12, 30)
        self._generate()

        self.assertIn("LATE_START", self._flag_codes())

    def test_the_window_is_measured_from_shift_start_not_the_threshold(self):
        # With 60 minutes of grace the midpoint must stay 12:30 -- the window
        # answers "is a lone punch here credibly an arrival", a fact about
        # the shift's shape, not about how much lateness it forgives. A
        # threshold-based formula would print 13:00 here.
        self._set_shift_meta(custom_grace_minutes=60)
        self._lone_punch(9, 30)
        self._generate()

        evidence = self._late_call().kwargs["evidence"]
        self.assertEqual(evidence["arrival_window_end"], "2026-05-27T12:30:00")

    def test_lone_punch_inside_grace_is_not_late(self):
        self._set_shift_meta(custom_grace_minutes=10)
        self._lone_punch(8, 5)
        self._generate()

        self.assertNotIn("LATE_START", self._flag_codes())

    def test_overnight_shift_keeps_its_own_rule_untouched(self):
        # Overnight already allows 1 punch; the attestation block must not
        # touch it -- its window arithmetic would be NEGATIVE here (end 06:00
        # combines onto the same day, so midpoint lands before the start).
        # LATE_START fires by the overnight rule with NONE of the new keys.
        self._set_shift_meta()
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        self.mocks["get_shift_meta"].return_value = enrich_shift_meta(
            {
                "start_time": dt_time(22, 0),
                "end_time": dt_time(6, 0),
                "custom_lunch_start": None,
                "custom_lunch_end": None,
                "custom_grace_minutes": 0,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
            }
        )
        self._lone_punch(23)
        self._generate()

        evidence = self._late_call().kwargs["evidence"]
        self.assertNotIn("feed_attested", evidence)
        self.assertNotIn("single_punch", evidence)
        self.assertNotIn("arrival_window_end", evidence)

    def test_a_shift_without_an_end_time_cannot_attest_and_cannot_crash(self):
        # No end_time -> no window to compute. The guard must decline BEFORE
        # _combine_date_time(date, None) raises -- an exception here is
        # swallowed by the isolation wrapper and costs the employee every
        # flag for the day, which is worse than a wrong one.
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        self.mocks["get_shift_meta"].return_value = enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": None,
                "custom_lunch_start": None,
                "custom_lunch_end": None,
                "custom_grace_minutes": 0,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
            }
        )
        self._lone_punch(9)
        self._generate()

        codes = self._flag_codes()
        self.assertNotIn("LATE_START", codes)
        self.assertIn("ATTENDANCE_ISSUE", codes)

    def test_two_punch_day_gains_no_attestation_evidence(self):
        # The ordinary path must be byte-identical to before: LATE_START by
        # the normal rule, with none of the single-punch evidence keys.
        self.mocks["get_checkins"].return_value = [
            {
                "name": "IN-1",
                "time": datetime(2026, 5, 27, 9, 0),
                "log_type": None,
                "device_id": "DEV-1",
                "custom_device_branch": "BRANCH-A",
            },
            {
                "name": "OUT-1",
                "time": datetime(2026, 5, 27, 17, 0),
                "log_type": None,
                "device_id": "DEV-1",
                "custom_device_branch": "BRANCH-A",
            },
        ]
        self._generate()

        evidence = self._late_call().kwargs["evidence"]
        self.assertNotIn("feed_attested", evidence)
        self.assertNotIn("single_punch", evidence)
        self.assertNotIn("arrival_window_end", evidence)


class TestDeviceCloseoutFlags(unittest.TestCase):
    @patch("dewey_time.attendance_engine.closeout._on_shift_zero_checkin_employees_at_branch", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._device_closeout_branch", return_value="BRANCH-A")
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._generate_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._employees_for_device_closeout", return_value=["EMP-1"])
    def test_closed_routes_to_device_scoped_generation(self, employees, generate, insert_flag, _branch, _sweep):
        from dewey_time.attendance_engine.closeout import generate_auto_flags_for_device_date

        generate_auto_flags_for_device_date(
            device_sn="dev1",
            local_date="2026-05-27",
            undelivered=[{"pin": "42", "frappe_employee_id": "EMP-1"}],
        )

        employees.assert_called_once()
        generate.assert_called_once()
        self.assertTrue(generate.call_args.kwargs["include_unnotified_absence"])
        insert_flag.assert_not_called()

    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_device_closeout_creates_delivery_failed_without_absence(
        self, get_cached_doc, get_shift, _checkins, delete_flags, insert_flag
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

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

    @patch("dewey_time.attendance_engine.closeout.has_open_device_closeout_alert", return_value=True)
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_all")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_company_fallback_skips_open_branch_alert(
        self, get_cached_doc, get_all, get_shift, _checkins, insert_flag, _open_alert
    ):
        from dewey_time.attendance_engine.closeout import _generate_company_fallback_for_date

        get_all.return_value = ["EMP-1"]
        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}

        _generate_company_fallback_for_date(company="Test Co", attendance_date=date(2026, 5, 27))

        insert_flag.assert_not_called()

    @patch("dewey_time.attendance_engine.closeout.has_open_device_closeout_alert", return_value=False)
    @patch("dewey_time.attendance_engine.closeout._generate_for_employee_date")
    @patch(
        "dewey_time.attendance_engine.closeout._get_checkins_for_day",
        return_value=[{"time": "09:15:00", "log_type": "IN"}, {"time": "18:05:00", "log_type": "OUT"}],
    )
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_all")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_company_fallback_closes_out_punched_employee_when_no_device_alert(
        self, get_cached_doc, get_all, get_shift, _checkins, generate_for_employee, _open_alert
    ):
        """T3-3: punched employee with no open device alert must receive full closeout (not be silently skipped)."""
        from dewey_time.attendance_engine.closeout import _generate_company_fallback_for_date

        get_all.return_value = ["EMP-1"]
        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}

        _generate_company_fallback_for_date(company="Test Co", attendance_date=date(2026, 5, 27))

        generate_for_employee.assert_called_once_with(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=False,
        )


class TestDeviceCloseoutAlertDoc(unittest.TestCase):
    def test_autoname_is_stable_per_device_and_date(self):
        from dewey_time.dewey_time.doctype.device_closeout_alert.device_closeout_alert import (
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


class TestOffShiftGate(unittest.TestCase):
    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_employee_gets_no_off_shift_punch(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)
        self.assertEqual(codes, [])

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_single_punch_still_flags_attendance_issue(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("ATTENDANCE_ISSUE", codes)
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)
        self.assertTrue(insert_flag.call_args_list[0].kwargs["evidence"]["clock_based"])

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_foreign_branch_still_flags_non_primary(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-B"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-B"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("NON_PRIMARY_SITE_PUNCH", codes)
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_no_punches_creates_nothing(
        self, get_cached_doc, _get_shift, _get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        insert_flag.assert_not_called()

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment", return_value=None)
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_blank_employment_type_still_gets_off_shift_punch(
        self, get_cached_doc, _get_shift, get_checkins, _delete_flags, insert_flag, _holiday
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = ""
        get_cached_doc.return_value = employee
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 0), "custom_device_branch": "BRANCH-A"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertEqual(codes, ["OFF_SHIFT_PUNCH"])

    @patch("dewey_time.attendance_engine.closeout.holiday_by_date_for_company", return_value={})
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_clock_based_with_shift_assignment_still_gets_late_start(
        self, get_cached_doc, get_shift, get_shift_meta, get_checkins,
        _delete_flags, insert_flag, _holiday
    ):
        """Schedule wins: a stale Shift Assignment keeps full scheduled-day logic."""
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        employee.employment_type = "Contract"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": dt_time(17, 0),
                "custom_lunch_start": None,
                "custom_lunch_end": None,
                "custom_grace_minutes": 0,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
            }
        )
        get_checkins.return_value = [
            {"time": datetime(2026, 5, 27, 9, 30), "custom_device_branch": "BRANCH-A"},
            {"time": datetime(2026, 5, 27, 17, 0), "custom_device_branch": "BRANCH-A"},
        ]

        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 5, 27))

        codes = [call.kwargs["flag_code"] for call in insert_flag.call_args_list]
        self.assertIn("LATE_START", codes)
        self.assertNotIn("OFF_SHIFT_PUNCH", codes)


class TestNonPrimarySiteSeverity(unittest.TestCase):
    """Punching at another site is a note, not a warning — HR described it as
    "not a major offense" and something the employee can justify."""

    def test_severity_is_info_in_closeout(self):
        from dewey_time.attendance_engine.closeout import FLAG_SEVERITY

        self.assertEqual(FLAG_SEVERITY["NON_PRIMARY_SITE_PUNCH"], "INFO")

    # test_severity_is_info_in_doctype and test_the_two_severity_maps_agree
    # lived here. They pinned a second copy of FLAG_SEVERITY in
    # attendance_flag.py against this one so the pair could not drift.
    #
    # T3-11 deleted that copy: its only reader was a severity default that
    # frappe made unreachable by pre-filling the Select with its first option.
    # With one map left there is nothing to drift from, so a test asserting it
    # agrees with itself would assert nothing. Deleted with the duplication,
    # not because they failed.


class TestFlagInsertIsolation(unittest.TestCase):
    """One failing insert used to escape the flag loop entirely. The
    isolated-generation wrapper caught it and logged, so the employee silently
    lost every flag that had not been written yet -- which is how a duplicate
    docname from two delivery failures cost a whole day."""

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags")
    @patch("dewey_time.attendance_engine.closeout.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout.evaluate_lunch_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_one_failing_insert_does_not_cost_the_others(
        self,
        get_cached_doc,
        get_shift,
        _checkins,
        get_shift_meta,
        _delete_flags,
        insert_flag,
        _lunch,
        _missing,
        record_issues,
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        get_cached_doc.return_value = MagicMock(branch="BR-A", company="Test Co")
        get_shift.return_value = {"shift_type": "Day"}
        get_shift_meta.return_value = None

        # Three flags queued; the middle one raises, as a duplicate docname did.
        record_issues.return_value = [
            ("ATTENDANCE_ISSUE", {"reason": "delivery_failed", "undelivered": {"pin": "1"}}),
            ("ATTENDANCE_ISSUE", {"reason": "delivery_failed", "undelivered": {"pin": "2"}}),
            ("ATTENDANCE_ISSUE", {"reason": "single_checkin", "punch_time": "2026-08-03T09:00:00"}),
        ]

        calls = {"n": 0}

        def _maybe_raise(**kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise Exception("Duplicate entry")

        insert_flag.side_effect = _maybe_raise

        # Must not propagate — the caller's own isolation is the last resort,
        # not the mechanism.
        _generate_for_employee_date(employee="EMP-1", attendance_date=date(2026, 8, 3))

        # Assert the PROPERTY, not a count: the flag queued after the failing
        # one was still attempted. Counting total inserts couples the test to
        # whichever branch the fixture happens to take (this one also prepends
        # UNNOTIFIED_ABSENCE), which is how it passed under full discovery and
        # failed in isolation.
        attempted = [c.kwargs.get("evidence", {}).get("reason") for c in insert_flag.call_args_list]
        self.assertIn(
            "single_checkin",
            attempted,
            "the flag queued after the failure was never attempted -- "
            "the raise escaped the loop instead of being contained to its own row",
        )
        self.assertGreaterEqual(calls["n"], 3, "the loop stopped early")


class TestSuppressionSurvivesTheWipe(unittest.TestCase):
    """A day whose punches never arrived must not earn a no-show.

    _generate_for_employee_date opens by deleting every AUTO flag for the day,
    and should_skip_absence_flags answers by READING AUTO flags -- the
    DELIVERY_FAILED row and the ATTENDANCE_ISSUE/delivery_failed variant.
    Asked after the delete it reads its own evidence as absent, reports "no
    failure", and the rebuild records an UNNOTIFIED_ABSENCE against someone
    whose device simply never delivered.
    """

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout.should_skip_absence_flags")
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_a_delivery_failure_still_suppresses_after_the_wipe(
        self,
        get_cached_doc,
        get_shift,
        _get_checkins,
        get_shift_meta,
        delete_flags,
        skip_absence,
        insert_flag,
        _record,
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._meta()

        # The marker exists until the wipe runs, and not after -- which is
        # exactly what the real rows do.
        wiped = {"yet": False}
        delete_flags.side_effect = lambda **_kw: wiped.__setitem__("yet", True)
        skip_absence.side_effect = lambda **_kw: not wiped["yet"]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=True,
        )

        codes = [c.kwargs["flag_code"] for c in insert_flag.call_args_list]
        self.assertNotIn("UNNOTIFIED_ABSENCE", codes)

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout.should_skip_absence_flags", return_value=False)
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_the_suppression_is_read_before_the_wipe_not_after(
        self,
        get_cached_doc,
        get_shift,
        _get_checkins,
        get_shift_meta,
        delete_flags,
        skip_absence,
        _insert_flag,
        _record,
    ):
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._meta()

        order = []
        skip_absence.side_effect = lambda **_kw: order.append("check") or False
        delete_flags.side_effect = lambda **_kw: order.append("delete")

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=True,
        )

        self.assertEqual(order[0], "check", f"read after the wipe: {order}")
        self.assertEqual(order.count("check"), 1, "asked more than once")

    # --- the marker survives the wipe, not just the read ---------------------

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout.delivery_failure_marker_names")
    @patch("dewey_time.attendance_engine.closeout.should_skip_absence_flags", return_value=True)
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_the_marker_is_spared_when_nothing_will_rebuild_it(
        self,
        get_cached_doc,
        get_shift,
        _get_checkins,
        get_shift_meta,
        delete_flags,
        _skip_absence,
        marker_names,
        _insert_flag,
        _record,
    ):
        # Reading before the delete bought one correct run. The delete still
        # destroyed the marker, so run two read "no failure" and manufactured
        # the no-show regardless.
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._meta()
        marker_names.return_value = ["FLAG-DELIVERY-1", "FLAG-ISSUE-7"]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=True,
        )

        self.assertEqual(len(delete_flags.call_args_list), 2, "both deletes still run")
        for call_ in delete_flags.call_args_list:
            self.assertEqual(
                call_.kwargs.get("exclude_names"),
                ["FLAG-DELIVERY-1", "FLAG-ISSUE-7"],
                "the marker rows must survive both wipes",
            )

    @patch("dewey_time.attendance_engine.closeout.evaluate_record_issue_flags", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._insert_flag")
    @patch("dewey_time.attendance_engine.closeout.delivery_failure_marker_names")
    @patch("dewey_time.attendance_engine.closeout.should_skip_absence_flags", return_value=True)
    @patch("dewey_time.attendance_engine.closeout._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.closeout._get_shift_meta")
    @patch("dewey_time.attendance_engine.closeout._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.closeout._get_shift_assignment")
    @patch("dewey_time.attendance_engine.closeout.frappe.get_cached_doc")
    def test_the_webhook_still_wipes_the_marker_it_is_about_to_rebuild(
        self,
        get_cached_doc,
        get_shift,
        _get_checkins,
        get_shift_meta,
        delete_flags,
        _skip_absence,
        marker_names,
        _insert_flag,
        _record,
    ):
        # The one caller that DOES rebuild. Sparing the old rows here would
        # leave them beside the freshly emitted ones -- the protection has to
        # be exactly as narrow as "nothing will put this back".
        from dewey_time.attendance_engine.closeout import _generate_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._meta()
        marker_names.return_value = ["FLAG-DELIVERY-1"]

        _generate_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            include_unnotified_absence=True,
            undelivered_items=[{"pin": "1"}],
        )

        for call_ in delete_flags.call_args_list:
            self.assertFalse(
                call_.kwargs.get("exclude_names"),
                "the webhook re-emits these; sparing them would duplicate",
            )
        marker_names.assert_not_called()

    @staticmethod
    def _meta():
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        return enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": dt_time(17, 0),
                "custom_grace_minutes": 5,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
            }
        )


class TestDeliveryFailureMarkerNames(unittest.TestCase):
    """One query answers both "was there a failure" and "which rows say so".

    They must never diverge: a predicate reading one set while the delete
    protects another leaves a gap, and the gap is a destroyed marker whose
    absence then reads as "no failure".
    """

    def setUp(self):
        # Restored on teardown. This is the shared frappe mock every test file
        # imports, so a side_effect left behind answers get_all for every
        # module that runs after this one -- precisely how a red CI got made.
        frappe = sys.modules["frappe"]
        self.frappe = frappe
        previous = frappe.get_all
        self.addCleanup(setattr, frappe, "get_all", previous)

        def get_all(_doctype, filters=None, **kwargs):
            code = (filters or {}).get("flag_code")
            if code == "DELIVERY_FAILED":
                return ["FLAG-DELIVERY-1"]
            if code == "ATTENDANCE_ISSUE":
                return [
                    {"name": "FLAG-ISSUE-1", "evidence": '{"reason": "single_checkin"}'},
                    {"name": "FLAG-ISSUE-2", "evidence": '{"reason": "delivery_failed"}'},
                    {"name": "FLAG-ISSUE-3", "evidence": None},
                ]
            return []

        frappe.get_all = MagicMock(side_effect=get_all)

    def test_only_the_delivery_failed_variant_of_attendance_issue_counts(self):
        from dewey_time.attendance_engine.closeout import delivery_failure_marker_names

        names = delivery_failure_marker_names("EMP-1", date(2026, 5, 27))

        self.assertEqual(names, ["FLAG-DELIVERY-1", "FLAG-ISSUE-2"])
        # The others are ordinary findings the rebuild will recreate. Sparing
        # them would leave a stale row beside its own replacement.
        self.assertNotIn("FLAG-ISSUE-1", names)
        self.assertNotIn("FLAG-ISSUE-3", names)

    def test_the_predicate_is_the_same_question_as_the_protection(self):
        from dewey_time.attendance_engine.closeout import (
            delivery_failure_marker_names,
            has_delivery_or_record_failure_today,
        )

        self.assertTrue(has_delivery_or_record_failure_today("EMP-1", date(2026, 5, 27)))

        self.frappe.get_all = MagicMock(return_value=[])
        self.assertEqual(delivery_failure_marker_names("EMP-1", date(2026, 5, 27)), [])
        self.assertFalse(has_delivery_or_record_failure_today("EMP-1", date(2026, 5, 27)))


class TestDeleteExcludesProtectedNames(unittest.TestCase):
    def setUp(self):
        frappe = sys.modules["frappe"]
        self.frappe = frappe
        previous = frappe.db.delete
        self.addCleanup(setattr, frappe.db, "delete", previous)
        frappe.db.delete = MagicMock()

    def test_exclusion_is_by_name_so_siblings_in_the_same_code_still_go(self):
        from dewey_time.attendance_engine.closeout import (
            _delete_auto_flags_for_employee_date,
        )

        _delete_auto_flags_for_employee_date(
            employee="EMP-1",
            attendance_date=date(2026, 5, 27),
            day_closed=1,
            exclude_names=["FLAG-ISSUE-2"],
        )

        filters = self.frappe.db.delete.call_args.args[1]
        self.assertEqual(filters["name"], ["not in", ["FLAG-ISSUE-2"]])
        # Not scoped to a code: ATTENDANCE_ISSUE rows carrying other reasons
        # are still inside the wipe.
        self.assertNotIn("flag_code", filters)

    def test_no_exclusion_filter_when_nothing_is_protected(self):
        from dewey_time.attendance_engine.closeout import (
            _delete_auto_flags_for_employee_date,
        )

        _delete_auto_flags_for_employee_date(
            employee="EMP-1", attendance_date=date(2026, 5, 27), day_closed=1, exclude_names=[]
        )

        self.assertNotIn("name", self.frappe.db.delete.call_args.args[1])


class TestPrelaunchGuard(unittest.TestCase):
    """A day before the branch's cutoff earns no flags and loses none."""

    def _run_closeout(self, phase):
        from dewey_time.attendance_engine import closeout

        employee_doc = MagicMock()
        employee_doc.branch = "BR-A"
        # None, not a real company: a truthy company sends the LIVE control path
        # through holiday_by_date_for_company, which is not what this test is about.
        employee_doc.company = None
        with patch.object(closeout.frappe, "get_cached_doc", return_value=employee_doc), patch.object(
            closeout.rollout, "phase_for", return_value=phase
        ) as phase_for, patch.object(
            closeout, "_delete_auto_flags_for_employee_date"
        ) as delete, patch.object(
            closeout, "_insert_flags"
        ) as insert, patch.object(
            closeout, "should_skip_absence_flags", return_value=False
        ), patch.object(
            closeout, "_get_shift_assignment", return_value=None
        ):
            closeout._generate_for_employee_date(
                employee="EMP-1", attendance_date=date(2026, 8, 1)
            )
        return delete, insert, phase_for

    def test_prelaunch_writes_nothing_and_deletes_nothing(self):
        from dewey_time.attendance_engine import rollout

        delete, insert, _phase_for = self._run_closeout(rollout.PRELAUNCH)
        delete.assert_not_called()
        insert.assert_not_called()

    def test_a_live_day_still_reaches_the_delete(self):
        # The control. Without it, a guard that always returned early would pass
        # the test above and this suite would be asserting nothing.
        from dewey_time.attendance_engine import rollout

        delete, _insert, _phase_for = self._run_closeout(rollout.LIVE)
        self.assertTrue(delete.called)

    def test_the_guard_asks_about_this_employees_branch_and_this_day(self):
        # WHICH question the guard asks, not just that it obeys the answer. Both
        # tests above patch phase_for with a fixed return, so a guard written as
        # phase_for(branch=employee_company, ...) -- or with branch hardcoded to
        # None -- passes them, and the bench matrix cannot tell the difference
        # either because it only ever configures the GLOBAL dates. Per-branch
        # cutoffs are the point of the feature, so this is the line that has to
        # be pinned. employee_doc.company is None here, which is exactly what
        # makes the employee_company mutation visible.
        from dewey_time.attendance_engine import rollout

        _delete, _insert, phase_for = self._run_closeout(rollout.PRELAUNCH)
        phase_for.assert_called_once_with(
            branch="BR-A", attendance_date=date(2026, 8, 1)
        )


class TestCompanyFallbackPrelaunchGuard(unittest.TestCase):
    def _run_fallback(self, phase):
        from dewey_time.attendance_engine import closeout

        employee_doc = MagicMock()
        employee_doc.branch = "BR-A"
        with patch.object(closeout.frappe, "get_all", return_value=["EMP-1"]), patch.object(
            closeout.frappe, "get_cached_doc", return_value=employee_doc
        ), patch.object(
            closeout.rollout, "phase_for", return_value=phase
        ) as phase_for, patch.object(
            closeout, "has_open_device_closeout_alert", return_value=False
        ), patch.object(
            closeout, "_get_shift_assignment", return_value={"shift_type": "S1"}
        ) as shift:
            closeout._generate_company_fallback_for_date(
                company="CO-A", attendance_date=date(2026, 8, 1)
            )
        return shift, phase_for

    def test_prelaunch_skips_the_employee_before_any_work(self):
        from dewey_time.attendance_engine import rollout

        shift, _phase_for = self._run_fallback(rollout.PRELAUNCH)
        shift.assert_not_called()

    def test_a_live_day_still_reads_the_shift(self):
        from dewey_time.attendance_engine import rollout

        shift, _phase_for = self._run_fallback(rollout.LIVE)
        self.assertTrue(shift.called)

    def test_the_guard_asks_about_each_employees_branch_and_this_day(self):
        # This loop runs over one company whose branches can be in different
        # phases, so asking about the company -- or about nothing at all --
        # would skip or keep the wrong people while every other test here
        # stayed green. See the matching pin in TestPrelaunchGuard.
        from dewey_time.attendance_engine import rollout

        _shift, phase_for = self._run_fallback(rollout.PRELAUNCH)
        phase_for.assert_called_once_with(
            branch="BR-A", attendance_date=date(2026, 8, 1)
        )


class TestInsertFlagStampsPhase(unittest.TestCase):
    """_insert_flag (closeout.py:809) is the sole insert for every AUTO flag in the
    app -- _insert_flags routes to it, and so do closeout.py:301 and
    intraday.py:136,176,194. Stamping here is what makes it impossible for a call
    site added later to forget the field."""

    def _inserted_doc(self, phase):
        from dewey_time.attendance_engine import closeout

        with patch.object(closeout.frappe, "get_doc") as get_doc, patch.object(
            closeout.rollout, "phase_for_employee", return_value=phase
        ):
            closeout._insert_flag(
                employee="EMP-1",
                company="CO-A",
                attendance_date=date(2026, 8, 20),
                flag_code="LATE_START",
                evidence={},
            )
        return get_doc.call_args[0][0]

    def test_a_pilot_window_flag_is_stamped_testing(self):
        from dewey_time.attendance_engine import rollout

        self.assertEqual(
            self._inserted_doc(rollout.TESTING)["rollout_phase"], "TESTING"
        )

    def test_a_post_launch_flag_is_stamped_live(self):
        from dewey_time.attendance_engine import rollout

        self.assertEqual(self._inserted_doc(rollout.LIVE)["rollout_phase"], "LIVE")

    def test_the_phase_comes_from_the_flags_own_date_not_from_today(self):
        # The property that makes regeneration idempotent. intraday re-inserts AUTO
        # flags on EVERY checkin, so a phase read from the current date would
        # re-label the whole pilot window the moment go-live passed.
        from dewey_time.attendance_engine import closeout

        with patch.object(closeout.frappe, "get_doc"), patch.object(
            closeout.rollout, "phase_for_employee"
        ) as phase_for_employee:
            closeout._insert_flag(
                employee="EMP-1",
                company="CO-A",
                attendance_date=date(2026, 8, 20),
                flag_code="LATE_START",
                evidence={},
            )
        self.assertEqual(
            phase_for_employee.call_args.kwargs["attendance_date"], date(2026, 8, 20)
        )

    def test_phase_for_employee_is_called_with_this_flags_own_employee_and_date(self):
        # The other three tests patch phase_for_employee's return value or only
        # inspect one kwarg, so a stamp built from the wrong employee's branch
        # (or from a stale/hardcoded date) would be invisible to them. This test
        # pins both arguments together.
        from dewey_time.attendance_engine import closeout

        with patch.object(closeout.frappe, "get_doc"), patch.object(
            closeout.rollout, "phase_for_employee"
        ) as phase_for_employee:
            closeout._insert_flag(
                employee="EMP-1",
                company="CO-A",
                attendance_date=date(2026, 8, 20),
                flag_code="LATE_START",
                evidence={},
            )
        phase_for_employee.assert_called_once_with(
            employee="EMP-1", attendance_date=date(2026, 8, 20)
        )
