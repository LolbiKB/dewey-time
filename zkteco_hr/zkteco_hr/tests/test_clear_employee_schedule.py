import unittest
from unittest.mock import MagicMock, call, patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import sys  # noqa: E402
import frappe  # noqa: E402

frappe.LinkExistsError = type("LinkExistsError", (Exception,), {})
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
    if mod_name.startswith("zkteco_hr.attendance_engine."):
        del sys.modules[mod_name]


class TestPreviewClearEmployeeSchedule(unittest.TestCase):
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1", "SA-2"],
    )
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-1"],
    )
    @patch("zkteco_hr.attendance_engine.schedule_resolver._count_attendance_flags", return_value=7)
    def test_preview_returns_counts(self, _flags, _ssas, _sas):
        from zkteco_hr.attendance_engine.schedule_resolver import preview_clear_employee_schedule

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

    @patch("zkteco_hr.attendance_engine.schedule_resolver._count_attendance_flags", return_value=0)
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=[],
    )
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1"],
    )
    def test_clear_deletes_linked_checkins_before_cancel(self, _sas, _ssas, _flags):
        from zkteco_hr.attendance_engine.schedule_resolver import clear_employee_schedule

        doc = MagicMock()
        doc.docstatus = 1
        doc.employee = "DI-1138"
        doc.shift_type = "Morning"
        doc.start_date = "2026-05-01"
        doc.end_date = "2026-05-31"
        frappe.get_doc.return_value = doc

        def get_all_side_effect(doctype, filters=None, pluck=None):
            if doctype == "Employee Checkin":
                return ["EMP-CKIN-1"]
            if doctype == "Attendance":
                return []
            return []

        frappe.get_all = MagicMock(side_effect=get_all_side_effect)
        frappe.db.table_exists = MagicMock(return_value=True)

        clear_employee_schedule("DI-1138")

        frappe.delete_doc.assert_any_call(
            "Employee Checkin", "EMP-CKIN-1", force=1, ignore_permissions=True
        )
        doc.cancel.assert_called_once()

    @patch("zkteco_hr.attendance_engine.schedule_resolver._count_attendance_flags", return_value=3)
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-A"],
    )
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=["SA-1"],
    )
    def test_clear_cancels_submitted_assignment_then_deletes(self, _sas, _ssas, _flags):
        from zkteco_hr.attendance_engine.schedule_resolver import clear_employee_schedule

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
        frappe.delete_doc.assert_any_call("Shift Assignment", "SA-1", force=1)
        frappe.delete_doc.assert_any_call("Shift Schedule Assignment", "SSA-A", force=1)
        frappe.db.delete.assert_called_once_with("Attendance Flag", {"employee": "DI-1138"})
        self.assertEqual(result["cancelled_assignments"], ["SA-1"])
        self.assertEqual(result["deleted_assignments"], ["SA-1"])
        self.assertEqual(result["deleted_ssas"], ["SSA-A"])
        self.assertEqual(result["deleted_flags"], 3)

    @patch("zkteco_hr.attendance_engine.schedule_resolver._count_attendance_flags", return_value=0)
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_ssa_names",
        return_value=["SSA-B"],
    )
    @patch(
        "zkteco_hr.attendance_engine.schedule_resolver._list_employee_shift_assignment_names",
        return_value=[],
    )
    @patch("zkteco_hr.attendance_engine.schedule_resolver._disable_ssa")
    def test_clear_ssa_delete_link_error_disables(self, disable_ssa, _sas, _ssas, _flags):
        from zkteco_hr.attendance_engine.schedule_resolver import clear_employee_schedule

        frappe.get_all = MagicMock(return_value=[])
        frappe.db.table_exists = MagicMock(return_value=True)

        def delete_side_effect(doctype, name, force=1):
            if doctype == "Shift Schedule Assignment":
                raise frappe.LinkExistsError("linked")

        frappe.delete_doc.side_effect = delete_side_effect

        result = clear_employee_schedule("DI-1138")

        disable_ssa.assert_called_once_with("SSA-B")
        self.assertEqual(result["disabled_ssas"], ["SSA-B"])
        self.assertEqual(result["deleted_ssas"], [])


