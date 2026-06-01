import json
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


class TestGroupWeekPattern(unittest.TestCase):
    def test_groups_mon_fri_and_saturday(self):
        from zkteco_hr.attendance_engine.schedule_resolver import group_week_pattern

        days = [
            {
                "weekday": "Monday",
                "works": True,
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
                "grace_minutes": 10,
            },
            {
                "weekday": "Tuesday",
                "works": True,
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
                "grace_minutes": 10,
            },
            {
                "weekday": "Wednesday",
                "works": True,
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
                "grace_minutes": 10,
            },
            {
                "weekday": "Thursday",
                "works": True,
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
                "grace_minutes": 10,
            },
            {
                "weekday": "Friday",
                "works": True,
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
                "grace_minutes": 10,
            },
            {
                "weekday": "Saturday",
                "works": True,
                "start_time": "08:00:00",
                "end_time": "12:00:00",
                "grace_minutes": 10,
            },
            {"weekday": "Sunday", "works": False},
        ]

        groups = group_week_pattern(days)
        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[0]["days"]), 5)
        self.assertEqual(groups[1]["days"], ["Saturday"])

    def test_skips_invalid_end_before_start(self):
        from zkteco_hr.attendance_engine.schedule_resolver import group_week_pattern

        groups = group_week_pattern(
            [
                {
                    "weekday": "Monday",
                    "works": True,
                    "start_time": "17:00:00",
                    "end_time": "08:00:00",
                }
            ]
        )
        self.assertEqual(groups, [])


class TestNaming(unittest.TestCase):
    def test_proposed_shift_type_name(self):
        from zkteco_hr.attendance_engine.schedule_resolver import proposed_shift_type_name

        self.assertEqual(
            proposed_shift_type_name({"start_time": "08:00:00", "end_time": "17:00:00"}),
            "FT_0800_1700",
        )

    def test_proposed_pat_name_mon_fri(self):
        from zkteco_hr.attendance_engine.schedule_resolver import proposed_pat_name

        profile = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "lunch_start": "12:00:00",
            "lunch_end": "13:00:00",
        }
        name = proposed_pat_name(
            ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            "FT_0800_1700",
            profile,
        )
        self.assertEqual(name, "PAT_MON-FRI_FT_0800_1700_L1200_1300")


class TestMatchShiftType(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.get_all")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.table_exists")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.has_column")
    def test_exact_match_returns_use(self, has_column, table_exists, get_all):
        from zkteco_hr.attendance_engine.schedule_resolver import match_shift_type

        table_exists.return_value = True
        has_column.return_value = True
        get_all.return_value = [
            {
                "name": "FT_0800_1700",
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "custom_lunch_start": "12:00:00",
                "custom_lunch_end": "13:00:00",
                "custom_grace_minutes": 10,
            }
        ]

        result = match_shift_type(
            {
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
                "grace_minutes": 10,
            }
        )
        self.assertEqual(result["action"], "use")
        self.assertEqual(result["name"], "FT_0800_1700")

    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.get_all")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.table_exists")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.has_column")
    def test_no_match_returns_create(self, has_column, table_exists, get_all):
        from zkteco_hr.attendance_engine.schedule_resolver import match_shift_type

        table_exists.return_value = True
        has_column.return_value = True
        get_all.return_value = []

        result = match_shift_type(
            {
                "start_time": "08:00:00",
                "end_time": "12:00:00",
                "lunch_start": None,
                "lunch_end": None,
                "grace_minutes": 10,
            }
        )
        self.assertEqual(result["action"], "create")
        self.assertEqual(result["proposed_name"], "FT_0800_1200")


class TestEnabledSsaGate(unittest.TestCase):
    def test_inactive_or_disabled_ssa_not_enabled(self):
        from zkteco_hr.attendance_engine.schedule_resolver import is_ssa_enabled

        self.assertFalse(is_ssa_enabled({"enabled": 0, "shift_status": "Inactive"}))
        self.assertFalse(is_ssa_enabled({"enabled": 0, "shift_status": "Active"}))
        self.assertTrue(is_ssa_enabled({"enabled": 1, "shift_status": "Active"}))

    @patch("zkteco_hr.attendance_engine.schedule_resolver.list_employee_ssas")
    def test_employee_has_enabled_ssas(self, list_ssas):
        from zkteco_hr.attendance_engine.schedule_resolver import employee_has_enabled_ssas

        list_ssas.return_value = [{"enabled": 1, "shift_status": "Active"}]
        self.assertTrue(employee_has_enabled_ssas("EMP-1"))

        list_ssas.return_value = [{"enabled": 0, "shift_status": "Inactive"}]
        self.assertFalse(employee_has_enabled_ssas("EMP-1"))


