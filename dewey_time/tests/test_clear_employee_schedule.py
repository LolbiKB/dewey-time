import unittest
from unittest.mock import MagicMock, call, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import sys  # noqa: E402
import frappe  # noqa: E402

frappe.LinkExistsError = type("LinkExistsError", (Exception,), {})
frappe.PermissionError = type("PermissionError", (Exception,), {})
frappe.get_roles = MagicMock(return_value=["System Manager"])
frappe.session.user = "admin@example.com"
frappe.db.exists = MagicMock(return_value=True)
frappe.db.commit = MagicMock()
frappe.db.rollback = MagicMock()
frappe.db.table_exists = MagicMock(return_value=True)
frappe.db.count = MagicMock(return_value=5)
frappe.db.delete = MagicMock()
frappe.db.has_column = MagicMock(return_value=True)
frappe.form_dict = {}

for mod_name in list(sys.modules):
    if mod_name.startswith("dewey_time.attendance_engine."):
        del sys.modules[mod_name]


class TestPreviewClearEmployeeSchedule(unittest.TestCase):
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1", "SA-2"],
    )
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-1"],
    )
    @patch("dewey_time.attendance_engine.schedule_resolver._count_attendance_flags", return_value=7)
    def test_preview_returns_counts(self, _flags, _ssas, _sas):
        from dewey_time.attendance_engine.schedule_resolver import preview_clear_employee_schedule

        result = preview_clear_employee_schedule("DI-1138")

        self.assertEqual(result["employee"], "DI-1138")
        self.assertEqual(result["shift_assignment_count"], 2)
        self.assertEqual(result["ssa_count"], 1)
        self.assertEqual(result["attendance_flag_count"], 7)
        self.assertEqual(result["sample_shift_assignments"], ["SA-1", "SA-2"])


