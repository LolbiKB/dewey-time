"""Tests for schedule_import.parse_schedule_upload validation."""

from __future__ import annotations

import base64
import unittest
from unittest.mock import patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.attendance_engine import schedule_import as mod


def _csv_b64(content: str) -> str:
    return base64.b64encode(content.encode("utf-8")).decode("ascii")


def _parse(
    content: str,
    *,
    match_employee: str | None = None,
    employment_type: str = "Full-time",
    has_ssa: bool = False,
) -> dict:
    with patch.object(mod, "employee_has_enabled_ssas", return_value=has_ssa):
        with patch.object(mod.frappe, "db") as mock_db:
            mock_db.has_column.return_value = True

            def get_value(doctype, filters, fields, as_dict=False):
                if doctype != "Employee" or not match_employee:
                    return None
                if isinstance(filters, dict) and filters.get("status") == "Active":
                    badge = filters.get("employee_number") or filters.get("attendance_device_id")
                    email = filters.get("company_email") or filters.get("personal_email")
                    if badge or email:
                        return {
                            "name": match_employee,
                            "employee_name": "Test User",
                            "employment_type": employment_type,
                        }
                return None

            mock_db.get_value.side_effect = get_value
            return mod.parse_schedule_upload(_csv_b64(content), "test.csv")


HEADER = "employee_id,email,am_from,am_to,pm_from,pm_to,days_off\n"


class TestScheduleImportValidation(unittest.TestCase):
    def test_full_day_with_lunch(self):
        result = _parse(
            HEADER
            + "DI-0159,boeurnraksmey@diu.edu.kh,07:30,12:00,13:00,17:00,Saturday(am)|Sunday\n"
        )
        row = result["rows"][0]
        self.assertEqual(row["schedule_shape"], "full_day")
        self.assertTrue(row["importable"] is False)  # no employee match in mock
        self.assertEqual(result["summary"]["total_rows"], 1)

    def test_pm_only(self):
        result = _parse(
            HEADER + "DI-0061,khem.bunchhorn@diu.edu.kh,off,off,14:00,17:00,Sunday\n"
        )
        row = result["rows"][0]
        self.assertEqual(row["schedule_shape"], "pm_only")
        self.assertIsNotNone(row["week_pattern"])
        codes = [i["code"] for i in row["issues"]]
        self.assertIn("PM_ONLY", codes)

    def test_continuous_shift(self):
        result = _parse(
            HEADER + "DI-0355,,06:00,off,off,18:00,Sunday\n"
        )
        row = result["rows"][0]
        self.assertEqual(row["schedule_shape"], "continuous")
        self.assertIsNotNone(row["week_pattern"])
        working = [d for d in row["week_pattern"]["days"] if d["works"]]
        self.assertEqual(len(working), 6)
        self.assertEqual(working[0]["start_time"], "06:00")
        self.assertEqual(working[0]["end_time"], "18:00")

    def test_midnight_as_noon_warning(self):
        result = _parse(
            HEADER + "DI-0767,ny.chanun@diu.edu.kh,07:00,00:00,14:00,18:00,Saturday|Sunday\n"
        )
        row = result["rows"][0]
        codes = [i["code"] for i in row["issues"]]
        self.assertIn("MIDNIGHT_AS_NOON", codes)

    def test_missing_employee_id(self):
        result = _parse(
            HEADER + ",someone@diu.edu.kh,07:00,11:00,13:00,17:00,Sunday\n"
        )
        row = result["rows"][0]
        self.assertFalse(row["importable"])
        self.assertTrue(any(i["code"] == "MISSING_EMPLOYEE_ID" for i in row["issues"]))

    def test_garbage_row_date_in_email(self):
        result = _parse(
            HEADER + ",2017-03-03 00:00:00,07:00,11:00,off,off,Sunday\n"
        )
        row = result["rows"][0]
        self.assertTrue(any(i["code"] == "MISSING_EMPLOYEE_ID" for i in row["issues"]))

    def test_invalid_email_comma(self):
        result = _parse(
            HEADER
            + 'DI-1370,"meth,sreymom@diu.edu.kh",07:00,11:30,off,off,Saturday|Sunday\n'
        )
        row = result["rows"][0]
        self.assertTrue(any(i["code"] == "INVALID_EMAIL" for i in row["issues"]))

    def test_duplicate_employee_id(self):
        result = _parse(
            HEADER
            + "DI-0104,,07:00,11:30,13:00,17:15,Saturday|Sunday\n"
            + "DI-0104,,07:00,11:00,13:00,17:00,Sunday\n"
        )
        self.assertEqual(result["summary"]["by_code"].get("DUPLICATE_EMPLOYEE_ID"), 2)

    def test_invalid_days_off_token(self):
        result = _parse(
            HEADER + "DI-0280,timheng@diu.edu.kh,07:00,11:00,13:00,17:00,Wednesdy\n"
        )
        row = result["rows"][0]
        self.assertTrue(any(i["code"] == "INVALID_DAYS_OFF_TOKEN" for i in row["issues"]))

    def test_feedback_rows_export_shape(self):
        result = _parse(
            HEADER + ",bad@row,off,off,13:00,17:00,Sunday\n"
        )
        self.assertIn("feedback_rows", result)
        self.assertTrue(len(result["feedback_rows"]) >= 1)
        fb = result["feedback_rows"][0]
        self.assertIn("suggestion", fb)
        self.assertIn("code", fb)

    def test_ineligible_employment_type_blocks_import(self):
        result = _parse(
            HEADER + "DI-0159,boeurnraksmey@diu.edu.kh,07:30,12:00,13:00,17:00,Sunday\n",
            match_employee="EMP-1",
            employment_type="Part-time Flexible",
        )
        row = result["rows"][0]
        self.assertFalse(row["importable"])
        self.assertTrue(any(i["code"] == "INELIGIBLE_EMPLOYMENT_TYPE" for i in row["issues"]))

    def test_active_ssa_blocks_import(self):
        result = _parse(
            HEADER + "DI-0159,boeurnraksmey@diu.edu.kh,07:30,12:00,13:00,17:00,Sunday\n",
            match_employee="EMP-1",
            has_ssa=True,
        )
        row = result["rows"][0]
        self.assertFalse(row["importable"])
        self.assertTrue(any(i["code"] == "ACTIVE_SSA_EXISTS" for i in row["issues"]))

    def test_eligible_employee_can_import(self):
        result = _parse(
            HEADER + "DI-0159,boeurnraksmey@diu.edu.kh,07:30,12:00,13:00,17:00,Sunday\n",
            match_employee="EMP-1",
            employment_type="Full-time",
        )
        row = result["rows"][0]
        self.assertTrue(row["importable"])


if __name__ == "__main__":
    unittest.main()
