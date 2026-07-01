import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402

# The mock frappe is a MagicMock, so `except frappe.ValidationError` would try to
# catch a non-class. Make it a real exception type (matches production semantics).
frappe.ValidationError = type("ValidationError", (Exception,), {})

VALID_PATTERN = {
    "frequency": "Every Week",
    "days": [{"weekday": "Monday", "works": True, "start_time": "09:00:00", "end_time": "17:00:00"}],
}


def _ctx(**over):
    base = {
        "employee": "EMP-1",
        "employee_name": "A",
        "company": "C",
        "branch": "B",
        "employment_type": "Full-time",
    }
    base.update(over)
    return base


class TestApplyEditPath(unittest.TestCase):
    def _apply(self, *, enabled, plan, reconcile, confirm, today="2026-06-01"):
        import frappe
        from dewey_time.attendance_engine import schedule_api

        frappe.session = type("S", (), {"user": "Administrator"})()
        with patch.object(schedule_api, "_require_hr_role"), patch.object(
            schedule_api, "_employee_header", return_value=_ctx()
        ), patch.object(schedule_api, "validate_week_pattern", return_value=[]), patch.object(
            schedule_api, "resolve_apply_employment_type", return_value=("noop", None)
        ), patch.object(schedule_api, "employee_has_enabled_ssas", return_value=enabled), patch.object(
            schedule_api, "build_resolve_plan", return_value=plan
        ), patch.object(schedule_api, "build_reconcile_preview", return_value=reconcile), patch.object(
            schedule_api,
            "reconcile_orphan_ssas",
            return_value={"disabled_ssas": [], "trimmed_assignments": [], "inactivated_assignments": []},
        ) as recon, patch.object(schedule_api, "nowdate", return_value=today), patch.object(
            schedule_api, "create_shift_type", return_value="FT"
        ), patch.object(schedule_api, "create_shift_schedule", return_value="PAT_NEW"), patch.object(
            schedule_api, "upsert_ssa", return_value="SSA-NEW"
        ), patch.object(schedule_api, "generate_shifts_for_ssa") as gen, patch.object(
            schedule_api, "record_schedule_change", return_value="SCL-1"
        ) as record, patch.object(
            schedule_api, "shift_generation_end_date", return_value="2026-09-29"
        ):
            self._record = record
            result = schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern=VALID_PATTERN,
                create_shifts_after="2026-07-01",
                confirm_create=confirm,
            )
        return result, recon, gen

    def test_pure_add_edit_still_needs_confirm(self):
        # Existing PAT reused (needs_create False), but a new identity is added.
        plan = {
            "groups": [
                {
                    "days": ["Monday"],
                    "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
                    "shift_type": {"action": "use", "name": "FT"},
                    "shift_schedule": {"action": "use", "name": "PAT_USE"},
                }
            ],
            "needs_create": False,
            "warnings": [],
        }
        reconcile = {
            "effective_from": "2026-07-01",
            "disable_ssas": [],
            "add_identities": ["k1"],
            "unchanged_identities": [],
            "add_labels": ["MON 09–17"],
            "leaving_labels": [],
            "affected_assignments": [],
        }
        result, _, _ = self._apply(enabled=True, plan=plan, reconcile=reconcile, confirm=False)
        self.assertTrue(result.get("needs_confirm"))

    def test_confirm_skips_unchanged_and_retires_first(self):
        from dewey_time.attendance_engine.schedule_resolver import group_identity_key

        unchanged_group = {
            "days": ["Monday"],
            "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
            "shift_type": {"action": "use", "name": "FT"},
            "shift_schedule": {"action": "use", "name": "PAT_KEEP"},
        }
        add_group = {
            "days": ["Friday"],
            "profile": {"start_time": "09:00:00", "end_time": "14:00:00"},
            "shift_type": {"action": "use", "name": "FT2"},
            "shift_schedule": {"action": "create", "proposed_name": "PAT_FRI"},
        }
        plan = {"groups": [unchanged_group, add_group], "needs_create": True, "warnings": []}
        reconcile = {
            "effective_from": "2026-07-01",
            "disable_ssas": [],
            "add_identities": [group_identity_key(add_group)],
            "unchanged_identities": [group_identity_key(unchanged_group)],
            "add_labels": ["FRI 09–14"],
            "leaving_labels": [],
            "affected_assignments": [],
        }
        result, recon, gen = self._apply(enabled=True, plan=plan, reconcile=reconcile, confirm=True)
        self.assertTrue(result.get("ok"))
        recon.assert_called_once()  # retire-first
        # Generated only for the adding group, not the unchanged one.
        self.assertEqual(gen.call_count, 1)
        self.assertIn("reconciled", result)

    def test_forward_only_guard_blocks_past_effective_date_on_edit(self):
        plan = {"groups": [], "needs_create": False, "warnings": []}
        with self.assertRaises(Exception):
            self._apply(
                enabled=True,
                plan=plan,
                reconcile={
                    "disable_ssas": [],
                    "add_identities": [],
                    "unchanged_identities": [],
                    "affected_assignments": [],
                },
                confirm=True,
                today="2026-07-01",  # E == today -> blocked
            )


    def test_fresh_create_does_not_call_build_reconcile_preview(self):
        # A fresh setup (no enabled SSAs) must NOT traverse the reconcile / SSA-listing path,
        # so unpatched fresh-create tests stay isolated from real frappe under `bench run-tests`.
        import frappe
        from dewey_time.attendance_engine import schedule_api

        plan = {"groups": [], "needs_create": True, "warnings": []}
        frappe.session = type("S", (), {"user": "Administrator"})()
        with patch.object(schedule_api, "_require_hr_role"), patch.object(
            schedule_api, "_employee_header", return_value=_ctx()
        ), patch.object(schedule_api, "validate_week_pattern", return_value=[]), patch.object(
            schedule_api, "resolve_apply_employment_type", return_value=("noop", None)
        ), patch.object(schedule_api, "employee_has_enabled_ssas", return_value=False), patch.object(
            schedule_api, "build_resolve_plan", return_value=plan
        ), patch.object(schedule_api, "build_reconcile_preview") as preview, patch.object(
            schedule_api, "nowdate", return_value="2026-06-01"
        ):
            result = schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern=VALID_PATTERN,
                create_shifts_after="2026-07-01",
                generate_through="",
                confirm_create=False,
            )
        self.assertTrue(result.get("needs_confirm"))  # needs_create drives confirm
        preview.assert_not_called()


    def test_confirmed_apply_records_a_change(self):
        add_group = {
            "days": ["Monday"],
            "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
            "shift_type": {"action": "use", "name": "FT"},
            "shift_schedule": {"action": "use", "name": "PAT_USE"},
        }
        plan = {"groups": [add_group], "needs_create": False, "warnings": []}
        reconcile = {
            "effective_from": "2026-07-01",
            "disable_ssas": [],
            "add_identities": ["k1"],
            "unchanged_identities": [],
            "add_labels": ["MON 09-17"],
            "leaving_labels": [],
            "affected_assignments": [],
        }
        result, _, _ = self._apply(enabled=True, plan=plan, reconcile=reconcile, confirm=True)
        self.assertTrue(result.get("ok"))
        self._record.assert_called_once()


