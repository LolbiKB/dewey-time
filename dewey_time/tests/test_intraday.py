import unittest
from datetime import date, datetime, time as dt_time
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock


_install_frappe_mock()


class TestIntradayRefresh(unittest.TestCase):
    @patch("dewey_time.attendance_engine.intraday.evaluate_missing_time_flags")
    @patch("dewey_time.attendance_engine.intraday._insert_flag")
    @patch("dewey_time.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.missing_time_max_end_min_for_date", return_value=660)
    @patch(
        "dewey_time.attendance_engine.intraday._get_checkins_for_day",
        return_value=[
            {
                "name": "IN-1",
                "time": datetime(2026, 5, 28, 8, 0),
                "custom_device_branch": "BRANCH-A",
            }
        ],
    )
    @patch("dewey_time.attendance_engine.intraday._get_shift_meta")
    @patch("dewey_time.attendance_engine.intraday._get_shift_assignment")
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.get_cached_doc")
    def test_missing_time_is_written_provisionally(
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


class TestIntradayNoShow(unittest.TestCase):
    """Zero punches reads as 'Did not show up', not as missing-time fragments.

    Closeout already says this (closeout.py:568) and skips MISSING_TIME the
    same way. Intraday could not, because it withholds UNNOTIFIED_ABSENCE for
    a day that is not over -- so it said nothing, and MISSING_TIME filled the
    silence in the least legible available shape.
    """

    def _shift_meta(self):
        from dewey_time.attendance_engine.shift_grace import enrich_shift_meta

        return enrich_shift_meta(
            {
                "start_time": dt_time(8, 0),
                "end_time": dt_time(17, 0),
                "custom_lunch_start": dt_time(12, 0),
                "custom_lunch_end": dt_time(13, 0),
                "custom_grace_minutes": 5,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 0,
            }
        )

    def _employee(self):
        employee = MagicMock()
        employee.branch = "BRANCH-A"
        employee.company = "Test Co"
        return employee

    MISSING = [
        (
            "MISSING_TIME",
            {
                "interval_start": "2026-05-28T08:00:00",
                "interval_end": "2026-05-28T17:00:00",
                "minutes": 480,
                "kind": "leading",
                "threshold_minutes": 30,
            },
        )
    ]

    @patch("dewey_time.attendance_engine.intraday.evaluate_missing_time_flags")
    @patch("dewey_time.attendance_engine.intraday._insert_flag")
    @patch("dewey_time.attendance_engine.intraday.has_delivery_or_record_failure_today", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.has_open_device_closeout_alert", return_value=False)
    @patch("dewey_time.attendance_engine.intraday.missing_time_max_end_min_for_date", return_value=900)
    @patch("dewey_time.attendance_engine.intraday._get_checkins_for_day", return_value=[])
    @patch("dewey_time.attendance_engine.intraday._get_shift_meta")
    @patch("dewey_time.attendance_engine.intraday._get_shift_assignment")
    @patch("dewey_time.attendance_engine.intraday._delete_auto_flags_for_employee_date")
    @patch("dewey_time.attendance_engine.intraday.frappe.get_cached_doc")
    def _run(
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
        *,
        missing=None,
        checkins=None,
        open_alert=False,
        delivery_failed=False,
    ):
        """Drive one intraday refresh and hand back the mocks worth asserting."""
        from dewey_time.attendance_engine.intraday import (
            refresh_intraday_flags_for_employee_date,
        )

        get_cached_doc.return_value = self._employee()
        get_shift.return_value = {"shift_type": "FT_0800_1700"}
        get_shift_meta.return_value = self._shift_meta()
        evaluate_missing.return_value = self.MISSING if missing is None else missing
        _checkins.return_value = checkins or []
        _open_alert.return_value = open_alert
        _delivery_failed.return_value = delivery_failed

        refresh_intraday_flags_for_employee_date("DI-1138", date(2026, 5, 28))
        return insert_flag, delete_flags

    @staticmethod
    def _codes(insert_flag):
        return [c.kwargs["flag_code"] for c in insert_flag.call_args_list]

    def test_zero_punches_raises_one_no_show_and_no_missing_time(self):
        insert_flag, _ = self._run()

        # NO_CHECKIN_YET, not UNNOTIFIED_ABSENCE. The intraday pass describes a
        # day nobody has finished; the absence is closeout's verdict. Writing
        # the verdict early is what forced flag_triage to carry a special case
        # downranking it, and what the Mini App had to filter out so an employee
        # whose leave was not yet keyed in did not carry an accusation all
        # morning.
        self.assertEqual(self._codes(insert_flag), ["NO_CHECKIN_YET"])

    def test_the_absence_is_left_to_closeout(self):
        # The pairing this whole code exists for. If intraday ever writes
        # UNNOTIFIED_ABSENCE again, a CRITICAL verdict about a finished day
        # reappears on a morning that is still running.
        insert_flag, _ = self._run()

        self.assertNotIn("UNNOTIFIED_ABSENCE", self._codes(insert_flag))

    def test_the_old_provisional_absence_is_still_deleted(self):
        # INTRADAY_FLAG_CODES is the DELETE list, not the write list. Every site
        # has open provisional UNNOTIFIED_ABSENCE rows from before this change,
        # and nothing else removes a provisional row -- drop the code from the
        # list and yesterday's no-show sits in the queue as a CRITICAL forever,
        # surviving the punch that disproved it.
        from dewey_time.attendance_engine.intraday import INTRADAY_FLAG_CODES

        self.assertIn("UNNOTIFIED_ABSENCE", INTRADAY_FLAG_CODES)
        self.assertIn("NO_CHECKIN_YET", INTRADAY_FLAG_CODES)

    def test_the_no_show_is_provisional_and_names_its_origin(self):
        insert_flag, _ = self._run()

        kwargs = insert_flag.call_args_list[0].kwargs
        self.assertEqual(kwargs["day_closed"], 0)
        self.assertEqual(
            kwargs["evidence"]["reason"], "on_shift_no_checkins_intraday"
        )
        # The frontend's "Punches: 0" fact reads this, and the zero IS the
        # finding (flagNarrative.test.ts:1198).
        self.assertEqual(kwargs["evidence"]["checkins_count"], 0)
        # `provisional` no longer drives the rank -- triage_rank bands
        # NO_CHECKIN_YET on the code alone now, which is the point of using the
        # right code. It stays in the evidence because the frontend reads it and
        # because the legacy UNNOTIFIED_ABSENCE branch in flag_triage still keys
        # on it while old rows drain.
        self.assertIs(kwargs["evidence"]["provisional"], True)

    def test_below_the_threshold_nothing_is_raised_at_all(self):
        # No interval cleared absence_threshold_minutes, so today no
        # MISSING_TIME row would exist either. The no-show must not appear
        # earlier than the row it replaces.
        insert_flag, _ = self._run(missing=[])

        self.assertEqual(self._codes(insert_flag), [])

    def test_an_open_device_alert_suppresses_the_no_show(self):
        # A dead device must not produce a branch-wide wave of no-shows.
        insert_flag, _ = self._run(open_alert=True)

        self.assertEqual(self._codes(insert_flag), [])

    def test_a_delivery_failure_suppresses_the_no_show(self):
        insert_flag, _ = self._run(delivery_failed=True)

        self.assertEqual(self._codes(insert_flag), [])

    def test_the_provisional_no_show_is_cleaned_up_on_the_next_pass(self):
        # The self-healing guarantee. Intraday deletes its own previous
        # provisional rows scoped to INTRADAY_FLAG_CODES; if UNNOTIFIED_ABSENCE
        # is missing from that list the no-show survives the employee actually
        # turning up, and they are recorded absent for a day they worked.
        from dewey_time.attendance_engine.intraday import INTRADAY_FLAG_CODES

        self.assertIn("UNNOTIFIED_ABSENCE", INTRADAY_FLAG_CODES)

        _, delete_flags = self._run()
        self.assertIn(
            "UNNOTIFIED_ABSENCE", delete_flags.call_args.kwargs["flag_codes"]
        )

    def test_the_no_show_carries_the_minutes_it_stands_in_for(self):
        # triage_rank cannot band a provisional no-show without them, and the
        # queue would put a 31-minute absence above every real ATTENDANCE_ISSUE.
        insert_flag, _ = self._run()

        self.assertEqual(insert_flag.call_args_list[0].kwargs["evidence"]["minutes"], 480)


class TestIntradayPrelaunchGuard(unittest.TestCase):
    def _run(self, phase):
        from dewey_time.attendance_engine import intraday

        employee_doc = MagicMock()
        employee_doc.branch = "BR-A"
        employee_doc.company = None
        with patch.object(intraday.frappe, "get_cached_doc", return_value=employee_doc), patch.object(
            intraday.rollout, "phase_for", return_value=phase
        ) as phase_for, patch.object(
            intraday, "_delete_auto_flags_for_employee_date"
        ) as delete, patch.object(
            intraday, "_get_shift_assignment", return_value=None
        ):
            intraday.refresh_intraday_flags_for_employee_date("EMP-1", date(2026, 8, 1))
        return delete, phase_for

    def test_prelaunch_does_not_reach_the_delete(self):
        # The delete used to be the first statement in this function. If the guard is
        # placed after it, this test fails -- which is the whole point of it.
        from dewey_time.attendance_engine import rollout

        delete, _phase_for = self._run(rollout.PRELAUNCH)
        self.assertFalse(delete.called)

    def test_a_live_day_still_deletes(self):
        from dewey_time.attendance_engine import rollout

        delete, _phase_for = self._run(rollout.LIVE)
        self.assertTrue(delete.called)

    def test_the_guard_asks_about_this_employees_branch_and_this_day(self):
        # Both tests above patch phase_for with a fixed return, so a guard that
        # asked about the company, or about no branch at all, would pass them --
        # and the bench matrix only ever configures the global dates, so it
        # cannot separate the two either. employee_doc.company is None here,
        # which is what makes an employee_company mutation visible.
        from dewey_time.attendance_engine import rollout

        _delete, phase_for = self._run(rollout.PRELAUNCH)
        phase_for.assert_called_once_with(
            branch="BR-A", attendance_date=date(2026, 8, 1)
        )
