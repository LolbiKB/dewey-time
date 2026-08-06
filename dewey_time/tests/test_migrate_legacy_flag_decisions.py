# dewey_time/tests/test_migrate_legacy_flag_decisions.py
import json
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

        # Fixed group_key on every migrated row: reverse_decision_group()
        # undoes a whole group_key at once, so this is what lets an operator
        # bulk-undo the legacy migration through the normal decision API.
        self.assertEqual(approved_doc["group_key"], "AFD-LEGACY-MIGRATION")
        self.assertEqual(rejected_doc["group_key"], "AFD-LEGACY-MIGRATION")

        # insert() must run with ignore_permissions=True -- this is a one-off
        # migration script with no logged-in HR session behind it.
        for call in get_doc.return_value.insert.call_args_list:
            self.assertTrue(call.kwargs.get("ignore_permissions"))

    def test_scan_filters_to_auto_source_only(self):
        """source == "AUTO" is not incidental: flag_identity() is
        hard-prefixed "AUTO-" (flag_identity.py:181), and both native
        readers of a decision filter to source == "AUTO" for exactly that
        reason (flag_queue_api.py:102-105, flag_decision_api.py:153) --
        migrating a non-AUTO (HR-created) flag would write a decision at an
        identity that actually belongs to the engine's own AUTO flag for
        the same employee/date/code, not the HR-created one.
        """
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        with patch.object(patch_mod.frappe, "get_all", return_value=[]) as get_all, patch.object(
            patch_mod.frappe, "log_error"
        ):
            patch_mod.execute()

        filters = get_all.call_args.kwargs["filters"]
        self.assertEqual(filters.get("source"), "AUTO")

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

    def test_blank_hr_note_gets_a_synthesised_note(self):
        """hr_note was never required on the Desk form, so a blank one is
        likely the majority case for legacy APPROVED/REJECTED rows, not an
        edge case. Since this migration always writes reason="OTHER" (which
        Attendance Flag Decision.validate() requires a note for), a blank
        hr_note must not silently doom the row to the failed bucket -- it
        gets a synthesised placeholder so the HR judgment itself survives.
        """
        row = dict(_legacy_rows()[0])  # APPROVED
        row["hr_note"] = None

        get_doc, _log_error = self._run_with([row], exists=False)

        self.assertEqual(get_doc.call_count, 1)
        written = get_doc.call_args.args[0]
        self.assertEqual(
            written["note"],
            "Migrated from legacy Desk decision (status=APPROVED); no HR note recorded.",
        )

    def test_write_failure_is_counted_and_does_not_abort(self):
        """Any insert()-time failure -- the doctype's own required-note
        validation, a bad Employee link, a db error -- must be counted
        failed and must never abort the batch. Simulated directly on the
        mocked insert() rather than tied to a blank hr_note specifically,
        since _note_for() means a blank hr_note no longer triggers this
        particular failure in practice (see
        test_blank_hr_note_gets_a_synthesised_note).
        """
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        rows = _legacy_rows()[:2]  # APPROVED (insert raises), REJECTED (succeeds)

        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=False
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc, patch.object(patch_mod.frappe, "log_error") as log_error:
            get_doc.return_value.insert.side_effect = [Exception("note required"), None]
            # Must not raise -- one bad write must never abort the batch.
            patch_mod.execute()

        # Both rows were attempted despite the first insert() raising.
        self.assertEqual(get_doc.call_count, 2)

        titles = [call.kwargs.get("title", "") for call in log_error.call_args_list]
        self.assertTrue(
            any("write failed" in t for t in titles),
            "an insert() failure must be logged, not silently dropped",
        )
        summary = log_error.call_args_list[-1]
        self.assertIn("failed=1", summary.kwargs.get("message", ""))
        self.assertIn("migrated=1", summary.kwargs.get("message", ""))

    def test_identity_matches_flag_identity_for_evidence_keyed_code(self):
        """Pins the invariant this task exists for: a migrated row's
        flag_identity must exactly equal what a live reader (e.g.
        flag_queue_api._flag_rows) computes for the same flag, or the
        decision attaches to nothing -- invisible, with the suite still
        green. Every row in _legacy_rows() carries evidence=None, so none
        of them exercise a suffix builder; MISSING_TIME's suffix embeds
        interval_start and would still pass a "startswith AUTO-" check
        under a broken builder, which is why this asserts full equality.
        """
        from dewey_time.attendance_engine.flag_identity import (
            date_key,
            flag_identity as real_flag_identity,
            parse_evidence,
        )

        row = {
            "name": "AUTO-hr-emp-00005-2026-07-23-missing-time-...",
            "employee": "HR-EMP-00005",
            "attendance_date": "2026-07-23",
            "flag_code": "MISSING_TIME",
            "evidence": json.dumps(
                {"interval_start": "2026-07-23T08:15:00", "minutes": 45, "reason": "gap"}
            ),
            "status": "APPROVED",
            "hr_note": "approved after review",
            "hr_user": "hr.manager@dewey.test",
            "hr_decided_at": "2026-07-23 18:00:00",
        }

        expected = real_flag_identity(
            employee=row["employee"],
            attendance_date=date_key(row["attendance_date"]),
            flag_code=row["flag_code"],
            evidence=parse_evidence(row["evidence"]),
        )

        get_doc, _log_error = self._run_with([row], exists=False)
        written = get_doc.call_args.args[0]
        self.assertEqual(written["flag_identity"], expected)
        self.assertIn("missing-time", written["flag_identity"])

    def test_reversed_migration_is_not_recreated(self):
        """A migrated decision an operator deliberately reversed via
        reverse_decision_group() leaves no live (superseded=0) row behind,
        but the reversed row itself -- tagged with the migration's fixed
        group_key -- still exists. A re-run must treat that tag alone as
        "already handled", or it would silently recreate the very decision
        the operator just undid.
        """
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        rows = _legacy_rows()[:1]  # APPROVED

        def _exists(_doctype, filters):
            if filters.get("superseded") == 0:
                return False  # nothing live for this identity -- it was reversed
            return filters.get("group_key") == patch_mod._MIGRATION_GROUP_KEY

        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", side_effect=_exists
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc, patch.object(patch_mod.frappe, "log_error") as log_error:
            patch_mod.execute()

        self.assertEqual(
            get_doc.call_count,
            0,
            "a decision this migration wrote, then an operator reversed, must not be recreated",
        )
        summary = log_error.call_args_list[-1]
        self.assertIn("skipped=1", summary.kwargs.get("message", ""))

    def test_registered_in_patches_txt(self):
        """A patch file with no manifest entry never runs (CLAUDE.md constraint 12)."""
        from pathlib import Path

        manifest = Path(__file__).resolve().parents[1] / "patches.txt"
        self.assertIn(
            "dewey_time.patches.migrate_legacy_flag_decisions",
            manifest.read_text(),
        )

    def test_registered_under_post_model_sync(self):
        """A header-less patches.txt is treated as [pre_model_sync] by
        Frappe's get_patches_from_app -- patches run BEFORE sync_all()
        creates DocType tables. Attendance Flag Decision is introduced on
        this same branch (Task 6), so on the release that ships this patch
        its own target doctype does not exist yet unless this entry sits
        under an explicit [post_model_sync] header. The 20 pre-existing
        entries must stay unheadered (and therefore un-reordered) -- only
        this new entry needs the header immediately above it.
        """
        from pathlib import Path

        manifest = Path(__file__).resolve().parents[1] / "patches.txt"
        text = manifest.read_text()
        marker = "dewey_time.patches.migrate_legacy_flag_decisions"

        self.assertIn("[post_model_sync]", text)
        header_index = text.index("[post_model_sync]")
        patch_index = text.index(marker)
        self.assertLess(
            header_index,
            patch_index,
            "migrate_legacy_flag_decisions must be listed under [post_model_sync], "
            "or it runs before Attendance Flag Decision's table exists",
        )


if __name__ == "__main__":
    unittest.main()
