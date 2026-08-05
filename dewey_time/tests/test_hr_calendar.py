import json
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine.hr_calendar import (
    HR_STAFF_ROLES,
    _employee_linked_to_user,
    _excluded_calendar_employees,
    _filter_auto_flags_for_calendar_day,
    _is_hr_staff,
    _list_calendar_employee_rows,
    _require_calendar_access,
    _shift_schedule_assignment_start_field,
    first_checkin_date_by_employee,
    get_calendar_session,
    is_full_time_employment,
    list_calendar_employees,
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
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.db.has_column") as has_column:
            has_column.side_effect = lambda _dt, col: col == "create_shifts_after"
            self.assertEqual(_shift_schedule_assignment_start_field(), "create_shifts_after")

    def test_ssa_start_field_falls_back_to_from_date(self):
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.db.has_column") as has_column:
            has_column.side_effect = lambda _dt, col: col == "from_date"
            self.assertEqual(_shift_schedule_assignment_start_field(), "from_date")

    def test_first_checkin_date_includes_offshift_rows(self):
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.db.table_exists") as table_exists:
            with patch("dewey_time.attendance_engine.hr_calendar.frappe.db.sql") as sql:
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
    @patch("dewey_time.attendance_engine.hr_calendar.has_open_device_closeout_alert", return_value=True)
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

    @patch("dewey_time.attendance_engine.hr_calendar.has_open_device_closeout_alert", return_value=False)
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


class TestCalendarAccess(unittest.TestCase):
    def test_hr_staff_roles(self):
        self.assertIn("HR User", HR_STAFF_ROLES)
        self.assertIn("HR Manager", HR_STAFF_ROLES)
        self.assertIn("System Manager", HR_STAFF_ROLES)

    @patch("dewey_time.attendance_engine.hr_calendar.frappe.get_roles")
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.session.user", "hr@example.com")
    def test_is_hr_staff_for_hr_user(self, get_roles):
        get_roles.return_value = ["HR User"]
        self.assertTrue(_is_hr_staff())

    @patch("dewey_time.attendance_engine.hr_calendar.frappe.get_roles")
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.session.user", "emp@example.com")
    def test_is_hr_staff_false_for_employee(self, get_roles):
        get_roles.return_value = ["Employee"]
        self.assertFalse(_is_hr_staff())

    @patch("dewey_time.attendance_engine.hr_calendar.frappe.db.get_value")
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.session.user", "emp@example.com")
    def test_employee_linked_to_user(self, get_value):
        get_value.return_value = "EMP-001"
        self.assertEqual(_employee_linked_to_user(), "EMP-001")
        get_value.assert_called_once_with(
            "Employee",
            {"user_id": "emp@example.com", "status": "Active"},
            "name",
        )

    @patch("dewey_time.attendance_engine.hr_calendar._employee_linked_to_user", return_value="EMP-001")
    @patch("dewey_time.attendance_engine.hr_calendar._is_hr_staff", return_value=False)
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.session.user", "emp@example.com")
    def test_require_calendar_access_allows_self(self, _hr, _linked):
        _require_calendar_access("EMP-001")

    @patch("dewey_time.attendance_engine.hr_calendar._employee_linked_to_user", return_value="EMP-001")
    @patch("dewey_time.attendance_engine.hr_calendar._is_hr_staff", return_value=False)
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.throw")
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.session.user", "emp@example.com")
    def test_require_calendar_access_blocks_other_employee(self, throw, _hr, _linked):
        _require_calendar_access("EMP-999")
        throw.assert_called_once()

    @patch("dewey_time.attendance_engine.hr_calendar._employee_linked_to_user", return_value="EMP-001")
    @patch("dewey_time.attendance_engine.hr_calendar._is_hr_staff", return_value=False)
    @patch("dewey_time.attendance_engine.hr_calendar.frappe.session.user", "emp@example.com")
    def test_get_calendar_session_personal(self, _hr, _linked):
        out = get_calendar_session()
        self.assertEqual(out, {"hr_staff": False, "employee_id": "EMP-001"})

    @patch("dewey_time.attendance_engine.hr_calendar._list_calendar_employee_rows")
    @patch("dewey_time.attendance_engine.hr_calendar._employee_linked_to_user", return_value="EMP-001")
    @patch("dewey_time.attendance_engine.hr_calendar._is_hr_staff", return_value=False)
    def test_list_calendar_employees_personal_scope(self, _hr, _linked, list_rows):
        list_rows.return_value = [{"id": "EMP-001"}]
        out = list_calendar_employees()
        list_rows.assert_called_once_with(["EMP-001"], include_all=True)
        self.assertEqual(
            out,
            {"employees": [{"id": "EMP-001"}], "current_user_employee": "EMP-001"},
        )


class TestExcludedCalendarEmployees(unittest.TestCase):
    """Tests for _excluded_calendar_employees config parsing."""

    def test_returns_empty_when_unset(self):
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.conf") as conf:
            conf.get.return_value = None
            self.assertEqual(_excluded_calendar_employees(), [])

    def test_parses_json_list(self):
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.conf") as conf:
            conf.get.return_value = ["ADMS-BRIDGE", "SVC-ACCOUNT"]
            result = _excluded_calendar_employees()
            self.assertEqual(result, ["ADMS-BRIDGE", "SVC-ACCOUNT"])

    def test_parses_comma_separated_string(self):
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.conf") as conf:
            conf.get.return_value = "ADMS-BRIDGE, SVC-ACCOUNT"
            result = _excluded_calendar_employees()
            self.assertEqual(result, ["ADMS-BRIDGE", "SVC-ACCOUNT"])

    def test_parses_newline_separated_string(self):
        with patch("dewey_time.attendance_engine.hr_calendar.frappe.conf") as conf:
            conf.get.return_value = "ADMS-BRIDGE\nSVC-ACCOUNT"
            result = _excluded_calendar_employees()
            self.assertEqual(result, ["ADMS-BRIDGE", "SVC-ACCOUNT"])


class TestListCalendarEmployeeRowsExclusion(unittest.TestCase):
    """Tests for the exclusion filter applied in _list_calendar_employee_rows."""

    def _base_patches(self):
        """Return a context manager stack that mocks the dependencies of
        _list_calendar_employee_rows to isolate just the exclusion logic."""
        import contextlib

        @contextlib.contextmanager
        def _ctx(excluded_ids, get_all_return):
            with patch(
                "dewey_time.attendance_engine.hr_calendar._excluded_calendar_employees",
                return_value=excluded_ids,
            ), patch(
                "dewey_time.attendance_engine.hr_calendar.frappe.db.has_column",
                return_value=False,
            ), patch(
                "dewey_time.attendance_engine.hr_calendar.frappe.get_all",
                return_value=get_all_return,
            ) as mock_get_all, patch(
                "dewey_time.attendance_engine.hr_calendar._shift_schedule_assignment_metadata_by_employee",
                return_value={},
            ), patch(
                "dewey_time.attendance_engine.hr_calendar.shift_assignment_bounds_by_employee",
                return_value={},
            ), patch(
                "dewey_time.attendance_engine.hr_calendar.first_checkin_date_by_employee",
                return_value={},
            ):
                yield mock_get_all

        return _ctx

    def test_exclusion_applied_on_see_all_path(self):
        """HR see-all path (employee_ids=None): excluded IDs appear in the filter."""
        ctx = self._base_patches()
        with ctx(["ADMS-BRIDGE"], []) as mock_get_all:
            _list_calendar_employee_rows(None, include_all=True)
            _, call_kwargs = mock_get_all.call_args
            name_filter = call_kwargs["filters"].get("name")
            self.assertEqual(name_filter, ["not in", ["ADMS-BRIDGE"]])

    def test_no_exclusion_filter_when_config_empty(self):
        """When hr_calendar_excluded_employees is unset, no name filter is added."""
        ctx = self._base_patches()
        with ctx([], []) as mock_get_all:
            _list_calendar_employee_rows(None, include_all=True)
            _, call_kwargs = mock_get_all.call_args
            self.assertNotIn("name", call_kwargs["filters"])

    def test_exclusion_not_applied_on_personal_path(self):
        """Non-HR path (employee_ids set): exclusion is irrelevant; 'in' filter is used."""
        ctx = self._base_patches()
        with ctx(["ADMS-BRIDGE"], []) as mock_get_all:
            _list_calendar_employee_rows(["EMP-001"], include_all=True)
            _, call_kwargs = mock_get_all.call_args
            name_filter = call_kwargs["filters"].get("name")
            self.assertEqual(name_filter, ["in", ["EMP-001"]])


class EmployeeNavMetaClockBasedTests(unittest.TestCase):
    def test_nav_meta_reports_clock_based_for_contract(self):
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "first_checkin_date_by_employee", return_value={}), \
             patch.object(hr_calendar, "shift_assignment_bounds_by_employee", return_value={}), \
             patch.object(hr_calendar.frappe.db, "has_column", return_value=True), \
             patch.object(hr_calendar.frappe.db, "get_value", return_value="Contract"):
            meta = hr_calendar._employee_nav_meta("EMP-1")

        self.assertTrue(meta["is_clock_based"])

    def test_nav_meta_reports_not_clock_based_for_full_time(self):
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "first_checkin_date_by_employee", return_value={}), \
             patch.object(hr_calendar, "shift_assignment_bounds_by_employee", return_value={}), \
             patch.object(hr_calendar.frappe.db, "has_column", return_value=True), \
             patch.object(hr_calendar.frappe.db, "get_value", return_value="Full-time"):
            meta = hr_calendar._employee_nav_meta("EMP-1")

        self.assertFalse(meta["is_clock_based"])

    def test_nav_meta_survives_missing_employment_type_column(self):
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "first_checkin_date_by_employee", return_value={}), \
             patch.object(hr_calendar, "shift_assignment_bounds_by_employee", return_value={}), \
             patch.object(hr_calendar.frappe.db, "has_column", return_value=False), \
             patch.object(hr_calendar.frappe.db, "get_value") as get_value:
            meta = hr_calendar._employee_nav_meta("EMP-1")

        self.assertFalse(meta["is_clock_based"])
        get_value.assert_not_called()


