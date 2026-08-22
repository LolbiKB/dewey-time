import contextlib
import json
import unittest
from datetime import date as _date
from datetime import datetime as _datetime
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
    flag_identity.py itself is correct (that lives in its own test module — and
    see TestCalendarDecisionsRealIdentity below, which does not mock it).

    hr_view defaults to True in _call() so the match/mismatch/absent tests below
    assert the full decision row undisturbed by the viewer-redaction concern,
    which gets its own dedicated tests (test_non_hr_viewer_sees_redacted_decision,
    test_hr_viewer_sees_full_decision)."""

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
              start="2026-08-05", end="2026-08-05", hr_view=True, flag_row=None):
        from datetime import date as _date

        import dewey_time.attendance_engine.hr_calendar as hc

        get_all_calls = {"Attendance Flag Decision": 0}
        row = flag_row if flag_row is not None else self.FLAG_ROW
        # The SELECT the decision read was issued with, for the tests that assert
        # HR-private columns are never fetched for a non-HR viewer. Recorded rather
        # than honoured: the fake still returns whole canned rows, so the allowlist
        # projection stays the thing under test in the redaction cases below.
        self.decision_fields = []

        def _get_all(doctype, **kwargs):
            if doctype == "Employee Checkin":
                return []
            if doctype == "Attendance Flag":
                return [dict(row)]
            if doctype == "Attendance Flag Decision":
                get_all_calls["Attendance Flag Decision"] += 1
                self.decision_fields = list(kwargs.get("fields") or [])
                return list(decision_rows)
            return []

        def _table_exists(doctype):
            return doctype in ("Attendance Flag", "Attendance Flag Decision")

        with patch.object(hc, "_require_calendar_access"), \
             patch.object(hc, "_is_hr_staff", return_value=hr_view), \
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

    def test_non_hr_viewer_sees_redacted_decision(self):
        """Task 7 review Finding 1: an employee viewing their own calendar is a
        first-class path (_require_calendar_access allows a non-HR user through
        for their own linked Employee), and must never receive HR's private
        note/decided_by/reason. decision_state stays "matched" (truthful) even
        though the decision content is redacted to an allowlist -- gating the
        whole attachment instead would make an excused flag falsely report
        "undecided" in the employee's own view."""
        decision_row = {
            "name": "AFD-1",
            "flag_identity": "IDENT-1",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": "HR's private reasoning about this employee",
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": "fp-current",
        }
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
            hr_view=False,
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "matched")
        # Equality on the whole dict, not individual assertNotIn checks: this
        # fails the moment ANY extra key leaks, including one added later that
        # nobody thought to assertNotIn for.
        self.assertEqual(flag["decision"], {"outcome": "EXCUSED", "decided_at": "2026-08-05 09:00:00"})

    def test_hr_viewer_sees_full_decision(self):
        """The redaction in test_non_hr_viewer_sees_redacted_decision is
        viewer-specific, not universal -- an HR viewer must still get the full
        row (note, decided_by, reason and all), which is what the triage queue
        and day inspector need to act on a decision."""
        decision_row = {
            "name": "AFD-1",
            "flag_identity": "IDENT-1",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": "HR's private reasoning about this employee",
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": "fp-current",
        }
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
            hr_view=True,
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "matched")
        self.assertEqual(flag["decision"]["note"], "HR's private reasoning about this employee")
        self.assertEqual(flag["decision"]["decided_by"], "hr@example.com")
        self.assertEqual(flag["decision"]["reason"], "APPROVED_LEAVE")

    def test_a_non_hr_viewer_never_fetches_hr_private_columns(self):
        """Defence in depth behind the allowlist projection above. The payload is
        already safe, but an employee reading their own calendar is a first-class
        path, and HR's private note about them has no business being loaded into
        that request at all — two things have to break before it can leak, not
        one."""
        self._call(decision_rows=[], hr_view=False)

        for field in ("note", "decided_by", "reason", "group_key", "name"):
            self.assertNotIn(field, self.decision_fields, f"{field} is HR-private")
        # …while still fetching everything the attach point needs, or the flag
        # would report "undecided" to the employee whose flag was excused.
        for field in ("flag_identity", "outcome", "decided_at", "evidence_fingerprint"):
            self.assertIn(field, self.decision_fields)

    def test_an_hr_viewer_still_fetches_the_whole_row(self):
        self._call(decision_rows=[], hr_view=True)

        for field in (
            "name",
            "flag_identity",
            "outcome",
            "reason",
            "note",
            "decided_by",
            "decided_at",
            "group_key",
            "evidence_fingerprint",
        ):
            self.assertIn(field, self.decision_fields)

    def test_non_auto_flag_never_attaches_a_decision(self):
        """Task 7 review Finding 2: flag_identity() always prefixes "AUTO-"
        (flag_identity.py:181) regardless of the flag's real source, so an
        unguarded lookup could hand an HR- or employee-created flag the
        engine's own decision for the same employee/date/code. The AUTO guard
        must block attachment even when the (mocked) identity matches the live
        decision's identity exactly -- proving it is the source check doing the
        work here, not an identity mismatch."""
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
        non_auto_row = dict(self.FLAG_ROW, source="HR")
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
            flag_row=non_auto_row,
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "undecided")
        self.assertIsNone(flag["decision"])


