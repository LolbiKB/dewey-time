import unittest
from datetime import date
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


def _profile(start, end, lunch_start=None, lunch_end=None, grace=10):
    return {
        "start_time": start,
        "end_time": end,
        "lunch_start": lunch_start,
        "lunch_end": lunch_end,
        "grace_minutes": grace,
    }


class TestGroupIdentity(unittest.TestCase):
    def test_same_days_and_profile_are_equal(self):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity

        a = _group_identity(["Monday", "Tuesday"], _profile("09:00:00", "17:00:00"))
        b = _group_identity(["Tuesday", "Monday"], _profile("09:00:00", "17:00:00"))
        self.assertEqual(a, b)

    def test_grace_difference_changes_identity(self):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity

        a = _group_identity(["Monday"], _profile("09:00:00", "17:00:00", grace=10))
        b = _group_identity(["Monday"], _profile("09:00:00", "17:00:00", grace=20))
        self.assertNotEqual(a, b)

    def test_identity_key_is_stable_string(self):
        from dewey_time.attendance_engine.schedule_resolver import (
            _group_identity,
            _identity_key,
        )

        key = _identity_key(_group_identity(["Monday"], _profile("09:00:00", "17:00:00")))
        self.assertIsInstance(key, str)
        # Day order in input must not change the key.
        key2 = _identity_key(_group_identity(["Monday"], _profile("09:00:00", "17:00:00")))
        self.assertEqual(key, key2)

    def test_group_identity_key_reads_group_dict(self):
        from dewey_time.attendance_engine.schedule_resolver import (
            _identity_key,
            _group_identity,
            group_identity_key,
        )

        group = {"days": ["Monday", "Friday"], "profile": _profile("08:00:00", "16:00:00")}
        self.assertEqual(
            group_identity_key(group),
            _identity_key(_group_identity(group["days"], group["profile"])),
        )


class TestClassifyFutureAssignment(unittest.TestCase):
    E = date(2026, 7, 1)

    def test_pure_future_is_inactivated(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 7, 5), date(2026, 7, 10), self.E)
        self.assertEqual(action, "inactivate")
        self.assertIsNone(proposed)

    def test_straddling_is_trimmed_to_day_before_E(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 6, 1), date(2026, 7, 10), self.E)
        self.assertEqual(action, "end_before")
        self.assertEqual(proposed, "2026-06-30")

    def test_open_ended_straddling_is_trimmed(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 6, 1), None, self.E)
        self.assertEqual(action, "end_before")
        self.assertEqual(proposed, "2026-06-30")

    def test_starts_on_E_is_inactivated(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, _ = _classify_future_assignment(date(2026, 7, 1), date(2026, 7, 9), self.E)
        self.assertEqual(action, "inactivate")

    def test_entirely_past_is_skipped(self):
        from dewey_time.attendance_engine.schedule_resolver import _classify_future_assignment

        action, proposed = _classify_future_assignment(date(2026, 5, 1), date(2026, 6, 30), self.E)
        self.assertIsNone(action)
        self.assertIsNone(proposed)


class TestFutureAssignmentsForSsa(unittest.TestCase):
    def test_throws_when_backlink_column_absent(self):
        import frappe
        from dewey_time.attendance_engine import schedule_resolver

        frappe.db.table_exists.return_value = True
        frappe.db.has_column.side_effect = lambda dt, col: col != "shift_schedule_assignment"
        with self.assertRaises(Exception):
            schedule_resolver._future_assignments_for_ssa(ssa_name="SSA-1", effective_from=date(2026, 7, 1))
        frappe.db.has_column.side_effect = None

    def test_scopes_by_backlink_and_classifies(self):
        import frappe
        from dewey_time.attendance_engine import schedule_resolver

        frappe.db.table_exists.return_value = True
        frappe.db.has_column.return_value = True
        rows = [
            {"name": "SA-PAST", "start_date": date(2026, 5, 1), "end_date": date(2026, 6, 30), "shift_type": "FT"},
            {"name": "SA-STRADDLE", "start_date": date(2026, 6, 1), "end_date": date(2026, 7, 9), "shift_type": "FT"},
            {"name": "SA-FUTURE", "start_date": date(2026, 7, 10), "end_date": date(2026, 7, 20), "shift_type": "FT"},
        ]
        with patch.object(schedule_resolver.frappe, "get_all", return_value=rows) as get_all:
            out = schedule_resolver._future_assignments_for_ssa(
                ssa_name="SSA-1", effective_from=date(2026, 7, 1)
            )
        # Scoped by the back-link, not shift_type.
        _, kwargs = get_all.call_args
        self.assertEqual(kwargs["filters"]["shift_schedule_assignment"], "SSA-1")
        by_name = {r["name"]: r for r in out}
        self.assertNotIn("SA-PAST", by_name)
        self.assertEqual(by_name["SA-STRADDLE"]["action"], "end_before")
        self.assertEqual(by_name["SA-STRADDLE"]["proposed_end_date"], "2026-06-30")
        self.assertEqual(by_name["SA-FUTURE"]["action"], "inactivate")


if __name__ == "__main__":
    unittest.main()
