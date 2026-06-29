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
    def _build(self, rows, patterns):
        from dewey_time.attendance_engine import coverage_api

        with patch.object(coverage_api, "_list_calendar_employee_rows", return_value=rows), patch.object(
            coverage_api, "week_pattern_from_ssas", side_effect=lambda emp: patterns.get(emp, [])
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


class TestInvalidateCoverageCache(unittest.TestCase):
    def test_invalidate_deletes_the_cache_key(self):
        import frappe

        from dewey_time.attendance_engine import coverage_api

        frappe.cache.return_value.delete_value.reset_mock()
        coverage_api.invalidate_coverage_cache()
        frappe.cache.return_value.delete_value.assert_called_once_with("schedule_coverage:v1")

    def test_invalidate_accepts_doc_event_args(self):
        from dewey_time.attendance_engine import coverage_api

        # Frappe doc_events call handlers as (doc, method); must not raise.
        coverage_api.invalidate_coverage_cache(doc=object(), method="on_update")


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


if __name__ == "__main__":
    unittest.main()
