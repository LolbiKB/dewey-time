import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


def _row(emp_id, name, assigned, *, dept="Ops", emp_type="Full-time"):
    return {
        "id": emp_id,
        "employee_name": name,
        "department": dept,
        "employment_type": emp_type,
        "title": "Staff",
        "image": None,
        "has_shift_assignment": assigned,
    }


def _days(start, end, n_working=5):
    """A week pattern with `n_working` working days at start..end (no lunch)."""
    return [
        {
            "weekday": wd,
            "works": i < n_working,
            "start_time": start,
            "end_time": end,
            "lunch_start": None,
            "lunch_end": None,
        }
        for i, wd in enumerate(
            ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        )
    ]


class TestBuildCoveragePayload(unittest.TestCase):
    def _build(self, rows, patterns, telegram=None):
        from dewey_time.attendance_engine import coverage_api

        with patch.object(coverage_api, "_list_calendar_employee_rows", return_value=rows), patch.object(
            coverage_api, "week_pattern_from_ssas", side_effect=lambda emp: patterns.get(emp, [])
        ), patch.object(
            coverage_api, "_telegram_status_by_employee", return_value=telegram or {}
        ):
            return coverage_api._build_coverage_payload()

    def test_splits_assigned_and_unassigned_with_counts(self):
        rows = [
            _row("EMP-001", "Ana", True),
            _row("EMP-002", "Ben", False),
            _row("EMP-003", "Cy", True),
        ]
        patterns = {
            "EMP-001": _days("09:00:00", "17:00:00"),  # 8h x5 = 2400
            "EMP-003": _days("09:00:00", "13:00:00"),  # 4h x5 = 1200
        }
        payload = self._build(rows, patterns)

        self.assertEqual(
            payload["counts"],
            {"active": 3, "unassigned": 1, "assigned": 2, "truncated": False},
        )
        self.assertEqual([e["id"] for e in payload["unassigned"]], ["EMP-002"])
        self.assertEqual(sorted(e["id"] for e in payload["assigned"]), ["EMP-001", "EMP-003"])

    def test_assigned_employees_carry_resolved_weekly_minutes(self):
        rows = [_row("EMP-001", "Ana", True), _row("EMP-003", "Cy", True)]
        patterns = {
            "EMP-001": _days("09:00:00", "17:00:00"),  # 2400
            "EMP-003": _days("09:00:00", "13:00:00"),  # 1200
        }
        payload = self._build(rows, patterns)
        minutes = {e["id"]: e["weekly_minutes"] for e in payload["assigned"]}
        self.assertEqual(minutes, {"EMP-001": 2400, "EMP-003": 1200})

    def test_unassigned_rows_carry_no_weekly_minutes(self):
        payload = self._build([_row("EMP-002", "Ben", False)], {})
        self.assertNotIn("weekly_minutes", payload["unassigned"][0])
        self.assertEqual(payload["unassigned"][0]["employee_name"], "Ben")

    def test_assigned_with_unresolvable_pattern_gets_zero_minutes(self):
        # Assigned flag set, but week pattern reconstruction yields nothing.
        payload = self._build([_row("EMP-009", "Deb", True)], {"EMP-009": []})
        self.assertEqual(payload["assigned"][0]["weekly_minutes"], 0)

    def test_week_pattern_failure_is_isolated_to_zero(self):
        from dewey_time.attendance_engine import coverage_api

        with patch.object(
            coverage_api, "_list_calendar_employee_rows", return_value=[_row("EMP-009", "Deb", True)]
        ), patch.object(coverage_api, "week_pattern_from_ssas", side_effect=RuntimeError("boom")):
            payload = coverage_api._build_coverage_payload()
        self.assertEqual(payload["assigned"][0]["weekly_minutes"], 0)