class TestApplyDeadlockRetry(unittest.TestCase):
    """Bulk import applies employees concurrently → transient InnoDB deadlocks (1213).
    The apply must retry its own transaction rather than surface the raw DB error."""

    def _run(self, gen_side_effect):
        import frappe
        from dewey_time.attendance_engine import schedule_api

        add_group = {
            "days": ["Monday"],
            "profile": {"start_time": "09:00:00", "end_time": "17:00:00"},
            "shift_type": {"action": "use", "name": "FT"},
            "shift_schedule": {"action": "use", "name": "PAT_USE"},
        }
        plan = {"groups": [add_group], "needs_create": False, "warnings": []}
        reconcile = {
            "effective_from": "2026-07-01",
            "disable_ssas": [],
            "add_identities": ["k1"],
            "unchanged_identities": [],
            "add_labels": ["MON 09-17"],
            "leaving_labels": [],
            "affected_assignments": [],
        }

        frappe.session = type("S", (), {"user": "Administrator"})()
        frappe.db.rollback.reset_mock()
        frappe.db.commit.reset_mock()
        with patch.object(schedule_api, "_require_hr_role"), patch.object(
            schedule_api, "_employee_header", return_value=_ctx()
        ), patch.object(schedule_api, "validate_week_pattern", return_value=[]), patch.object(
            schedule_api, "resolve_apply_employment_type", return_value=("noop", None)
        ), patch.object(schedule_api, "employee_has_enabled_ssas", return_value=True), patch.object(
            schedule_api, "build_resolve_plan", return_value=plan
        ), patch.object(schedule_api, "build_reconcile_preview", return_value=reconcile), patch.object(
            schedule_api,
            "reconcile_orphan_ssas",
            return_value={"disabled_ssas": [], "trimmed_assignments": [], "inactivated_assignments": []},
        ), patch.object(schedule_api, "nowdate", return_value="2026-06-01"), patch.object(
            schedule_api, "upsert_ssa", return_value="SSA-NEW"
        ), patch.object(
            schedule_api, "generate_shifts_for_ssa", side_effect=gen_side_effect
        ) as gen, patch.object(
            schedule_api, "record_schedule_change", return_value="SCL-1"
        ), patch.object(
            schedule_api, "shift_generation_end_date", return_value="2026-09-29"
        ), patch.object(schedule_api.time, "sleep") as sleep:
            result = schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern=VALID_PATTERN,
                create_shifts_after="2026-07-01",
                confirm_create=True,
            )
        return result, gen, sleep

    def test_retries_deadlock_then_succeeds(self):
        import frappe

        deadlock = Exception(
            "(1213, 'Deadlock found when trying to get lock; try restarting transaction')"
        )
        result, gen, sleep = self._run([deadlock, None])

        self.assertTrue(result.get("ok"))
        self.assertEqual(gen.call_count, 2)  # failed once, retried, succeeded
        sleep.assert_called_once()
        frappe.db.rollback.assert_called_once()
        frappe.db.commit.assert_called_once()

    def test_gives_up_after_max_retries(self):
        from dewey_time.attendance_engine import schedule_api

        deadlock = Exception("1213 deadlock; try restarting transaction")
        # Always deadlocks → exhausts retries and re-raises.
        with self.assertRaises(Exception):
            self._run([deadlock] * (schedule_api._MAX_APPLY_LOCK_RETRIES + 5))

    def test_non_lock_error_is_not_retried(self):
        boom = Exception("some other failure")
        with self.assertRaises(Exception):
            self._run([boom, None])

    def test_retries_transient_shift_type_race(self):
        import frappe

        # Cross-lane race: the shared Shift Type isn't visible yet → link fails.
        race = frappe.ValidationError("Could not find Shift Type: FT_0700_1100")
        result, gen, sleep = self._run([race, None])

        self.assertTrue(result.get("ok"))
        self.assertEqual(gen.call_count, 2)
        sleep.assert_called_once()

    def test_ordinary_validation_error_is_not_retried(self):
        import frappe

        # A real validation failure (not the race) must surface immediately.
        with self.assertRaises(Exception):
            self._run([frappe.ValidationError("Start and end are required"), None])


if __name__ == "__main__":
    unittest.main()
