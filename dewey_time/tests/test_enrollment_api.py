import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import enrollment_api as mod  # noqa: E402
from dewey_time.attendance_engine import enrollment_buckets as buckets  # noqa: E402


def _emp(emp_id, *, status="Active", branch="ACES", dept="Ops", relieving=None):
    return {
        "name": emp_id,
        "employee_name": "Name %s" % emp_id,
        "status": status,
        "branch": branch,
        "department": dept,
        "relieving_date": relieving,
    }


def _reg(emp_id, *, registered=True, fp=1):
    return {
        "employee": emp_id,
        "is_registered": 1 if registered else 0,
        "fingerprint_count": fp,
        "face_count": 0,
    }


class BuildPayloadTest(unittest.TestCase):
    def _build(self, employees, register, checkins, *, snapshot="2026-08-11 09:14:03"):
        with patch.object(mod, "_list_employees", return_value=employees), patch.object(
            mod, "_register_rows", return_value=register
        ), patch.object(
            mod, "_checkin_counts", return_value=checkins
        ), patch.object(
            mod, "_last_snapshot_at", return_value=snapshot
        ), patch.object(
            mod, "_today", return_value=date(2026, 8, 11)
        ):
            return mod._build_enrollment_payload()

    def test_an_unenrolled_active_employee_lands_in_the_worklist(self):
        payload = self._build([_emp("E1")], [], {})
        self.assertEqual(payload["rows"][0]["bucket"], buckets.NEEDS_ENROLLMENT)
        self.assertEqual(payload["counts"]["needs_enrollment"], 1)

    def test_branch_and_department_come_from_employee_not_the_register(self):
        """Joined at read time so a transfer cannot leave the report stale."""
        payload = self._build([_emp("E1", branch="DIU", dept="Finance")], [_reg("E1")], {"E1": 2})
        row = payload["rows"][0]
        self.assertEqual(row["branch"], "DIU")
        self.assertEqual(row["department"], "Finance")

    def test_a_leaver_with_a_live_template_reports_days_since(self):
        payload = self._build(
            [_emp("E1", status="Left", relieving=date(2026, 8, 1))], [_reg("E1")], {"E1": 400}
        )
        row = payload["rows"][0]
        self.assertEqual(row["bucket"], buckets.LEAVER_STILL_ENROLLED)
        self.assertEqual(row["days_since_relieving"], 10)

    def test_out_of_population_employees_are_counted_not_dropped(self):
        """Silently omitting them makes the totals not add up, which reads as
        a bug in the report rather than a deliberate exclusion."""
        payload = self._build(
            [_emp("E1"), _emp("E2", status="Suspended"), _emp("E3", status="Inactive")], [], {}
        )
        self.assertEqual(len(payload["rows"]), 1)
        self.assertEqual(payload["counts"]["excluded_status"], 2)

    def test_a_cleanly_offboarded_leaver_is_neither_reported_nor_counted(self):
        """The second, deliberate reason classify() returns None.

        A Left employee with no template has already been dealt with: there is
        nothing for HR to do, so they get no row AND no exclusion count. That
        makes reported + excluded_status strictly less than len(employees) --
        on purpose. Pinned so the next reader who "fixes the totals" starts
        counting clean leavers as excluded in an obviously-failing test rather
        than shipping a page that lists work that does not exist.
        """
        payload = self._build(
            [_emp("E1", status="Left", relieving=date(2026, 8, 1))], [], {}
        )
        self.assertEqual(payload["rows"], [])
        self.assertEqual(payload["counts"]["excluded_status"], 0)
        self.assertEqual(payload["counts"]["reported"], 0)
        self.assertEqual(payload["counts"]["leaver_still_enrolled"], 0)

    def test_a_never_synced_feed_reports_a_null_snapshot(self):
        """The client refuses to render a list on this. Without it every
        employee reads as unenrolled and HR acts on a plumbing failure."""
        payload = self._build([_emp("E1")], [], {}, snapshot=None)
        self.assertIsNone(payload["last_snapshot_at"])

    def test_the_scan_cap_sets_truncated(self):
        employees = [_emp("E%d" % i) for i in range(mod.ENROLLMENT_EMPLOYEE_LIMIT)]
        payload = self._build(employees, [], {})
        self.assertTrue(payload["counts"]["truncated"])

    def test_the_window_is_reported_so_the_ui_need_not_hardcode_it(self):
        payload = self._build([_emp("E1")], [], {})
        self.assertEqual(payload["window_days"], mod.NOT_PUNCHING_WINDOW_DAYS)

    def test_the_payload_costs_three_queries_not_one_per_employee(self):
        """A per-employee query passes every other test in this file while
        making a 237-employee page do hundreds of round trips."""
        calls = []

        def _get_all(doctype, **kwargs):
            calls.append(doctype)
            if doctype == "Employee":
                return [_emp("E%d" % i) for i in range(50)]
            return []

        with patch.object(mod.frappe, "get_all", side_effect=_get_all), patch.object(
            mod, "_checkin_counts", return_value={}
        ) as checkin_counts, patch.object(
            mod.frappe.db, "get_single_value", return_value="2026-08-11 09:14:03"
        ), patch.object(mod, "_today", return_value=date(2026, 8, 11)):
            mod._build_enrollment_payload()

        # Two get_all calls plus ONE aggregate, for 50 employees. The aggregate
        # is counted separately because it is built with frappe.qb rather than
        # get_all -- Frappe v16 rejects `count(name) as n` as a SELECT string.
        self.assertEqual(calls, ["Employee", mod.ENROLLMENT_DOCTYPE])
        checkin_counts.assert_called_once()

    def test_a_cleared_snapshot_marker_reads_as_never_reported(self):
        """Clearing a Single's Datetime stores 0001-01-01, not NULL, and that
        is TRUTHY. The client's feed gate is a truthiness check, so without
        normalising it a cleared marker would render the whole roster as
        unenrolled -- the exact plumbing-failure-as-data misreading the gate
        exists to prevent. Observed on a real bench.
        """
        from datetime import datetime

        for cleared in (datetime(1, 1, 1, 0, 0), "0001-01-01 00:00:00", None, ""):
            with self.subTest(cleared=cleared):
                with patch.object(
                    mod.frappe.db, "get_single_value", return_value=cleared
                ):
                    self.assertIsNone(mod._last_snapshot_at())

    def test_a_real_snapshot_marker_survives_normalisation(self):
        with patch.object(
            mod.frappe.db, "get_single_value", return_value="2026-08-11 09:14:03"
        ):
            self.assertEqual(mod._last_snapshot_at(), "2026-08-11 09:14:03")