class TestScheduleApi(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_api.employee_has_enabled_ssas")
    @patch("zkteco_hr.attendance_engine.schedule_api.getdate")
    @patch("zkteco_hr.attendance_engine.schedule_api.build_resolve_plan")
    @patch("zkteco_hr.attendance_engine.schedule_api._employee_header")
    @patch("zkteco_hr.attendance_engine.schedule_api._require_hr_role")
    def test_apply_returns_needs_confirm_without_flag(
        self, _role, _header, build_plan, getdate, has_enabled
    ):
        from zkteco_hr.attendance_engine import schedule_api

        has_enabled.return_value = False
        build_plan.return_value = {"needs_create": True, "groups": []}
        getdate.side_effect = lambda value: date.fromisoformat(str(value))

        result = schedule_api.apply_weekly_schedule(
            employee="EMP-1",
            week_pattern=json.dumps({"frequency": "Every Week", "days": []}),
            create_shifts_after="2026-06-02",
            generate_through="2026-09-01",
            confirm_create=False,
        )

        self.assertTrue(result["needs_confirm"])
        self.assertIn("plan", result)

    @patch("zkteco_hr.attendance_engine.schedule_api.employee_has_enabled_ssas")
    @patch("zkteco_hr.attendance_engine.schedule_api._employee_header")
    @patch("zkteco_hr.attendance_engine.schedule_api._require_hr_role")
    def test_apply_blocked_when_employee_has_enabled_ssa(self, _role, _header, has_enabled):
        from zkteco_hr.attendance_engine import schedule_api

        has_enabled.return_value = True

        with self.assertRaises(Exception):
            schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern=json.dumps({"frequency": "Every Week", "days": []}),
                create_shifts_after="2026-06-02",
                generate_through="2026-09-01",
                confirm_create=True,
            )


class TestScheduleTemplates(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_api._require_hr_role")
    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.cache")
    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.get_all")
    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.db.table_exists")
    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.db.has_column")
    @patch("zkteco_hr.attendance_engine.schedule_api._blocks_from_week_pattern")
    def test_templates_deduped_and_sorted_by_count(
        self,
        blocks_from_pattern,
        has_column,
        table_exists,
        get_all,
        cache,
        _role,
    ):
        from zkteco_hr.attendance_engine import schedule_api

        table_exists.return_value = True
        has_column.side_effect = lambda _dt, col: col in ("enabled", "end_date")
        cache.return_value.get_value.return_value = None

        get_all.return_value = [
            {"employee": "EMP-1", "end_date": None},
            {"employee": "EMP-2", "end_date": None},
            {"employee": "EMP-3", "end_date": None},
        ]

        tpl_a = [
            {
                "id": "tpl-0",
                "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                "profile": {
                    "start_time": "08:00",
                    "end_time": "17:00",
                    "lunch_start": "12:00",
                    "lunch_end": "13:00",
                    "grace_minutes": 10,
                },
            }
        ]
        tpl_b = [
            {
                "id": "tpl-0",
                "days": ["Saturday"],
                "profile": {
                    "start_time": "08:00",
                    "end_time": "12:00",
                    "lunch_start": None,
                    "lunch_end": None,
                    "grace_minutes": 10,
                },
            }
        ]

        def blocks_side_effect(emp):
            if emp in ("EMP-1", "EMP-2"):
                return tpl_a
            return tpl_b

        blocks_from_pattern.side_effect = blocks_side_effect

        payload = schedule_api.list_weekly_schedule_templates(limit=10)
        templates = payload["templates"]

        self.assertEqual(len(templates), 2)
        self.assertEqual(templates[0]["count"], 2)
        self.assertEqual(templates[1]["count"], 1)


if __name__ == "__main__":
    unittest.main()
