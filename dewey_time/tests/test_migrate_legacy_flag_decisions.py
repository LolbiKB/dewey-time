# dewey_time/tests/test_migrate_legacy_flag_decisions.py
import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


def _legacy_rows():
    """Four Attendance Flag rows spanning every status this patch must handle.

    Two map cleanly (APPROVED, REJECTED); two have no Attendance Flag Decision
    equivalent (CLOSED predates this feature, EXPLAINED belongs to Spec 2's
    employee-note flow) and must be skipped rather than guessed at.
    """
    return [
        {
            "name": "AUTO-hr-emp-00001-2026-07-19-late-start",
            "employee": "HR-EMP-00001",
            "attendance_date": "2026-07-19",
            "flag_code": "LATE_START",
            "evidence": None,
            "status": "APPROVED",
            "hr_note": "manager pre-approved the late start",
            "hr_user": "hr.manager@dewey.test",
            "hr_decided_at": "2026-07-19 18:00:00",
        },
        {
            "name": "AUTO-hr-emp-00002-2026-07-20-off-shift-punch",
            "employee": "HR-EMP-00002",
            "attendance_date": "2026-07-20",
            "flag_code": "OFF_SHIFT_PUNCH",
            "evidence": None,
            "status": "REJECTED",
            "hr_note": "no valid reason given",
            "hr_user": "hr.manager@dewey.test",
            "hr_decided_at": "2026-07-20 09:30:00",
        },
        {
            "name": "AUTO-hr-emp-00003-2026-07-21-missing-time-08-00",
            "employee": "HR-EMP-00003",
            "attendance_date": "2026-07-21",
            "flag_code": "MISSING_TIME",
            "evidence": None,
            "status": "CLOSED",
            "hr_note": None,
            "hr_user": None,
            "hr_decided_at": None,
        },
        {
            "name": "AUTO-hr-emp-00004-2026-07-22-attendance-issue-single-checkin",
            "employee": "HR-EMP-00004",
            "attendance_date": "2026-07-22",
            "flag_code": "ATTENDANCE_ISSUE",
            "evidence": None,
            "status": "EXPLAINED",
            "hr_note": None,
            "hr_user": None,
            "hr_decided_at": None,
        },
    ]


class TestMigrateLegacyFlagDecisions(unittest.TestCase):
    def _run_with(self, rows, *, exists=False):
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=exists
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc, patch.object(
            patch_mod.frappe, "log_error"
        ) as log_error:
            patch_mod.execute()
        return get_doc, log_error

    def test_approved_maps_to_excused_and_rejected_to_upheld(self):
        rows = _legacy_rows()[:2]  # APPROVED, REJECTED only
        get_doc, _log_error = self._run_with(rows, exists=False)

        self.assertEqual(get_doc.call_count, 2)
        written = [call.args[0] for call in get_doc.call_args_list]

        approved_doc = next(d for d in written if d["employee"] == "HR-EMP-00001")
        self.assertEqual(approved_doc["doctype"], "Attendance Flag Decision")
        self.assertEqual(approved_doc["outcome"], "EXCUSED")
        self.assertEqual(approved_doc["reason"], "OTHER")
        self.assertEqual(approved_doc["note"], "manager pre-approved the late start")
        self.assertEqual(approved_doc["decided_by"], "hr.manager@dewey.test")
        self.assertEqual(approved_doc["decided_at"], "2026-07-19 18:00:00")
        self.assertTrue(approved_doc["flag_identity"].startswith("AUTO-"))

        rejected_doc = next(d for d in written if d["employee"] == "HR-EMP-00002")
        self.assertEqual(rejected_doc["outcome"], "UPHELD")
        self.assertEqual(rejected_doc["reason"], "OTHER")

        # insert() must run with ignore_permissions=True -- this is a one-off
        # migration script with no logged-in HR session behind it.
        for call in get_doc.return_value.insert.call_args_list:
            self.assertTrue(call.kwargs.get("ignore_permissions"))

    def test_closed_and_explained_are_skipped_and_counted(self):
        rows = _legacy_rows()
        get_doc, log_error = self._run_with(rows, exists=False)

        # Only the two mappable rows (APPROVED, REJECTED) ever reach get_doc.
        # If CLOSED/EXPLAINED were wrongly mapped, this would be 4, not 2 --
        # this assertion fails against a naive "status != OPEN -> migrate"
        # implementation that invents an outcome for every non-OPEN row.
        self.assertEqual(get_doc.call_count, 2)

        titles = [call.kwargs.get("title", "") for call in log_error.call_args_list]
        skip_titles = [t for t in titles if "no decision equivalent" in t]
        self.assertEqual(
            len(skip_titles), 2, "CLOSED and EXPLAINED must each be logged, not silently dropped"
        )

        summary = log_error.call_args_list[-1]
        self.assertIn("summary", summary.kwargs.get("title", ""))
        self.assertIn("migrated=2", summary.kwargs.get("message", ""))
        self.assertIn("skipped=2", summary.kwargs.get("message", ""))
        self.assertIn("failed=0", summary.kwargs.get("message", ""))

    def test_second_run_creates_no_duplicates(self):
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        rows = _legacy_rows()[:2]

        # First run: no live decision exists yet for either identity.
        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=False
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc_first, patch.object(patch_mod.frappe, "log_error"):
            patch_mod.execute()
        self.assertEqual(get_doc_first.call_count, 2)

        # Second run: both identities now resolve to a live decision (either
        # written by the first run, or by a fresh decide_flags() call made
        # through the new page in the meantime) -- exists() now returns True.
        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=True
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc_second, patch.object(
            patch_mod.frappe, "log_error"
        ) as log_error_second:
            patch_mod.execute()

        self.assertEqual(
            get_doc_second.call_count,
            0,
            "a re-run must not write a duplicate decision for an identity that already has one",
        )
        summary = log_error_second.call_args_list[-1]
        self.assertIn("migrated=0", summary.kwargs.get("message", ""))

    def test_identity_failure_is_counted_and_does_not_abort(self):
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        rows = _legacy_rows()[:2]  # APPROVED (will fail), REJECTED (will succeed)

        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=False
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod, "flag_identity", side_effect=[ValueError("bad evidence"), "AUTO-hr-emp-00002-2026-07-20-off-shift-punch"]
        ), patch.object(patch_mod.frappe, "get_doc") as get_doc, patch.object(
            patch_mod.frappe, "log_error"
        ) as log_error:
            # Must not raise -- one bad row must never abort the batch.
            patch_mod.execute()

        # Only the second (REJECTED) row made it through to a write.
        self.assertEqual(get_doc.call_count, 1)
        self.assertEqual(get_doc.call_args.args[0]["employee"], "HR-EMP-00002")

        titles = [call.kwargs.get("title", "") for call in log_error.call_args_list]
        self.assertTrue(
            any("flag_identity" in t for t in titles),
            "the unmapped-identity row must be logged, not silently dropped",
        )
        summary = log_error.call_args_list[-1]
        self.assertIn("failed=1", summary.kwargs.get("message", ""))
        self.assertIn("migrated=1", summary.kwargs.get("message", ""))

    def test_registered_in_patches_txt(self):
        """A patch file with no manifest entry never runs (CLAUDE.md constraint 12)."""
        from pathlib import Path

        manifest = Path(__file__).resolve().parents[1] / "patches.txt"
        self.assertIn(
            "dewey_time.patches.migrate_legacy_flag_decisions",
            manifest.read_text(),
        )


if __name__ == "__main__":
    unittest.main()