class TestClearEmployeeSchedule(unittest.TestCase):
    def setUp(self):
        frappe.delete_doc = MagicMock()
        frappe.get_doc = MagicMock()

    @patch("dewey_time.attendance_engine.schedule_resolver._count_attendance_flags", return_value=0)
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=[],
    )
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1"],
    )
    def test_clear_preserves_checkins_and_attendance(self, _sas, _ssas, _flags):
        """Source punch data (Employee Checkin / HRMS Attendance) must survive a
        schedule wipe. The assignment is force-removed without touching punches."""
        from dewey_time.attendance_engine.schedule_resolver import clear_employee_schedule

        doc = MagicMock()
        doc.docstatus = 1
        doc.employee = "DI-1138"
        doc.shift_type = "Morning"
        doc.start_date = "2026-05-01"
        doc.end_date = "2026-05-31"
        frappe.get_doc.return_value = doc
        frappe.get_all = MagicMock(return_value=[])
        frappe.db.table_exists = MagicMock(return_value=True)

        clear_employee_schedule("DI-1138")

        # Assignment is removed and cancelled...
        frappe.delete_doc.assert_any_call(
            "Shift Assignment", "SA-1", force=1, ignore_permissions=True
        )
        doc.cancel.assert_called_once()
        # ...but nothing ever deletes a checkin or attendance row.
        deleted_doctypes = [
            (c.args[0] if c.args else c.kwargs.get("doctype"))
            for c in frappe.delete_doc.call_args_list
        ]
        self.assertNotIn("Employee Checkin", deleted_doctypes)
        self.assertNotIn("Attendance", deleted_doctypes)

    @patch("dewey_time.attendance_engine.schedule_resolver._count_attendance_flags", return_value=3)
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-A"],
    )
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1"],
    )
    def test_clear_cancels_submitted_assignment_then_deletes(self, _sas, _ssas, _flags):
        from dewey_time.attendance_engine.schedule_resolver import clear_employee_schedule

        doc = MagicMock()
        doc.docstatus = 1
        doc.employee = "DI-1138"
        doc.shift_type = "Morning"
        doc.start_date = "2026-05-01"
        doc.end_date = None
        frappe.get_doc.return_value = doc
        frappe.get_all = MagicMock(return_value=[])
        frappe.db.table_exists = MagicMock(return_value=True)

        result = clear_employee_schedule("DI-1138")

        doc.cancel.assert_called_once()
        frappe.delete_doc.assert_any_call(
            "Shift Assignment", "SA-1", force=1, ignore_permissions=True
        )
        frappe.delete_doc.assert_any_call(
            "Shift Schedule Assignment", "SSA-A", force=1, ignore_permissions=True
        )
        frappe.db.delete.assert_called_once_with("Attendance Flag", {"employee": "DI-1138"})
        self.assertEqual(result["cancelled_assignments"], ["SA-1"])
        self.assertEqual(result["deleted_assignments"], ["SA-1"])
        self.assertEqual(result["deleted_ssas"], ["SSA-A"])
        self.assertEqual(result["deleted_flags"], 3)

    @patch("dewey_time.attendance_engine.schedule_resolver._count_attendance_flags", return_value=0)
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-B"],
    )
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=[],
    )
    @patch("dewey_time.attendance_engine.schedule_resolver._disable_ssa")
    def test_clear_ssa_link_error_still_force_deletes(self, disable_ssa, _sas, _ssas, _flags):
        """A Desk link used to downgrade the SSA to disable-only. It must now be
        force-removed via the raw-SQL fallback so the wipe leaves nothing behind."""
        from dewey_time.attendance_engine.schedule_resolver import clear_employee_schedule

        frappe.get_all = MagicMock(return_value=[])
        frappe.db.table_exists = MagicMock(return_value=True)
        frappe.db.delete = MagicMock()

        def delete_side_effect(doctype, name, *args, **kwargs):
            # ORM refuses at every tier — only the raw fallback can remove it.
            if doctype == "Shift Schedule Assignment":
                raise frappe.LinkExistsError("linked")

        frappe.delete_doc.side_effect = delete_side_effect

        result = clear_employee_schedule("DI-1138")

        disable_ssa.assert_not_called()
        self.assertEqual(result["deleted_ssas"], ["SSA-B"])
        self.assertEqual(result["disabled_ssas"], [])
        frappe.db.delete.assert_any_call("Shift Schedule Assignment", {"name": "SSA-B"})

    @patch("dewey_time.attendance_engine.schedule_resolver._count_attendance_flags", return_value=0)
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=[],
    )
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1", "SA-2"],
    )
    @patch("dewey_time.attendance_engine.schedule_resolver._delete_shift_assignment")
    def test_one_bad_row_does_not_abort_the_rest(self, del_sa, _sas, _ssas, _flags):
        """A single row that resists removal is recorded as an error but the
        remaining rows are still deleted — the clear never aborts mid-employee."""
        from dewey_time.attendance_engine.schedule_resolver import clear_employee_schedule

        del_sa.side_effect = [Exception("stuck"), (None, "SA-2")]

        result = clear_employee_schedule("DI-1138")

        self.assertEqual(result["deleted_assignments"], ["SA-2"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"][0]["name"], "SA-1")


class TestClearEmployeeSchedulePermissionBypass(unittest.TestCase):
    """Regression: the destructive cancel/delete ops must bypass per-doctype
    permissions. The API gate (`_require_system_manager_for_clear`) is the only
    authorization boundary; HRMS doctypes (Shift Assignment / Shift Schedule
    Assignment) do NOT grant delete/cancel to System Manager, so without
    ignore_permissions a System-Manager 'admin' gets a 403 PermissionError.
    """

    def setUp(self):
        frappe.delete_doc = MagicMock()
        frappe.get_doc = MagicMock()
        frappe.get_all = MagicMock(return_value=[])
        frappe.db.table_exists = MagicMock(return_value=True)

    @patch("dewey_time.attendance_engine.schedule_resolver._count_attendance_flags", return_value=0)
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-A"],
    )
    @patch(
        "dewey_time.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1"],
    )
    def test_clear_bypasses_doctype_permissions(self, _sas, _ssas, _flags):
        from dewey_time.attendance_engine.schedule_resolver import clear_employee_schedule

        doc = MagicMock()
        doc.docstatus = 1
        doc.employee = "DI-1138"
        doc.shift_type = "Morning"
        doc.start_date = "2026-05-01"
        doc.end_date = None
        doc.flags.ignore_permissions = False

        def cancel_side_effect():
            if not getattr(doc.flags, "ignore_permissions", False):
                raise frappe.PermissionError("No permission to cancel Shift Assignment")

        doc.cancel.side_effect = cancel_side_effect
        frappe.get_doc.return_value = doc

        def delete_side_effect(doctype, name, force=1, ignore_permissions=False):
            if not ignore_permissions:
                raise frappe.PermissionError(f"No permission to delete {doctype}")

        frappe.delete_doc.side_effect = delete_side_effect

        # Must complete without raising PermissionError (the reported 403).
        result = clear_employee_schedule("DI-1138")

        self.assertEqual(result["deleted_assignments"], ["SA-1"])
        self.assertEqual(result["cancelled_assignments"], ["SA-1"])
        self.assertEqual(result["deleted_ssas"], ["SSA-A"])


