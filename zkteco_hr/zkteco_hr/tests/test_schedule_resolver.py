import json
import unittest
from datetime import date, timedelta
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

    def test_compact_days_label_ranges(self):
        from zkteco_hr.attendance_engine.schedule_resolver import (
            WEEKDAYS,
            compact_days_label,
            proposed_pat_name,
        )

        profile = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "lunch_start": "12:00:00",
            "lunch_end": "13:00:00",
        }
        self.assertEqual(compact_days_label(list(WEEKDAYS), profile), "MON-SUN")
        self.assertEqual(compact_days_label(list(WEEKDAYS[:6]), profile), "MON-SAT")
        self.assertEqual(
            compact_days_label(["Monday", "Wednesday", "Friday"], profile),
            "MON-WED-FRI",
        )
        self.assertEqual(
            compact_days_label(["Wednesday", "Thursday", "Friday"], profile),
            "WED-FRI",
        )
        self.assertEqual(
            compact_days_label(
                ["Monday", "Tuesday", "Thursday", "Friday", "Saturday"],
                profile,
            ),
            "MON-TUE-THU-FRI-SAT",
        )

    def test_proposed_pat_name_mon_sun(self):
        from zkteco_hr.attendance_engine.schedule_resolver import WEEKDAYS, proposed_pat_name

        profile = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "lunch_start": "12:00:00",
            "lunch_end": "13:00:00",
        }
        name = proposed_pat_name(list(WEEKDAYS), "FT_0800_1700", profile)
        self.assertEqual(name, "PAT_MON-SUN_FT_0800_1700_L1200_1300")


class TestMatchShiftSchedule(unittest.TestCase):
    def _make_pat_doc(self, name, days, shift_type="FT_0800_1700", frequency="Every Week"):
        doc = MagicMock()
        doc.name = name
        doc.docstatus = 1
        doc.shift_type = shift_type
        doc.frequency = frequency
        rows = [MagicMock(day=day) for day in days]
        doc.repeat_on_days = rows
        return doc

    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.get_doc")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.get_all")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.exists")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.table_exists")
    def test_prefers_canonical_pat_over_autoname(self, table_exists, exists, get_all, get_doc):
        from zkteco_hr.attendance_engine.schedule_resolver import match_shift_schedule

        table_exists.return_value = True
        exists.return_value = False
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        profile = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "lunch_start": "12:00:00",
            "lunch_end": "13:00:00",
        }
        canonical = "PAT_MON-FRI_FT_0800_1700_L1200_1300"
        autoname = "HR-SCH-26-06-00001"
        get_all.return_value = [autoname, canonical]

        def doc_loader(_doctype, name):
            if name == canonical:
                return self._make_pat_doc(canonical, days)
            return self._make_pat_doc(autoname, days)

        get_doc.side_effect = doc_loader

        result = match_shift_schedule(
            days=days,
            shift_type="FT_0800_1700",
            profile=profile,
        )
        self.assertEqual(result["action"], "use")
        self.assertEqual(result["name"], canonical)

    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.get_doc")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.get_all")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.exists")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.table_exists")
    def test_fast_path_reuses_proposed_name(self, table_exists, exists, get_all, get_doc):
        from zkteco_hr.attendance_engine.schedule_resolver import match_shift_schedule

        table_exists.return_value = True
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        profile = {
            "start_time": "08:00:00",
            "end_time": "17:00:00",
            "lunch_start": "12:00:00",
            "lunch_end": "13:00:00",
        }
        canonical = "PAT_MON-FRI_FT_0800_1700_L1200_1300"
        exists.side_effect = lambda _dt, name: name == canonical
        get_doc.return_value = self._make_pat_doc(canonical, days)
        get_all.return_value = []

        result = match_shift_schedule(
            days=days,
            shift_type="FT_0800_1700",
            profile=profile,
        )
        self.assertEqual(result["action"], "use")
        self.assertEqual(result["name"], canonical)
        get_all.assert_not_called()


class TestCreateShiftSchedule(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_resolver.match_shift_schedule")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.new_doc")
    def test_sets_doc_name_on_create(self, new_doc, match_schedule):
        from zkteco_hr.attendance_engine.schedule_resolver import create_shift_schedule

        match_schedule.return_value = {"action": "create", "proposed_name": "PAT_MON-FRI_FT_0800_1700"}
        doc = MagicMock()
        doc.name = None
        new_doc.return_value = doc

        name = create_shift_schedule(
            days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            shift_type="FT_0800_1700",
            profile={"start_time": "08:00:00", "end_time": "17:00:00"},
            name="PAT_MON-FRI_FT_0800_1700",
        )
        self.assertEqual(doc.name, "PAT_MON-FRI_FT_0800_1700")
        doc.insert.assert_called_once()
        doc.submit.assert_called_once()
        self.assertEqual(name, doc.name)

    @patch("zkteco_hr.attendance_engine.schedule_resolver.match_shift_schedule")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.new_doc")
    def test_insert_failure_falls_back_to_rematch(self, new_doc, match_schedule):
        from zkteco_hr.attendance_engine.schedule_resolver import create_shift_schedule

        match_schedule.side_effect = [
            {"action": "create", "proposed_name": "PAT_MON-FRI_FT_0800_1700"},
            {"action": "use", "name": "PAT_MON-FRI_FT_0800_1700"},
        ]
        doc = MagicMock()
        doc.insert.side_effect = Exception("duplicate")
        new_doc.return_value = doc

        name = create_shift_schedule(
            days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            shift_type="FT_0800_1700",
            profile={"start_time": "08:00:00", "end_time": "17:00:00"},
        )
        self.assertEqual(name, "PAT_MON-FRI_FT_0800_1700")
        self.assertEqual(match_schedule.call_count, 2)


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
    @patch("zkteco_hr.attendance_engine.schedule_resolver.frappe.db.exists")
    def test_no_match_returns_create(self, exists, has_column, table_exists, get_all):
        from zkteco_hr.attendance_engine.schedule_resolver import match_shift_type

        table_exists.return_value = True
        has_column.return_value = True
        get_all.return_value = []
        exists.return_value = False

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


