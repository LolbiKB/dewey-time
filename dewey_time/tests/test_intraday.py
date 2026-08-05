import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


class TestIntradayRefresh(unittest.TestCase):
    @patch("dewey_time.attendance_engine.intraday.evaluate_missing_time_flags")
    @patch("dewey_time.attendance_engine.intraday._insert_flag")
    @patch("dewey_time.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.missing_time_max_end_min_for_date", return_value=660)
    @patch("dewey_time.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.intraday._get_shift_meta")
    @patch("dewey_time.attendance_engine.intraday._get_shift_assignment")
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.get_cached_doc")
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
        from dewey_time.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

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
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

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

    @patch("dewey_time.attendance_engine.intraday.evaluate_missing_time_flags", return_value=[])
    @patch("dewey_time.attendance_engine.intraday._insert_flag")
    @patch("dewey_time.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=True)
    @patch("dewey_time.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.intraday._get_shift_meta")
    @patch("dewey_time.attendance_engine.intraday._get_shift_assignment")
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.get_cached_doc")
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
        from dewey_time.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

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

    @patch("dewey_time.attendance_engine.intraday.holiday_by_date_for_company")
    @patch("dewey_time.attendance_engine.intraday._insert_flag")
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday._get_shift_assignment")
    @patch("dewey_time.attendance_engine.intraday.frappe.get_cached_doc")
    def test_intraday_skips_holidays(
        self,
        get_cached_doc,
        get_shift,
        delete_flags,
        insert_flag,
        holiday_by_date,
    ):
        from dewey_time.attendance_engine.intraday import refresh_intraday_flags_for_employee_date

        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        get_cached_doc.return_value = employee
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        holiday_by_date.return_value = {"2026-05-28": {"description": "Holiday", "weekly_off": False}}

        refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 5, 28))

        delete_flags.assert_called_once()
        insert_flag.assert_not_called()


class TestIntradayEnqueue(unittest.TestCase):
    @patch("dewey_time.attendance_engine.intraday.frappe.enqueue")
    def test_checkin_hook_enqueues_coalesced_job(self, enqueue):
        from dewey_time.attendance_engine.intraday import on_employee_checkin_after_insert

        doc = MagicMock()
        doc.employee = "EMP-1"
        doc.time = datetime(2026, 5, 28, 9, 15, 0)

        on_employee_checkin_after_insert(doc)

        enqueue.assert_called_once()
        self.assertTrue(enqueue.call_args.kwargs.get("deduplicate"))
        self.assertIn("dewey_time-intraday", enqueue.call_args.kwargs.get("job_id", ""))