class TestClearEmployeeScheduleApi(unittest.TestCase):
    def setUp(self):
        frappe.get_roles.return_value = ["HR User"]
        frappe.session.user = "hr@example.com"
        frappe.db.exists.return_value = True
        frappe.form_dict = {}
        frappe.throw = MagicMock(side_effect=lambda msg, **kwargs: (_ for _ in ()).throw(Exception(msg)))

    @patch("zkteco_hr.attendance_engine.dev_tools.preview_clear_employee_schedule")
    def test_api_without_confirm_returns_preview(self, preview_fn):
        import zkteco_hr.attendance_engine.dev_tools as dev_tools

        preview_fn.return_value = {"ssa_count": 1}
        result = dev_tools.clear_employee_schedule_api(employee="DI-1138", confirm=False)

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["ssa_count"], 1)
        preview_fn.assert_called_once_with("DI-1138")

    @patch("zkteco_hr.attendance_engine.dev_tools.clear_employee_schedule")
    def test_api_with_confirm_requires_system_manager(self, clear_fn):
        import zkteco_hr.attendance_engine.dev_tools as dev_tools

        frappe.get_roles.return_value = ["HR User"]

        with self.assertRaises(Exception):
            dev_tools.clear_employee_schedule_api(employee="DI-1138", confirm=True)

        clear_fn.assert_not_called()

    @patch("zkteco_hr.attendance_engine.dev_tools.clear_employee_schedule")
    def test_api_with_confirm_system_manager_commits(self, clear_fn):
        import zkteco_hr.attendance_engine.dev_tools as dev_tools

        frappe.get_roles.return_value = ["System Manager"]
        clear_fn.return_value = {"ok": True, "deleted_flags": 0}

        result = dev_tools.clear_employee_schedule_api(employee="DI-1138", confirm=True)

        clear_fn.assert_called_once_with("DI-1138")
        frappe.db.commit.assert_called()
        self.assertTrue(result["ok"])


class TestClearAllEmployeeSchedules(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_resolver._employees_for_schedule_clear")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.clear_employee_schedule")
    def test_clear_all_aggregates_totals(self, clear_fn, list_fn):
        from zkteco_hr.attendance_engine.schedule_resolver import clear_all_employee_schedules

        list_fn.return_value = ["E-1", "E-2"]
        clear_fn.side_effect = [
            {
                "ok": True,
                "employee": "E-1",
                "cancelled_assignments": ["SA-1"],
                "deleted_assignments": ["SA-1"],
                "deleted_ssas": ["SSA-1"],
                "disabled_ssas": [],
                "deleted_flags": 2,
            },
            {
                "ok": True,
                "employee": "E-2",
                "cancelled_assignments": [],
                "deleted_assignments": ["SA-2"],
                "deleted_ssas": [],
                "disabled_ssas": ["SSA-2"],
                "deleted_flags": 1,
            },
        ]

        result = clear_all_employee_schedules()

        self.assertTrue(result["ok"])
        self.assertEqual(result["employee_count"], 2)
        self.assertEqual(result["cleared_count"], 2)
        self.assertEqual(result["cancelled_assignments"], 1)
        self.assertEqual(result["deleted_assignments"], 2)
        self.assertEqual(result["deleted_ssas"], 1)
        self.assertEqual(result["disabled_ssas"], 1)
        self.assertEqual(result["deleted_flags"], 3)

    @patch("zkteco_hr.attendance_engine.schedule_resolver._employees_for_schedule_clear")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.clear_employee_schedule")
    def test_clear_all_collects_errors(self, clear_fn, list_fn):
        from zkteco_hr.attendance_engine.schedule_resolver import clear_all_employee_schedules

        list_fn.return_value = ["E-1", "E-2"]
        clear_fn.side_effect = [
            {
                "ok": True,
                "employee": "E-1",
                "cancelled_assignments": [],
                "deleted_assignments": [],
                "deleted_ssas": [],
                "disabled_ssas": [],
                "deleted_flags": 0,
            },
            Exception("blocked"),
        ]

        result = clear_all_employee_schedules()

        self.assertFalse(result["ok"])
        self.assertEqual(result["cleared_count"], 1)
        self.assertEqual(result["error_count"], 1)
        self.assertEqual(result["errors"][0]["employee"], "E-2")


class TestClearAllEmployeeSchedulesApi(unittest.TestCase):
    def setUp(self):
        frappe.get_roles.return_value = ["System Manager"]
        frappe.session.user = "admin@example.com"
        frappe.form_dict = {}
        frappe.throw = MagicMock(side_effect=lambda msg, **kwargs: (_ for _ in ()).throw(Exception(msg)))

    @patch("zkteco_hr.attendance_engine.dev_tools.preview_clear_all_employee_schedules")
    def test_api_without_confirm_returns_preview(self, preview_fn):
        import zkteco_hr.attendance_engine.dev_tools as dev_tools

        preview_fn.return_value = {"employee_count": 12}
        result = dev_tools.clear_all_employee_schedules_api(confirm=False)

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["employee_count"], 12)

    @patch("zkteco_hr.attendance_engine.dev_tools.clear_all_employee_schedules")
    def test_api_requires_confirm_phrase(self, clear_fn):
        import zkteco_hr.attendance_engine.dev_tools as dev_tools

        with self.assertRaises(Exception):
            dev_tools.clear_all_employee_schedules_api(confirm=True, confirm_phrase="nope")

        clear_fn.assert_not_called()

    @patch("zkteco_hr.attendance_engine.dev_tools.clear_all_employee_schedules")
    def test_api_with_phrase_commits(self, clear_fn):
        import zkteco_hr.attendance_engine.dev_tools as dev_tools

        clear_fn.return_value = {"ok": True, "cleared_count": 5}
        result = dev_tools.clear_all_employee_schedules_api(
            confirm=True,
            confirm_phrase="CLEAR ALL SCHEDULES",
        )

        clear_fn.assert_called_once_with(include_all_active=False)
        frappe.db.commit.assert_called()
        self.assertTrue(result["ok"])