class TestCalendarPayloadEmployeeBranch(unittest.TestCase):
    """The payload must carry the employee's primary branch: the SPA compares each
    punch's device branch against it, and cannot do so if it is never sent."""

    def _call(self, branch):
        from datetime import date as _date

        import dewey_time.attendance_engine.hr_calendar as hc

        def _get_value(doctype, name, field=None, *args, **kwargs):
            if doctype == "Employee" and field == "branch":
                return branch
            return None

        with patch.object(hc, "_require_calendar_access"), patch.object(
            hc, "getdate", lambda v: _date.fromisoformat(str(v))
        ), patch.object(hc, "get_datetime", lambda v: str(v)), patch.object(
            hc.frappe.db, "get_value", side_effect=_get_value
        ), patch.object(
            hc.frappe, "get_all", return_value=[]
        ), patch.object(
            hc.frappe.db, "table_exists", return_value=False
        ):
            return hc.get_employee_calendar("EMP-001", "2026-07-27", "2026-07-27")

    def test_payload_exposes_employee_branch(self):
        self.assertEqual(self._call("BRANCH-A")["employee_branch"], "BRANCH-A")

    def test_payload_exposes_none_when_branch_unset(self):
        payload = self._call(None)
        self.assertIn("employee_branch", payload)
        self.assertIsNone(payload["employee_branch"])