def _real_getdate(value):
    """The frappe mock stubs getdate as identity, which would let a datetime
    reach a `date` comparison and raise. Real frappe.utils.getdate returns a
    date, and the branch under test compares one, so the tests need the real
    narrowing behaviour."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


class _EditedCheckin:
    """Minimal stand-in for an Employee Checkin being saved. MagicMock is wrong
    here: `.get("time")` on one returns a truthy Mock, so the handler's
    did-anything-actually-change guard silently never fires."""

    def __init__(self, employee, time, before=None):
        self.employee = employee
        self.time = time
        self._before = before

    def get(self, key, default=None):
        return getattr(self, key, default)

    def get_doc_before_save(self):
        return self._before


class TestCheckinEditRegeneration(unittest.TestCase):
    """A punch edit on an already-closed date used to delete every AUTO flag for
    that employee/date and then enqueue the intraday pass, which rebuilds only
    MISSING_TIME and NON_PRIMARY_SITE_PUNCH, and only as provisional. Every other
    flag on that day was destroyed with nothing left to rebuild it: the company
    fallback only ever processes yesterday and only emits UNNOTIFIED_ABSENCE, and
    the device webhook fires once per device/date. Correcting a punch is the most
    common HR action while reviewing a flag, so this fired constantly."""

    TODAY = date(2026, 8, 5)

    @patch("dewey_time.attendance_engine.intraday.nowdate", return_value=date(2026, 8, 5))
    @patch("dewey_time.attendance_engine.intraday.getdate", side_effect=_real_getdate)
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.enqueue")
    def test_past_date_edit_rebuilds_the_full_final_set(self, enqueue, delete_flags, _gd, _nd):
        from dewey_time.attendance_engine.intraday import on_employee_checkin_on_update

        before = _EditedCheckin("EMP-1", datetime(2026, 8, 1, 8, 0, 0))
        doc = _EditedCheckin("EMP-1", datetime(2026, 8, 1, 9, 30, 0), before=before)

        on_employee_checkin_on_update(doc)

        # The whole point: closeout's generator, which deletes AND rebuilds both
        # day_closed=0 and =1, not the intraday subset.
        enqueue.assert_called_once()
        self.assertEqual(
            enqueue.call_args.args[0],
            "dewey_time.attendance_engine.closeout._generate_for_employee_date_isolated",
        )
        self.assertEqual(enqueue.call_args.kwargs.get("attendance_date"), "2026-08-01")

        # And crucially NOT the unscoped delete that caused the data loss.
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.intraday.nowdate", return_value=date(2026, 8, 5))
    @patch("dewey_time.attendance_engine.intraday.getdate", side_effect=_real_getdate)
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.enqueue")
    def test_today_edit_keeps_the_intraday_path_and_spares_finals(
        self, enqueue, delete_flags, _gd, _nd
    ):
        from dewey_time.attendance_engine.intraday import on_employee_checkin_on_update

        before = _EditedCheckin("EMP-1", datetime(2026, 8, 5, 8, 0, 0))
        doc = _EditedCheckin("EMP-1", datetime(2026, 8, 5, 9, 30, 0), before=before)

        on_employee_checkin_on_update(doc)

        # Today has not closed out, so the intraday pass is the correct rebuilder
        # and generating day_closed=1 rows mid-shift would invent LEFT_EARLY and
        # UNNOTIFIED_ABSENCE for a day that is not over.
        enqueue.assert_called_once()
        self.assertIn("dewey_time-intraday", enqueue.call_args.kwargs.get("job_id", ""))

        # The delete must be scoped to provisional rows. An early device closeout
        # can already have written finals for today, and deleting those drops into
        # the same nothing-rebuilds-them hole.
        delete_flags.assert_called_once()
        self.assertEqual(delete_flags.call_args.kwargs.get("day_closed"), 0)

    @patch("dewey_time.attendance_engine.intraday.nowdate", return_value=date(2026, 8, 5))
    @patch("dewey_time.attendance_engine.intraday.getdate", side_effect=_real_getdate)
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.enqueue")
    def test_moving_a_punch_across_days_rebuilds_both(self, enqueue, delete_flags, _gd, _nd):
        from dewey_time.attendance_engine.intraday import on_employee_checkin_on_update

        before = _EditedCheckin("EMP-1", datetime(2026, 8, 1, 8, 0, 0))
        doc = _EditedCheckin("EMP-1", datetime(2026, 8, 2, 8, 0, 0), before=before)

        on_employee_checkin_on_update(doc)

        # Both the vacated day and the new one are past, so both get a full rebuild.
        self.assertEqual(enqueue.call_count, 2)
        dates = sorted(c.kwargs.get("attendance_date") for c in enqueue.call_args_list)
        self.assertEqual(dates, ["2026-08-01", "2026-08-02"])
        for call in enqueue.call_args_list:
            self.assertEqual(
                call.args[0],
                "dewey_time.attendance_engine.closeout._generate_for_employee_date_isolated",
            )
        delete_flags.assert_not_called()

    @patch("dewey_time.attendance_engine.intraday.nowdate", return_value=date(2026, 8, 5))
    @patch("dewey_time.attendance_engine.intraday.getdate", side_effect=_real_getdate)
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.enqueue")
    def test_unchanged_punch_touches_nothing(self, enqueue, delete_flags, _gd, _nd):
        from dewey_time.attendance_engine.intraday import on_employee_checkin_on_update

        same = datetime(2026, 8, 1, 8, 0, 0)
        before = _EditedCheckin("EMP-1", same)
        doc = _EditedCheckin("EMP-1", same, before=before)

        on_employee_checkin_on_update(doc)

        enqueue.assert_not_called()
        delete_flags.assert_not_called()