class TestCalendarDecisionsRealIdentity(unittest.TestCase):
    """Task 7 review Finding 3: TestCalendarDecisions above mocks flag_identity
    and evidence_fingerprint to constants, so it cannot catch a date
    normalisation drift in hr_calendar.py itself -- e.g. reverting to str(d)
    instead of flag_identity.date_key(). This class calls the REAL functions,
    so a regression there fails for real instead of being invisible behind a
    mocked identity_return."""

    def test_attaches_decision_when_attendance_date_arrives_datetime_shaped(self):
        from datetime import date as _date

        import dewey_time.attendance_engine.hr_calendar as hc
        from dewey_time.attendance_engine.flag_identity import (
            evidence_fingerprint as real_evidence_fingerprint,
            flag_identity as real_flag_identity,
        )

        # A datetime-shaped attendance_date ("YYYY-MM-DD HH:MM:SS"), not a bare
        # date. str(d) would leave this untouched and compute a DIFFERENT
        # identity than the one below; date_key() strips it to "YYYY-MM-DD"
        # first, the same normaliser flag_queue_api._flag_rows uses.
        flag_row = {
            "name": "AF-1",
            "attendance_date": "2026-08-05 00:00:00",
            "flag_code": "LATE_START",
            "severity": "WARNING",
            "source": "AUTO",
            "status": "OPEN",
            "day_closed": 1,
            "rule_version": 1,
            "evidence": None,
        }
        real_identity = real_flag_identity(
            employee="EMP-001",
            attendance_date="2026-08-05",
            flag_code="LATE_START",
            evidence=None,
        )
        decision_row = {
            "name": "AFD-1",
            "flag_identity": real_identity,
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": None,
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": real_evidence_fingerprint(None),
        }

        def _get_all(doctype, **_kwargs):
            if doctype == "Employee Checkin":
                return []
            if doctype == "Attendance Flag":
                return [dict(flag_row)]
            if doctype == "Attendance Flag Decision":
                return [dict(decision_row)]
            return []

        def _table_exists(doctype):
            return doctype in ("Attendance Flag", "Attendance Flag Decision")

        with patch.object(hc, "_require_calendar_access"), \
             patch.object(hc, "_is_hr_staff", return_value=True), \
             patch.object(hc, "getdate", lambda v: _date.fromisoformat(str(v))), \
             patch.object(hc, "get_datetime", lambda v: str(v)), \
             patch.object(hc, "nowdate", lambda: "2026-08-06"), \
             patch.object(hc.frappe.db, "get_value", return_value=None), \
             patch.object(hc.frappe, "get_all", side_effect=_get_all), \
             patch.object(hc.frappe.db, "table_exists", side_effect=_table_exists):
            payload = hc.get_employee_calendar("EMP-001", "2026-08-05", "2026-08-05")

        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "matched")
        self.assertEqual(flag["decision"]["name"], "AFD-1")