class TestCalendarDecisions(unittest.TestCase):
    """get_employee_calendar attaches a `decision` + `decision_state` to each flag,
    batched over the whole range in ONE query — see hr-flag-management-design.md
    "get_employee_calendar (existing) — additive change". Identity/fingerprint
    computation is mocked here: this module only has to prove it wires the batched
    query and the match/mismatch/absent branching correctly, not that
    flag_identity.py itself is correct (that lives in its own test module)."""

    FLAG_ROW = {
        "name": "AF-1",
        "attendance_date": "2026-08-05",
        "flag_code": "MISSING_TIME",
        "severity": "WARNING",
        "source": "AUTO",
        "status": "OPEN",
        "day_closed": 1,
        "rule_version": 1,
        "evidence": json.dumps({"minutes": 45, "reason": "gap", "interval_start": "12:00:00"}),
    }

    def _call(self, *, decision_rows, identity_return="IDENT-1", fingerprint_return="fp-current",
              start="2026-08-05", end="2026-08-05"):
        from datetime import date as _date

        import dewey_time.attendance_engine.hr_calendar as hc

        get_all_calls = {"Attendance Flag Decision": 0}

        def _get_all(doctype, **_kwargs):
            if doctype == "Employee Checkin":
                return []
            if doctype == "Attendance Flag":
                return [dict(self.FLAG_ROW)]
            if doctype == "Attendance Flag Decision":
                get_all_calls["Attendance Flag Decision"] += 1
                return list(decision_rows)
            return []

        def _table_exists(doctype):
            return doctype in ("Attendance Flag", "Attendance Flag Decision")

        with patch.object(hc, "_require_calendar_access"), \
             patch.object(hc, "getdate", lambda v: _date.fromisoformat(str(v))), \
             patch.object(hc, "get_datetime", lambda v: str(v)), \
             patch.object(hc, "nowdate", lambda: "2026-08-06"), \
             patch.object(hc.frappe.db, "get_value", return_value=None), \
             patch.object(hc.frappe, "get_all", side_effect=_get_all), \
             patch.object(hc.frappe.db, "table_exists", side_effect=_table_exists), \
             patch.object(hc, "flag_identity", return_value=identity_return), \
             patch.object(hc, "evidence_fingerprint", return_value=fingerprint_return):
            payload = hc.get_employee_calendar("EMP-001", start, end)
        return payload, get_all_calls

    def test_matching_decision_reports_matched(self):
        decision_row = {
            "name": "AFD-1",
            "flag_identity": "IDENT-1",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": None,
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": "fp-current",
        }
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "matched")
        self.assertEqual(flag["decision"]["name"], "AFD-1")
        self.assertEqual(flag["decision"]["outcome"], "EXCUSED")

    def test_fingerprint_mismatch_reports_needs_re_review_but_keeps_decision(self):
        decision_row = {
            "name": "AFD-1",
            "flag_identity": "IDENT-1",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": None,
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": "fp-stale",
        }
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-corrected",
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "needs_re_review")
        self.assertIsNotNone(flag["decision"])
        self.assertEqual(flag["decision"]["name"], "AFD-1")

    def test_no_decision_reports_undecided_and_none(self):
        payload, _ = self._call(
            decision_rows=[],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "undecided")
        self.assertIsNone(flag["decision"])

    def test_decision_lookup_is_one_query_for_the_whole_range(self):
        _, get_all_calls = self._call(
            decision_rows=[],
            start="2026-08-01",
            end="2026-08-05",
        )
        self.assertEqual(get_all_calls["Attendance Flag Decision"], 1)


if __name__ == "__main__":
    unittest.main()