class TestTelegramColumnInPayload(unittest.TestCase):
    def test_both_halves_of_the_roster_carry_the_telegram_state(self):
        # Assigned and unassigned are built on separate code paths, and the
        # register joins them into one table -- a field added to only one half
        # renders as a blank column for whichever half missed it.
        rows = [_row("EMP-001", "Ana", True), _row("EMP-002", "Ben", False)]
        payload = self._build_with(rows, {"EMP-001": "linked", "EMP-002": "none"})
        self.assertEqual(payload["assigned"][0]["telegram"], "linked")
        self.assertEqual(payload["unassigned"][0]["telegram"], "none")

    def test_an_employee_absent_from_the_lookup_is_none_not_a_keyerror(self):
        # The whole lookup returns {} on failure. Every row must still build.
        payload = self._build_with([_row("EMP-001", "Ana", True)], {})
        self.assertIsNone(payload["assigned"][0]["telegram"])

    def _build_with(self, rows, telegram):
        from dewey_time.attendance_engine import coverage_api

        with patch.object(coverage_api, "_list_calendar_employee_rows", return_value=rows), patch.object(
            coverage_api, "week_pattern_from_ssas", return_value=[]
        ), patch.object(coverage_api, "_telegram_status_by_employee", return_value=telegram):
            return coverage_api._build_coverage_payload()


class TestTelegramStatusByEmployee(unittest.TestCase):
    """The three states, and the two ways the lookup is allowed to fail."""

    def _status(self, ids, *, links=(), employees=(), has_column=True, link_error=None):
        import frappe

        from dewey_time.attendance_engine import coverage_api

        def get_all(doctype, **kwargs):
            if doctype == "Telegram Link":
                if link_error:
                    raise link_error
                return [{"employee": e} for e in links]
            return list(employees)

        with patch.object(frappe, "get_all", side_effect=get_all), patch.object(
            frappe.db, "has_column", return_value=has_column
        ):
            return coverage_api._telegram_status_by_employee(ids)

    def test_an_enabled_link_reads_linked(self):
        self.assertEqual(self._status(["E1"], links=["E1"]), {"E1": "linked"})

    def test_a_chat_id_with_no_link_reads_id_on_file(self):
        status = self._status(
            ["E1"], employees=[{"name": "E1", "custom_telegram_chat_id": "123456789"}]
        )
        self.assertEqual(status, {"E1": "id_on_file"})

    def test_neither_reads_none(self):
        self.assertEqual(self._status(["E1"]), {"E1": "none"})

    def test_a_link_outranks_an_id_on_file(self):
        # Both true is the ordinary shape for the 35 employees whose id a prior
        # notifier recorded and who have since linked. Reporting the lead over
        # the binding would put them back on HR's to-do list forever.
        status = self._status(
            ["E1"], links=["E1"], employees=[{"name": "E1", "custom_telegram_chat_id": "123456789"}]
        )
        self.assertEqual(status, {"E1": "linked"})

    def test_a_blank_chat_id_is_not_an_id_on_file(self):
        # The column is free-text Data, so "empty" arrives as NULL, "" and
        # whitespace. All three mean nobody recorded anything.
        for empty in (None, "", "   "):
            with self.subTest(value=repr(empty)):
                status = self._status(
                    ["E1"], employees=[{"name": "E1", "custom_telegram_chat_id": empty}]
                )
                self.assertEqual(status, {"E1": "none"})

    def test_a_site_without_the_column_never_reports_id_on_file(self):
        # CI's bench site has no such column. Selecting it anyway makes
        # frappe.get_all raise and would take the whole register down.
        status = self._status(
            ["E1"],
            employees=[{"name": "E1", "custom_telegram_chat_id": "123456789"}],
            has_column=False,
        )
        self.assertEqual(status, {"E1": "none"})

    def test_the_employee_query_is_skipped_entirely_when_the_column_is_absent(self):
        # Not merely that the RESULT is "none" -- that the query never runs.
        # Asserting only the result would pass on an implementation that
        # queried and swallowed the error, which is the version that fills the
        # log with one traceback per page load.
        import frappe

        from dewey_time.attendance_engine import coverage_api

        seen = []

        def get_all(doctype, **kwargs):
            seen.append(doctype)
            return []

        with patch.object(frappe, "get_all", side_effect=get_all), patch.object(
            frappe.db, "has_column", return_value=False
        ):
            coverage_api._telegram_status_by_employee(["E1"])

        self.assertEqual(seen, ["Telegram Link"])

    def test_a_failed_link_lookup_yields_no_states_at_all(self):
        # {} -> every row gets telegram: None -> a blank column. The register's
        # rule is that silence is never a finding: reporting "none" here would
        # tell HR to issue a few hundred links that may already exist.
        self.assertEqual(self._status(["E1"], link_error=RuntimeError("boom")), {})

    def test_an_empty_roster_asks_the_database_nothing(self):
        import frappe

        from dewey_time.attendance_engine import coverage_api

        with patch.object(frappe, "get_all", side_effect=AssertionError("must not query")):
            self.assertEqual(coverage_api._telegram_status_by_employee([]), {})

    def test_only_enabled_links_count(self):
        # A revoked link must put the employee back on the list. Without
        # enabled=1 in the filter, revoking access would leave the register
        # reporting them as linked forever.
        import frappe

        from dewey_time.attendance_engine import coverage_api

        captured = {}

        def get_all(doctype, **kwargs):
            if doctype == "Telegram Link":
                captured.update(kwargs.get("filters") or {})
            return []

        with patch.object(frappe, "get_all", side_effect=get_all), patch.object(
            frappe.db, "has_column", return_value=False
        ):
            coverage_api._telegram_status_by_employee(["E1"])

        self.assertEqual(captured.get("enabled"), 1)