class TestCalendarEmployeeRowBranch(unittest.TestCase):
    """The picker's employee rows must carry `branch`.

    The field was once in the SELECT list and absent from the emitted dict --
    "a production no-op returning None forever", per the comment above the
    emit -- and only review caught it. Nothing pinned it until now, so it
    could regress the same way twice.
    """

    def _call(self, rows):
        import dewey_time.attendance_engine.hr_calendar as hc

        with patch.object(hc.frappe.db, "has_column", return_value=False), patch.object(
            hc.frappe, "get_all", return_value=rows
        ) as get_all, patch.object(
            hc, "_shift_schedule_assignment_metadata_by_employee", return_value={}
        ), patch.object(
            hc, "shift_assignment_bounds_by_employee", return_value={}
        ), patch.object(
            hc, "first_checkin_date_by_employee", return_value={}
        ):
            out = hc._list_calendar_employee_rows(["EMP-001"], include_all=True)
        return out, get_all

    def test_branch_is_in_the_select_list(self):
        # In the SELECT list and in the emitted dict are different claims, and
        # it was the second one that failed last time. Both are asserted.
        _out, get_all = self._call([])
        self.assertIn("branch", get_all.call_args.kwargs["fields"])

    def test_branch_reaches_the_emitted_row(self):
        out, _ = self._call(
            [{"name": "EMP-001", "employee_name": "Jane Doe", "branch": "BRANCH-A"}]
        )
        self.assertEqual(out[0]["branch"], "BRANCH-A")

    def test_branch_is_none_when_unset(self):
        out, _ = self._call([{"name": "EMP-001", "employee_name": "Jane Doe"}])
        self.assertIn("branch", out[0])
        self.assertIsNone(out[0]["branch"])


if __name__ == "__main__":
    unittest.main()


class TestBuilderExtractionIsBehaviourPreserving(unittest.TestCase):
    """The Mini App cannot call get_employee_calendar.

    Its gate resolves identity via frappe.session.user -> Employee.user_id, and
    the Telegram layer deliberately creates no Frappe User, so the gate can
    never pass for it. The payload therefore had to be reachable without the
    gate -- and these tests are the guard that splitting it changed nothing.
    """

    def _patches(self):
        from dewey_time.attendance_engine import hr_calendar as hc

        return [
            patch.object(hc, "getdate", lambda v: _date.fromisoformat(str(v))),
            patch.object(hc, "get_datetime", lambda v: str(v)),
            patch.object(hc.frappe.db, "get_value", return_value=None),
            patch.object(hc.frappe, "get_all", return_value=[]),
            patch.object(hc.frappe.db, "table_exists", return_value=False),
        ]

    def test_the_gated_api_and_the_builder_return_the_same_payload(self):
        # The extraction's whole contract. If these ever diverge, HR's calendar
        # and the employee's are being built by different code.
        from dewey_time.attendance_engine import hr_calendar as hc

        with contextlib.ExitStack() as stack:
            for p in self._patches():
                stack.enter_context(p)
            stack.enter_context(patch.object(hc, "_require_calendar_access"))
            gated = hc.get_employee_calendar("EMP-001", "2026-08-10", "2026-08-11")
            direct = hc.build_employee_calendar("EMP-001", "2026-08-10", "2026-08-11")

        self.assertEqual(gated, direct)

    def test_the_gate_still_runs_on_the_whitelisted_api(self):
        # The extraction must not take the permission check with it.
        from dewey_time.attendance_engine import hr_calendar as hc

        with contextlib.ExitStack() as stack:
            for p in self._patches():
                stack.enter_context(p)
            gate = stack.enter_context(patch.object(hc, "_require_calendar_access"))
            hc.get_employee_calendar("EMP-001", "2026-08-10", "2026-08-11")

        gate.assert_called_once_with("EMP-001")

    def test_the_builder_does_not_check_permissions(self):
        # A gate here would make the Mini App path impossible again, which is
        # the entire reason this function exists.
        from dewey_time.attendance_engine import hr_calendar as hc

        with contextlib.ExitStack() as stack:
            for p in self._patches():
                stack.enter_context(p)
            gate = stack.enter_context(patch.object(hc, "_require_calendar_access"))
            hc.build_employee_calendar("EMP-001", "2026-08-10", "2026-08-11")

        gate.assert_not_called()