class TestClearEmployeeScheduleApi(unittest.TestCase):
    def setUp(self):
        frappe.get_roles.return_value = ["HR User"]
        frappe.session.user = "hr@example.com"
        frappe.db.exists.return_value = True
        frappe.form_dict = {}
        frappe.throw = MagicMock(side_effect=lambda msg, *args, **kwargs: (_ for _ in ()).throw(Exception(msg)))

    @patch("dewey_time.attendance_engine.dev_tools.preview_clear_employee_schedule")
    def test_api_without_confirm_returns_preview(self, preview_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        preview_fn.return_value = {"ssa_count": 1}
        result = dev_tools.clear_employee_schedule_api(employee="DI-1138", confirm=False)

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["ssa_count"], 1)
        preview_fn.assert_called_once_with("DI-1138")

    @patch("dewey_time.attendance_engine.dev_tools.clear_employee_schedule")
    def test_api_with_confirm_requires_system_manager(self, clear_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        frappe.get_roles.return_value = ["HR User"]

        with self.assertRaises(Exception):
            dev_tools.clear_employee_schedule_api(employee="DI-1138", confirm=True)

        clear_fn.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools.clear_employee_schedule")
    def test_api_with_confirm_system_manager_commits(self, clear_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        frappe.get_roles.return_value = ["System Manager"]
        clear_fn.return_value = {"ok": True, "deleted_flags": 0}

        result = dev_tools.clear_employee_schedule_api(employee="DI-1138", confirm=True)

        clear_fn.assert_called_once_with("DI-1138")
        frappe.db.commit.assert_called()
        self.assertTrue(result["ok"])


class TestClearAllEmployeeSchedules(unittest.TestCase):
    """Clear-all rides the same bulk batch engine as the site wipe (one deletion
    mechanism). Success is the verified end-state (tables empty), and the dialog's
    contract keys (deleted_* tallies) come from the pre-wipe counts."""

    # _EMPLOYEE_WIPE_TABLES order: Attendance Flag, Shift Assignment, SSA.

    @patch("dewey_time.attendance_engine.schedule_resolver.purge_site_wipe_table_batch")
    @patch("dewey_time.attendance_engine.schedule_resolver._table_count")
    @patch("dewey_time.attendance_engine.schedule_resolver._employees_for_schedule_clear")
    def test_clear_all_bulk_wipes_and_reports_precounts(self, list_fn, count_fn, purge_fn):
        from dewey_time.attendance_engine.schedule_resolver import clear_all_employee_schedules

        list_fn.return_value = ["E-1", "E-2"]
        # pre: flags=2, SA=10, SSA=3 → post: all 0
        count_fn.side_effect = [2, 10, 3, 0, 0, 0]
        purge_fn.return_value = {"deleted": 2000, "remaining": 0}

        result = clear_all_employee_schedules()

        self.assertTrue(result["ok"])
        self.assertTrue(result["verified_empty"])
        self.assertEqual(result["employee_count"], 2)
        self.assertEqual(result["cleared_count"], 2)
        self.assertEqual(result["deleted_flags"], 2)
        self.assertEqual(result["deleted_assignments"], 10)
        self.assertEqual(result["deleted_ssas"], 3)
        self.assertEqual(result["error_count"], 0)
        # One purge per non-empty table (each emptied in a single batch here).
        self.assertEqual(purge_fn.call_count, 3)

    @patch("dewey_time.attendance_engine.schedule_resolver.purge_site_wipe_table_batch")
    @patch("dewey_time.attendance_engine.schedule_resolver._table_count")
    @patch("dewey_time.attendance_engine.schedule_resolver._employees_for_schedule_clear")
    def test_clear_all_bails_and_reports_when_table_stops_shrinking(self, list_fn, count_fn, purge_fn):
        """A table whose rows resist deletion must not spin forever — bail after a
        no-progress pass and report the leftovers honestly (ok=False)."""
        from dewey_time.attendance_engine.schedule_resolver import clear_all_employee_schedules

        list_fn.return_value = ["E-1"]
        # pre: flags=5, SA=0, SSA=0 → post: flags still 5.
        count_fn.side_effect = [5, 0, 0, 5, 0, 0]
        purge_fn.return_value = {"deleted": 0, "remaining": 5}  # never shrinks

        result = clear_all_employee_schedules()

        self.assertFalse(result["ok"])
        self.assertFalse(result["verified_empty"])
        self.assertEqual(result["cleared_count"], 0)
        self.assertEqual(result["error_count"], 1)
        self.assertEqual(result["errors"][0], {"table": "Attendance Flag", "remaining": 5})
        # No-progress detection: exactly one purge attempt for the stuck table.
        self.assertEqual(purge_fn.call_count, 1)

    @patch("dewey_time.attendance_engine.schedule_resolver.purge_site_wipe_table_batch")
    @patch("dewey_time.attendance_engine.schedule_resolver._table_count")
    @patch("dewey_time.attendance_engine.schedule_resolver._employees_for_schedule_clear")
    def test_clear_all_loops_batches_until_table_empty(self, list_fn, count_fn, purge_fn):
        from dewey_time.attendance_engine.schedule_resolver import clear_all_employee_schedules

        list_fn.return_value = ["E-1"]
        # pre: flags=0, SA=4500, SSA=0 → post: all 0. SA drains over 3 batches.
        count_fn.side_effect = [0, 4500, 0, 0, 0, 0]
        purge_fn.side_effect = [
            {"deleted": 2000, "remaining": 2500},
            {"deleted": 2000, "remaining": 500},
            {"deleted": 500, "remaining": 0},
        ]

        result = clear_all_employee_schedules()

        self.assertTrue(result["ok"])
        self.assertEqual(result["deleted_assignments"], 4500)
        self.assertEqual(purge_fn.call_count, 3)


class TestClearAllEmployeeSchedulesApi(unittest.TestCase):
    def setUp(self):
        frappe.get_roles.return_value = ["System Manager"]
        frappe.session.user = "admin@example.com"
        frappe.form_dict = {}
        frappe.throw = MagicMock(side_effect=lambda msg, *args, **kwargs: (_ for _ in ()).throw(Exception(msg)))

    @patch("dewey_time.attendance_engine.dev_tools.preview_clear_all_employee_schedules")
    def test_api_without_confirm_returns_preview(self, preview_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        preview_fn.return_value = {"employee_count": 12}
        result = dev_tools.clear_all_employee_schedules_api(confirm=False)

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["employee_count"], 12)

    @patch("dewey_time.attendance_engine.dev_tools.clear_all_employee_schedules")
    def test_api_requires_confirm_phrase(self, clear_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        with self.assertRaises(Exception):
            dev_tools.clear_all_employee_schedules_api(confirm=True, confirm_phrase="nope")

        clear_fn.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools.clear_all_employee_schedules")
    def test_api_with_phrase_commits(self, clear_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        clear_fn.return_value = {"ok": True, "cleared_count": 5}
        result = dev_tools.clear_all_employee_schedules_api(
            confirm=True,
            confirm_phrase="CLEAR ALL SCHEDULES",
        )

        clear_fn.assert_called_once_with(include_all_active=False)
        frappe.db.commit.assert_called()
        self.assertTrue(result["ok"])


class TestClearSiteSchedulePatterns(unittest.TestCase):
    def setUp(self):
        frappe.db.table_exists = MagicMock(return_value=True)
        frappe.get_all = MagicMock(return_value=[])
        frappe.delete_doc = MagicMock()
        frappe.get_doc = MagicMock()

    @patch("dewey_time.attendance_engine.schedule_resolver.preview_clear_all_employee_schedules")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.count", return_value=3)
    def test_preview_includes_pattern_counts(self, _count, employee_preview):
        from dewey_time.attendance_engine.schedule_resolver import preview_clear_site_schedule_patterns

        employee_preview.return_value = {"employee_count": 2}
        frappe.get_all.side_effect = lambda doctype, **kwargs: (
            ["PAT-1", "PAT-2"] if doctype == "Shift Schedule" else ["FT-1"]
        )

        result = preview_clear_site_schedule_patterns(clear_employee_data=True)

        self.assertEqual(result["shift_schedule_count"], 3)
        self.assertEqual(result["shift_type_count"], 3)
        self.assertEqual(result["sample_shift_schedules"], ["PAT-1", "PAT-2"])
        employee_preview.assert_called_once()

    @patch("dewey_time.attendance_engine.schedule_resolver.clear_site_patterns_step")
    @patch("dewey_time.attendance_engine.schedule_resolver._table_count", return_value=0)
    def test_one_shot_drives_step_engine_to_done(self, _count, step_fn):
        """The one-shot wipe is a thin driver over the SAME stepped bulk engine the
        UI uses — no second deletion mechanism."""
        from dewey_time.attendance_engine.schedule_resolver import clear_site_schedule_patterns

        def get_all_side_effect(doctype, **kwargs):
            if doctype == "Shift Schedule":
                return ["PAT-A"]
            if doctype == "Shift Type":
                return ["FT-A"]
            return []

        frappe.get_all.side_effect = get_all_side_effect
        empty = {t: 0 for t in ("Attendance Flag", "Shift Assignment",
                                "Shift Schedule Assignment", "Shift Schedule", "Shift Type")}
        step_fn.side_effect = [
            {"done": False, "total_remaining": 7, "verified_empty": False, "remaining_counts": None},
            {"done": True, "total_remaining": 0, "verified_empty": True, "remaining_counts": empty},
        ]

        result = clear_site_schedule_patterns(clear_employee_data=True)

        self.assertEqual(step_fn.call_count, 2)
        self.assertTrue(result["ok"])
        self.assertTrue(result["verified_empty"])
        self.assertEqual(result["remaining_counts"]["Shift Type"], 0)
        self.assertEqual(result["deleted_shift_schedules"], ["PAT-A"])
        self.assertEqual(result["deleted_shift_types"], ["FT-A"])
        frappe.db.commit.assert_called()  # commits between batches

    @patch("dewey_time.attendance_engine.schedule_resolver.clear_site_patterns_step")
    @patch("dewey_time.attendance_engine.schedule_resolver._table_count", return_value=4)
    def test_one_shot_bails_on_no_progress_and_reports(self, _count, step_fn):
        """A step that makes no progress (rows resisting deletion) must not spin —
        bail and report ok=False with the honest remaining counts."""
        from dewey_time.attendance_engine.schedule_resolver import clear_site_schedule_patterns

        frappe.get_all.side_effect = lambda doctype, **kwargs: []
        stuck = {"done": False, "total_remaining": 4, "verified_empty": False,
                 "remaining_counts": None}
        step_fn.return_value = stuck

        result = clear_site_schedule_patterns(clear_employee_data=True)

        # First step sets the baseline; the second identical total triggers the bail.
        self.assertEqual(step_fn.call_count, 2)
        self.assertFalse(result["ok"])
        self.assertFalse(result["verified_empty"])
        self.assertEqual(result["remaining_counts"]["Shift Type"], 4)


class TestClearSiteSchedulePatternsApi(unittest.TestCase):
    def setUp(self):
        frappe.get_roles.return_value = ["System Manager"]
        frappe.session.user = "admin@example.com"
        frappe.form_dict = {}
        frappe.throw = MagicMock(side_effect=lambda msg, *args, **kwargs: (_ for _ in ()).throw(Exception(msg)))

    @patch("dewey_time.attendance_engine.dev_tools.preview_clear_site_schedule_patterns")
    def test_api_without_confirm_returns_preview(self, preview_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        preview_fn.return_value = {"shift_schedule_count": 4}
        result = dev_tools.clear_site_schedule_patterns_api(confirm=False)

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["shift_schedule_count"], 4)

    @patch("dewey_time.attendance_engine.dev_tools.clear_site_schedule_patterns")
    def test_api_with_phrase_commits(self, clear_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        clear_fn.return_value = {"ok": True, "deleted_shift_schedules": ["PAT-1"]}
        result = dev_tools.clear_site_schedule_patterns_api(
            confirm=True,
            confirm_phrase="CLEAR SITE PATTERNS",
        )

        clear_fn.assert_called_once_with(clear_employee_data=True)
        frappe.db.commit.assert_called()
        self.assertTrue(result["ok"])


class TestClearSitePatternsStep(unittest.TestCase):
    """The wipe runs as bounded, committed steps so it never times out and can report
    progress. Each step bulk-purges one batch of the first non-empty table."""

    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.get_meta")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.get_all")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.count")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.delete")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.table_exists", return_value=True)
    def test_purge_batch_bulk_deletes_and_reports(self, _te, delete, count, get_all, get_meta):
        from dewey_time.attendance_engine.schedule_resolver import purge_site_wipe_table_batch

        get_all.return_value = ["SA-1", "SA-2", "SA-3"]
        count.return_value = 0  # empty after this batch
        get_meta.return_value.get_table_fields.return_value = []  # no child tables

        result = purge_site_wipe_table_batch("Shift Assignment", batch=2000)

        self.assertEqual(result["deleted"], 3)
        self.assertEqual(result["remaining"], 0)
        delete.assert_any_call("Shift Assignment", {"name": ["in", ["SA-1", "SA-2", "SA-3"]]})

    @patch("dewey_time.attendance_engine.schedule_resolver.purge_site_wipe_table_batch")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.count")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.table_exists", return_value=True)
    def test_step_purges_first_nonempty_table(self, _te, count, purge):
        import dewey_time.attendance_engine.schedule_resolver as sr

        count.return_value = 4  # every table still has rows → not done
        purge.return_value = {"deleted": 4, "remaining": 0}

        result = sr.clear_site_patterns_step(clear_employee_data=True)

        purge.assert_called_once_with("Attendance Flag", sr._WIPE_BATCH)
        self.assertEqual(result["current_table"], "Attendance Flag")
        self.assertEqual(result["deleted"], 4)
        self.assertFalse(result["done"])

    @patch("dewey_time.attendance_engine.schedule_resolver.purge_site_wipe_table_batch")
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.count", return_value=0)
    @patch("dewey_time.attendance_engine.schedule_resolver.frappe.db.table_exists", return_value=True)
    def test_step_reports_done_and_verified_when_empty(self, _te, _count, purge):
        from dewey_time.attendance_engine.schedule_resolver import clear_site_patterns_step

        result = clear_site_patterns_step(clear_employee_data=True)

        purge.assert_not_called()  # nothing left to delete
        self.assertTrue(result["done"])
        self.assertTrue(result["verified_empty"])
        self.assertIsNone(result["current_table"])
        self.assertEqual(result["remaining_counts"]["Shift Type"], 0)


class TestClearSitePatternsStepApi(unittest.TestCase):
    def setUp(self):
        frappe.get_roles.return_value = ["System Manager"]
        frappe.session.user = "admin@example.com"
        frappe.form_dict = {}
        frappe.throw = MagicMock(side_effect=lambda msg, *a, **k: (_ for _ in ()).throw(Exception(msg)))

    @patch("dewey_time.attendance_engine.dev_tools.clear_site_patterns_step")
    def test_api_requires_confirm_phrase(self, step_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        with self.assertRaises(Exception):
            dev_tools.clear_site_patterns_step_api(confirm_phrase="nope")
        step_fn.assert_not_called()

    @patch("dewey_time.attendance_engine.dev_tools.clear_site_patterns_step")
    def test_api_with_phrase_runs_a_step_and_commits(self, step_fn):
        import dewey_time.attendance_engine.dev_tools as dev_tools

        step_fn.return_value = {"done": False, "current_table": "Shift Assignment", "total_remaining": 10}
        result = dev_tools.clear_site_patterns_step_api(confirm_phrase="CLEAR SITE PATTERNS")

        step_fn.assert_called_once_with(clear_employee_data=True)
        frappe.db.commit.assert_called()
        self.assertEqual(result["current_table"], "Shift Assignment")