class TestInvalidateCoverageCache(unittest.TestCase):
    def test_invalidate_deletes_the_cache_key(self):
        import frappe

        from dewey_time.attendance_engine import coverage_api

        frappe.cache.return_value.delete_value.reset_mock()
        coverage_api.invalidate_coverage_cache()
        frappe.cache.return_value.delete_value.assert_called_once_with("schedule_coverage:v3")

    def test_invalidate_accepts_doc_event_args(self):
        from dewey_time.attendance_engine import coverage_api

        # Frappe doc_events call handlers as (doc, method); must not raise.
        coverage_api.invalidate_coverage_cache(doc=object(), method="on_update")


class TestEmployeeBranchField(unittest.TestCase):
    def test_branch_is_declared_in_employee_fields(self):
        """Branch is declared as a field to project into the coverage payload.

        This is a cheap assertion: it checks the projection tuple directly.
        The real mapping is tested by test_branch_is_mapped_from_database_row.
        """
        from dewey_time.attendance_engine import coverage_api as mod

        self.assertIn("branch", mod._EMPLOYEE_FIELDS)

    def test_branch_is_mapped_from_database_row(self):
        """Branch is read from the Employee DB row and included in the mapped dict.

        This exercises the full path: frappe.get_all fetches branch, and
        _list_calendar_employee_rows includes it in the returned employee dict.
        """
        from dewey_time.attendance_engine import hr_calendar

        db_row = {
            "name": "HR-EMP-0001",
            "employee_name": "Sok Dara",
            "designation": "Analyst",
            "department": "Finance",
            "company": "Company 1",
            "image": None,
            "branch": "DIU",
        }

        # No self-wrapping patch on _list_calendar_employee_rows: it bound a
        # `wrapped_list` mock nothing ever asserted on, and since the call
        # below goes through that same attribute it only ever passed straight
        # through to the real function.
        with patch("frappe.get_all", return_value=[db_row]), patch.object(
            hr_calendar, "_shift_schedule_assignment_metadata_by_employee", return_value={}
        ), patch.object(
            hr_calendar, "shift_assignment_bounds_by_employee", return_value={}
        ), patch.object(
            hr_calendar, "first_checkin_date_by_employee", return_value={}
        ), patch.object(
            hr_calendar, "is_full_time_employment", return_value=True
        ), patch.object(
            hr_calendar, "is_clock_based", return_value=True
        ):
            result = hr_calendar._list_calendar_employee_rows(None, include_all=True, limit=500)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["branch"], "DIU")