class TestShiftGenerationEndDate(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_resolver.add_days")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.getdate")
    def test_open_ended_uses_hrms_default_window(self, getdate, add_days):
        from zkteco_hr.attendance_engine.schedule_resolver import (
            DEFAULT_SHIFT_GENERATION_DAYS,
            shift_generation_end_date,
        )

        getdate.side_effect = lambda value: date.fromisoformat(str(value))
        add_days.side_effect = lambda value, days: date.fromisoformat(str(value)) + timedelta(days=days)

        end = shift_generation_end_date("2026-06-01", None)
        self.assertEqual(end, date(2026, 6, 1) + timedelta(days=DEFAULT_SHIFT_GENERATION_DAYS))

    @patch("zkteco_hr.attendance_engine.schedule_resolver.getdate")
    def test_explicit_through(self, getdate):
        from zkteco_hr.attendance_engine.schedule_resolver import shift_generation_end_date

        getdate.side_effect = lambda value: date.fromisoformat(str(value))
        end = shift_generation_end_date("2026-06-01", "2026-09-01")
        self.assertEqual(end, date(2026, 9, 1))


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


class TestWeeklyScheduleEligibility(unittest.TestCase):
    def test_is_weekly_schedule_eligible(self):
        from zkteco_hr.attendance_engine.schedule_resolver import is_weekly_schedule_eligible

        self.assertTrue(is_weekly_schedule_eligible("Full-time"))
        self.assertTrue(is_weekly_schedule_eligible("part-time fixed"))
        self.assertFalse(is_weekly_schedule_eligible("Part-time Flexible"))
        self.assertFalse(is_weekly_schedule_eligible(None))
        self.assertFalse(is_weekly_schedule_eligible(""))


class TestScheduleApi(unittest.TestCase):
    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.db.has_column", return_value=True)
    @patch("zkteco_hr.attendance_engine.schedule_api.employee_has_enabled_ssas")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.add_days")
    @patch("zkteco_hr.attendance_engine.schedule_resolver.getdate")
    @patch("zkteco_hr.attendance_engine.schedule_api.getdate")
    @patch("zkteco_hr.attendance_engine.schedule_api.build_resolve_plan")
    @patch("zkteco_hr.attendance_engine.schedule_api._employee_header")
    @patch("zkteco_hr.attendance_engine.schedule_api._require_hr_role")
    def test_apply_returns_needs_confirm_without_flag(
        self, _role, _header, build_plan, api_getdate, resolver_getdate, resolver_add_days, has_enabled, _has_col
    ):
        from zkteco_hr.attendance_engine import schedule_api

        has_enabled.return_value = False
        _header.return_value = {"employment_type": "Full-time", "company": "Co"}
        build_plan.return_value = {"needs_create": True, "groups": []}
        parse = lambda value: date.fromisoformat(str(value))
        api_getdate.side_effect = parse
        resolver_getdate.side_effect = parse
        resolver_add_days.side_effect = lambda value, days: parse(value) + timedelta(days=days)

        result = schedule_api.apply_weekly_schedule(
            employee="EMP-1",
            week_pattern=json.dumps({"frequency": "Every Week", "days": []}),
            create_shifts_after="2026-06-02",
            generate_through="2026-09-01",
            confirm_create=False,
        )

        self.assertTrue(result["needs_confirm"])
        self.assertIn("plan", result)

    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.db.has_column", return_value=True)
    @patch("zkteco_hr.attendance_engine.schedule_api.employee_has_enabled_ssas", return_value=False)
    @patch("zkteco_hr.attendance_engine.schedule_api._employee_header")
    @patch("zkteco_hr.attendance_engine.schedule_api._require_hr_role")
    def test_apply_blocked_when_employment_type_ineligible(self, _role, _header, _has_enabled, _has_col):
        from zkteco_hr.attendance_engine import schedule_api

        _header.return_value = {"employment_type": "Part-time Flexible", "company": "Co"}

        with self.assertRaises(Exception):
            schedule_api.apply_weekly_schedule(
                employee="EMP-1",
                week_pattern=json.dumps({"frequency": "Every Week", "days": []}),
                create_shifts_after="2026-06-02",
            )

    @patch("zkteco_hr.attendance_engine.schedule_api.frappe.db.has_column", return_value=True)
    @patch("zkteco_hr.attendance_engine.schedule_api.employee_has_enabled_ssas")
    @patch("zkteco_hr.attendance_engine.schedule_api._employee_header")
    @patch("zkteco_hr.attendance_engine.schedule_api._require_hr_role")
    def test_apply_blocked_when_employee_has_enabled_ssa(self, _role, _header, has_enabled, _has_col):
        from zkteco_hr.attendance_engine import schedule_api

        has_enabled.return_value = True
        _header.return_value = {"employment_type": "Full-time", "company": "Co"}

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
