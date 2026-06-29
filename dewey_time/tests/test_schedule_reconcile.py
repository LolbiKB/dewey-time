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


class TestBuildReconcilePreview(unittest.TestCase):
    def _plan(self, groups):
        return {"groups": groups}

    def _group(self, days, profile):
        return {"days": days, "profile": profile, "shift_type": {}, "shift_schedule": {}}

    def _run(self, current, plan, affected=None):
        from dewey_time.attendance_engine import schedule_resolver

        affected = affected or []
        with patch.object(schedule_resolver, "_current_schedule_identities", return_value=current), patch.object(
            schedule_resolver, "_future_assignments_for_ssa", return_value=affected
        ):
            return schedule_resolver.build_reconcile_preview(
                employee="EMP-1", plan=plan, effective_from=date(2026, 7, 1)
            )

    def _identity(self, days, profile):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity, _identity_key

        return _identity_key(_group_identity(days, profile))

    def test_pure_add_when_no_current(self):
        plan = self._plan([self._group(["Monday"], _profile("09:00:00", "17:00:00"))])
        out = self._run({}, plan)
        self.assertEqual(len(out["add_identities"]), 1)
        self.assertEqual(out["unchanged_identities"], [])
        self.assertEqual(out["disable_ssas"], [])

    def test_one_day_change_keeps_other_unchanged(self):
        mon_thu = self._identity(
            ["Monday", "Tuesday", "Wednesday", "Thursday"], _profile("09:00:00", "17:00:00")
        )
        old_fri = self._identity(["Friday"], _profile("09:00:00", "17:00:00"))
        current = {
            mon_thu: [{"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON-THU"}],
            old_fri: [{"ssa": "SSA-B", "shift_schedule": "PAT_B", "shift_type": "FT", "label": "FRI"}],
        }
        plan = self._plan(
            [
                self._group(["Monday", "Tuesday", "Wednesday", "Thursday"], _profile("09:00:00", "17:00:00")),
                self._group(["Friday"], _profile("09:00:00", "14:00:00")),  # Friday hours changed
            ]
        )
        out = self._run(current, plan)
        self.assertIn(mon_thu, out["unchanged_identities"])
        self.assertEqual([d["name"] for d in out["disable_ssas"]], ["SSA-B"])
        self.assertEqual(len(out["add_identities"]), 1)  # new Friday only

    def test_grace_only_edit_is_leaving_plus_adding_not_unchanged(self):
        old = self._identity(["Monday"], _profile("09:00:00", "17:00:00", grace=10))
        current = {old: [{"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON"}]}
        plan = self._plan([self._group(["Monday"], _profile("09:00:00", "17:00:00", grace=20))])
        out = self._run(current, plan)
        self.assertEqual([d["name"] for d in out["disable_ssas"]], ["SSA-A"])
        self.assertEqual(len(out["add_identities"]), 1)
        self.assertEqual(out["unchanged_identities"], [])

    def test_noop_when_target_matches_current(self):
        same = self._identity(["Monday"], _profile("09:00:00", "17:00:00"))
        current = {same: [{"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON"}]}
        plan = self._plan([self._group(["Monday"], _profile("09:00:00", "17:00:00"))])
        out = self._run(current, plan)
        self.assertEqual(out["disable_ssas"], [])
        self.assertEqual(out["add_identities"], [])
        self.assertEqual(out["unchanged_identities"], [same])

    def test_identity_collision_disables_all_sharing_ssas(self):
        # Two enabled SSAs resolve to the SAME structural identity; both are leaving.
        # Both must land in disable_ssas — not silently dropped to the last writer.
        shared = self._identity(["Monday"], _profile("09:00:00", "17:00:00"))
        current = {
            shared: [
                {"ssa": "SSA-A", "shift_schedule": "PAT_A", "shift_type": "FT", "label": "MON"},
                {"ssa": "SSA-B", "shift_schedule": "PAT_A_DUP", "shift_type": "FT", "label": "MON"},
            ]
        }
        # Target is a different day, so the shared identity leaves entirely.
        plan = self._plan([self._group(["Tuesday"], _profile("09:00:00", "17:00:00"))])
        out = self._run(current, plan)
        self.assertEqual(sorted(d["name"] for d in out["disable_ssas"]), ["SSA-A", "SSA-B"])


class TestReconcileOrphanSsas(unittest.TestCase):
    def test_disables_trims_inactivates_never_cancels(self):
        import frappe
        from dewey_time.attendance_engine import schedule_resolver

        preview = {
            "effective_from": "2026-07-01",
            "disable_ssas": [{"name": "SSA-B", "shift_schedule": "PAT_B", "shift_type": "FT"}],
            "add_identities": [],
            "unchanged_identities": [],
            "add_labels": [],
            "leaving_labels": ["FRI"],
            "affected_assignments": [
                {"name": "SA-STRADDLE", "action": "end_before", "proposed_end_date": "2026-06-30"},
                {"name": "SA-FUTURE", "action": "inactivate", "proposed_end_date": None},
            ],
        }
        frappe.db.has_column.return_value = True

        docs = {"SA-STRADDLE": type("D", (), {"end_date": None})(), "SA-FUTURE": type("D", (), {"status": "Active"})()}
        for d in docs.values():
            d.save = lambda **kw: None
        cancel_called = {"n": 0}

        def fake_get_doc(doctype, name):
            doc = docs[name]
            doc.cancel = lambda: cancel_called.__setitem__("n", cancel_called["n"] + 1)
            return doc

        with patch.object(schedule_resolver, "build_reconcile_preview", return_value=preview), patch.object(
            schedule_resolver, "_disable_ssa"
        ) as disable, patch.object(schedule_resolver.frappe, "get_doc", side_effect=fake_get_doc):
            out = schedule_resolver.reconcile_orphan_ssas(
                employee="EMP-1", plan={"groups": []}, effective_from=date(2026, 7, 1)
            )

        disable.assert_called_once_with("SSA-B")
        self.assertEqual(out["disabled_ssas"], ["SSA-B"])
        self.assertEqual(out["trimmed_assignments"], ["SA-STRADDLE"])
        self.assertEqual(out["inactivated_assignments"], ["SA-FUTURE"])
        self.assertEqual(docs["SA-FUTURE"].status, "Inactive")
        self.assertEqual(cancel_called["n"], 0)


if __name__ == "__main__":
    unittest.main()