class TestCoverageTruncationFlag(unittest.TestCase):
    def test_not_truncated_below_the_limit(self):
        from dewey_time.attendance_engine import coverage_api

        with patch.object(
            coverage_api, "_list_calendar_employee_rows", return_value=[_row("EMP-1", "A", False)]
        ), patch.object(coverage_api, "week_pattern_from_ssas", return_value=[]):
            payload = coverage_api._build_coverage_payload()
        self.assertFalse(payload["counts"]["truncated"])

    def test_truncated_when_rows_hit_the_limit(self):
        from dewey_time.attendance_engine import coverage_api

        rows = [_row(f"EMP-{i}", f"E{i}", False) for i in range(3)]
        with patch.object(coverage_api, "_list_calendar_employee_rows", return_value=rows), patch.object(
            coverage_api, "week_pattern_from_ssas", return_value=[]
        ), patch.object(coverage_api, "COVERAGE_EMPLOYEE_LIMIT", 3):
            payload = coverage_api._build_coverage_payload()
        self.assertTrue(payload["counts"]["truncated"])


class TestEmployeeKhmerNameFields(unittest.TestCase):
    def test_khmer_fields_reach_the_coverage_payload(self):
        """Khmer fields are declared for projection and survive coverage's dict copy.

        This is a cheap assertion: the tuple check confirms the fields are
        declared for projection, and _employee_base is exercised on a
        hand-built dict that already carries both keys -- it does not reach
        hr_calendar._list_calendar_employee_rows, so it cannot catch a field
        that is SELECTed but dropped by that function's output dict. The real
        mapping -- SELECT through to the emitted row -- is tested by
        test_khmer_fields_are_mapped_from_database_row.
        """
        # The trap this guards: a field added to the SELECT list and then
        # dropped by the explicit output dict is a production no-op that yields
        # None forever. `branch` shipped exactly that way in hr_calendar.py.
        # Asserting on the emitted payload -- not on the fields list -- is what
        # makes the mapping load-bearing.
        from dewey_time.attendance_engine import coverage_api
        self.assertIn("custom_khmer_first_name", coverage_api._EMPLOYEE_FIELDS)
        self.assertIn("custom_khmer_last_name", coverage_api._EMPLOYEE_FIELDS)
        row = {
            "id": "EMP-1", "employee_name": "Sophea Chan", "department": "Retail",
            "employment_type": "Full-time", "title": "Barista", "image": None,
            "branch": "BRANCH-A",
            "custom_khmer_first_name": "សុភា", "custom_khmer_last_name": "ចាន់",
        }
        base = coverage_api._employee_base(row)
        self.assertEqual(base["custom_khmer_last_name"], "ចាន់")
        self.assertEqual(base["custom_khmer_first_name"], "សុភា")

    def test_khmer_fields_are_mapped_from_database_row(self):
        """Khmer fields are read from the Employee DB row and included in the emitted dict.

        This exercises the full path: frappe.get_all fetches the Khmer
        columns, and _list_calendar_employee_rows includes them in the
        returned employee dict. Unlike test_khmer_fields_reach_the_coverage_payload
        above (which hand-builds a dict that already has the keys),
        this test would catch the exact bug it guards against: deleting the
        two emitted lines in hr_calendar.py leaves the SELECT untouched but
        makes this test fail, because the real function -- not a synthetic
        dict -- is what is called here. That is what happened to `branch` in
        this same file until it was caught in review.
        """
        from dewey_time.attendance_engine import hr_calendar

        db_row = {
            "name": "HR-EMP-0002",
            "employee_name": "Sok Dara",
            "designation": "Analyst",
            "department": "Finance",
            "company": "Company 1",
            "image": None,
            "branch": "DIU",
            "custom_khmer_last_name": "ចាន់",
            "custom_khmer_first_name": "សុភា",
        }

        with patch("frappe.get_all", return_value=[db_row]), patch(
            "frappe.db.has_column", return_value=True
        ), patch.object(
            hr_calendar, "_shift_schedule_assignment_metadata_by_employee", return_value={}
        ), patch.object(
            hr_calendar, "shift_assignment_bounds_by_employee", return_value={}
        ), patch.object(
            hr_calendar, "first_checkin_date_by_employee", return_value={}
        ), patch.object(
            hr_calendar, "is_full_time_employment", return_value=True
        ), patch.object(
            hr_calendar, "is_clock_based", return_value=True
        ):
            result = hr_calendar._list_calendar_employee_rows(None, include_all=True, limit=500)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["custom_khmer_last_name"], "ចាន់")
        self.assertEqual(result[0]["custom_khmer_first_name"], "សុភា")


if __name__ == "__main__":
    unittest.main()