class TestCalendarDayLoopShiftMeta(unittest.TestCase):
    """The one loop HR's calendar and the employee's phone both run.

    It resolves a shift per day and, since the site clock change, memoises the
    Shift Type document across the range. Four mutations of it survived the
    whole suite when this class was written -- wrong memo key, meta always
    None, the observed-lunch guard forced false, the guard dropping meta -- and
    two of those are a month of unrostered days on both surfaces. There was no
    net beneath it; this is the net.
    """

    def _run(self, hc, *, shift_by_day, meta_for, checkin_days=()):
        """Drive build_employee_calendar over 2026-08-01..2026-08-04."""
        checkins = [
            {"name": f"CI-{d}", "time": f"2026-08-0{d} 08:00:00", "log_type": "IN",
             "device_id": "D1", "custom_device_branch": None}
            for d in checkin_days
        ]

        def _get_all(doctype, *a, **kw):
            return checkins if doctype == "Employee Checkin" else []

        with contextlib.ExitStack() as stack:
            for p in [
                patch.object(hc, "getdate", lambda v: _date.fromisoformat(str(v)[:10])),
                # A REAL parse, not the shared mock's passthrough. The loop
                # subtracts two of these to get gross minutes, and a mock that
                # hands back the string it was given makes that a TypeError --
                # which is the only reason no existing test drives this branch.
                patch.object(hc, "get_datetime",
                             lambda v: _datetime.fromisoformat(str(v))),
                patch.object(hc.frappe.db, "get_value", return_value=None),
                patch.object(hc.frappe, "get_all", side_effect=_get_all),
                patch.object(hc.frappe.db, "table_exists", return_value=False),
                patch.object(hc, "_get_shift_assignment",
                             side_effect=lambda **kw: shift_by_day(kw["attendance_date"])),
                patch.object(hc, "_get_shift_meta", side_effect=meta_for),
            ]:
                stack.enter_context(p)
            lunch = stack.enter_context(
                patch.object(hc, "detect_observed_lunch", return_value=None)
            )
            payload = hc.build_employee_calendar("EMP-001", "2026-08-01", "2026-08-04")
        return payload, lunch

    @staticmethod
    def _meta(name):
        return {
            "name": name,
            "start_time": "08:00:00" if name == "FT" else "13:00:00",
            "end_time": "17:00:00" if name == "FT" else "21:00:00",
        }

    def test_each_day_gets_its_own_shift_types_times(self):
        # THE CLASSIC MEMO BUG: one slot for the whole range instead of one per
        # shift type, so the first Shift Type loaded answers for every later
        # one. An employee whose month mixes a full-time and an evening shift
        # then reads their evening days as 08:00-17:00 -- on HR's console and
        # on their own phone -- and every existing test stays green.
        from dewey_time.attendance_engine import hr_calendar as hc

        calls = []

        def meta_for(shift_type):
            calls.append(shift_type)
            return self._meta(shift_type)

        payload, _ = self._run(
            hc,
            shift_by_day=lambda d: {"shift_type": "FT" if d.day % 2 else "PT"},
            meta_for=meta_for,
        )

        by_date = {d["date"]: d["shift"] for d in payload["days"]}
        self.assertEqual(by_date["2026-08-01"]["shift_type"], "FT")
        self.assertEqual(by_date["2026-08-01"]["start_time"], "08:00:00")
        self.assertEqual(by_date["2026-08-02"]["shift_type"], "PT")
        self.assertEqual(
            by_date["2026-08-02"]["start_time"], "13:00:00",
            "the evening day must carry the evening shift's own times",
        )
        # And the memo's whole point, stated: once per distinct type, not once
        # per day. Four days, two types.
        self.assertEqual(sorted(calls), ["FT", "PT"])

    def test_a_transient_shift_type_failure_costs_one_day_not_the_range(self):
        # `_get_shift_meta` swallows every exception and returns None, so
        # memoising that answer promotes a fault lasting one query into an
        # unrostered MONTH: no shift bar, no times, no grace, for a range that
        # resolves perfectly on the very next day.
        from dewey_time.attendance_engine import hr_calendar as hc

        seen = []

        def meta_for(shift_type):
            seen.append(shift_type)
            return None if len(seen) == 1 else self._meta(shift_type)

        payload, _ = self._run(
            hc,
            shift_by_day=lambda d: {"shift_type": "FT"},
            meta_for=meta_for,
        )

        assigned = [d["date"] for d in payload["days"] if d["shift"]["shift_assigned"]]
        self.assertEqual(
            assigned, ["2026-08-02", "2026-08-03", "2026-08-04"],
            "only the day that actually failed may be blank",
        )

    def test_observed_lunch_is_computed_where_there_is_both_a_shift_and_punches(self):
        # The guard the refactor rewrote. Forced false it silently removes the
        # lunch band and the LATE_FROM_LUNCH context from every calendar; left
        # ungated it calls the detector for days with nothing to detect.
        from dewey_time.attendance_engine import hr_calendar as hc

        _, lunch = self._run(
            hc,
            shift_by_day=lambda d: {"shift_type": "FT"} if d.day <= 2 else None,
            meta_for=self._meta,
            checkin_days=(2, 3),
        )

        self.assertEqual(
            [c.kwargs["attendance_date"].day for c in lunch.call_args_list], [2],
            "the 2nd has both; the 1st has no punches and the 3rd has no shift",
        )