class _Column:
    """A qb column that records the one comparison the aggregate makes.

    A bare MagicMock cannot stand in here: MagicMock's ordering methods return
    NotImplemented, so `checkin.time >= since` raises TypeError instead of
    producing a predicate.
    """

    def __init__(self, name):
        self.name = name

    def __ge__(self, other):
        return ("ge", self.name, other)


class _FakeTable:
    def __init__(self):
        object.__setattr__(self, "_cols", {})

    def __getattr__(self, name):
        cols = object.__getattribute__(self, "_cols")
        if name not in cols:
            cols[name] = _Column(name)
        return cols[name]


class CheckinCountsTest(unittest.TestCase):
    """The aggregate itself -- the one function every other test here patches
    away.

    That blanket patching is exactly how `fields=["count(name) as n"]` took the
    whole report down while all sixteen tests stayed green: Frappe v16 rejects
    SQL functions written as strings in SELECT, `_checkin_counts` is called
    unconditionally, and no test ever executed its body. These do.
    """

    def _run(self, rows, *, since="2026-07-12 00:00:00"):
        query = MagicMock(name="query")
        query.select.return_value = query
        query.where.return_value = query
        query.groupby.return_value = query
        query.run.return_value = rows

        table = _FakeTable()
        qb = MagicMock(name="qb")
        qb.DocType.return_value = table
        qb.from_.return_value = query

        with patch.object(mod.frappe, "qb", qb), patch.object(
            mod.frappe, "get_all"
        ) as get_all, patch.object(mod, "Count") as count:
            result = mod._checkin_counts(since)

        return result, {
            "qb": qb,
            "query": query,
            "table": table,
            "get_all": get_all,
            "count": count,
        }

    def test_the_aggregate_returns_one_count_per_employee(self):
        result, _ = self._run([{"employee": "E1", "n": 3}, {"employee": "E2", "n": 1}])
        self.assertEqual(result, {"E1": 3, "E2": 1})

    def test_an_empty_result_is_an_empty_map_not_a_crash(self):
        result, _ = self._run([])
        self.assertEqual(result, {})

    def test_the_count_is_built_by_the_query_builder_never_a_select_string(self):
        """The regression pin for the v16 rejection.

        Reverting the body to `frappe.get_all(..., fields=["count(name) as n"])`
        leaves every other test in this file green, because they all patch
        _checkin_counts wholesale. These two assertions are the only thing in
        the suite that notices.
        """
        _, spy = self._run([])
        spy["qb"].from_.assert_called_once_with(spy["table"])
        spy["get_all"].assert_not_called()
        spy["count"].assert_called_once_with(spy["table"].name)
        spy["query"].run.assert_called_once_with(as_dict=True)

    def test_the_window_bound_reaches_the_query(self):
        """Without this the aggregate would silently count the whole history,
        and every ENROLLED_NOT_PUNCHING row would become OK."""
        since = "2026-07-12 00:00:00"
        _, spy = self._run([], since=since)
        spy["query"].where.assert_called_once_with(("ge", "time", since))
        spy["query"].groupby.assert_called_once_with(spy["table"].employee)


class SeamTest(unittest.TestCase):
    def test_enrollment_status_answers_for_one_employee(self):
        """The seam a future onboarding checklist calls, without the page."""
        with patch.object(mod.frappe.db, "get_value", return_value={
            "employee": "E1", "is_registered": 1, "fingerprint_count": 2,
            "face_count": 0, "synced_at": "2026-08-11 09:14:03",
        }), patch.object(mod, "_last_snapshot_at", return_value="2026-08-11 09:14:03"):
            status = mod.enrollment_status("E1")
        self.assertTrue(status["is_registered"])
        self.assertEqual(status["fingerprint_count"], 2)

    def test_a_renamed_employee_is_still_found_by_field_not_by_docname(self):
        """The docname is not a safe key here, for the same reason the upsert
        stopped using it: frappe.rename_doc on an Employee moves the `employee`
        field without moving the row's name. A by-name lookup then finds
        nothing, and this seam -- the documented interface an onboarding or
        offboarding checklist is meant to call -- answers is_registered: False
        for someone who is enrolled. Confidently, silently, and wrongly.
        """
        stored = {
            "employee": "HR-EMP-NEW",
            "is_registered": 1,
            "fingerprint_count": 2,
            "face_count": 0,
            "synced_at": "2026-08-11 09:14:03",
        }

        def _get_value(doctype, filters, fields, as_dict=False):
            # The row is still named HR-EMP-OLD, so only a FIELD filter finds
            # it. A bare "HR-EMP-NEW" name argument matches nothing.
            return stored if filters == {"employee": "HR-EMP-NEW"} else None

        with patch.object(mod.frappe.db, "get_value", side_effect=_get_value), patch.object(
            mod, "_last_snapshot_at", return_value="2026-08-11 09:14:03"
        ):
            status = mod.enrollment_status("HR-EMP-NEW")

        self.assertTrue(status["is_registered"])
        self.assertEqual(status["fingerprint_count"], 2)

    def test_an_employee_with_no_register_row_is_not_registered(self):
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod, "_last_snapshot_at", return_value="2026-08-11 09:14:03"
        ):
            status = mod.enrollment_status("E404")
        self.assertFalse(status["is_registered"])

    def test_the_seam_reports_feed_health_so_callers_cannot_misread_absence(self):
        """Without last_snapshot_at, "not registered" and "we have never heard
        from the bridge" are indistinguishable to a caller."""
        with patch.object(mod.frappe.db, "get_value", return_value=None), patch.object(
            mod, "_last_snapshot_at", return_value=None
        ):
            status = mod.enrollment_status("E1")
        self.assertIsNone(status["last_snapshot_at"])


class PermissionTest(unittest.TestCase):
    def test_non_hr_session_is_rejected_before_the_cache_read_and_any_query(self):
        """The payload is the whole employee roster, so the gate runs first.

        Mirrors test_flag_queue_api's non-HR test. The gate itself is covered by
        test_hr_calendar.py; enrollment_api holds a reference to _require_hr_role,
        which reads hr_calendar's module-global _is_hr_staff, so patching that
        drives it.
        """
        cache = MagicMock()
        get_all = MagicMock(return_value=[])
        with patch(
            "dewey_time.attendance_engine.hr_calendar._is_hr_staff", return_value=False
        ), patch.object(mod.frappe, "cache", cache), patch.object(mod.frappe, "get_all", get_all):
            with self.assertRaisesRegex(Exception, "Not permitted"):
                mod.get_enrollment_report()
            cache.assert_not_called()
            get_all.assert_not_called()


if __name__ == "__main__":
    unittest.main()
