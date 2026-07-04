"""Regression tests for the get_my_week permission gate (T3-9).

Security requirement: any authenticated user must NOT be able to read another
employee's checkins + attendance flags via the get_my_week endpoint.
"""

from __future__ import annotations

import unittest
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402 — installed by _install_frappe_mock

# Ensure PermissionError wires up correctly on the mock.
frappe.PermissionError = PermissionError

from dewey_time.attendance_engine import api as mod  # noqa: E402


def _throw(msg, exc=None, *args, **kwargs):
    raise (exc or Exception)(msg)


def _patched_throw():
    """Patch frappe.throw on the hr_calendar module (where _require_calendar_access lives)."""
    from dewey_time.attendance_engine import hr_calendar
    return patch.object(hr_calendar.frappe, "throw", side_effect=_throw)


class TestGetMyWeekPermissionGate(unittest.TestCase):
    """Tests for the _require_calendar_access gate on get_my_week."""

    def _call(self, *, employee: str, session_user: str, roles: list[str], linked_employee: str | None):
        """Helper: run get_my_week with the given session context.

        Patches:
        - hr_calendar's frappe (session, get_roles, db.get_value) to drive the gate.
        - api's getdate / get_datetime to return real Python objects (the mock
          frappe.utils returns strings unchanged, which breaks timedelta math).
        - mod.frappe.get_all to return [] so no real DB is needed.
        """
        from dewey_time.attendance_engine import hr_calendar

        def _getdate(value):
            if isinstance(value, date):
                return value
            return date.fromisoformat(str(value))

        def _get_datetime(value):
            if isinstance(value, datetime):
                return value
            return datetime.fromisoformat(str(value))

        with _patched_throw():
            with patch.object(hr_calendar.frappe, "session", SimpleNamespace(user=session_user)):
                with patch.object(hr_calendar.frappe, "get_roles", return_value=roles):
                    with patch.object(
                        hr_calendar.frappe.db,
                        "get_value",
                        return_value=linked_employee,
                    ):
                        with patch.object(mod, "getdate", side_effect=_getdate):
                            with patch.object(mod, "get_datetime", side_effect=_get_datetime):
                                # Stub data reads so the function body can complete without a real DB.
                                with patch.object(mod.frappe, "get_all", return_value=[]):
                                    return mod.get_my_week(
                                        employee=employee,
                                        start_date="2026-06-01",
                                        end_date="2026-06-01",
                                    )

    # --- Test 1: SECURITY REGRESSION — non-HR user querying another employee is REJECTED ---
    def test_non_hr_querying_other_employee_is_rejected(self):
        """A non-HR user MUST NOT read another employee's data.

        This is the core security regression test — if the guard is removed,
        this test will fail.
        """
        with self.assertRaises(PermissionError):
            self._call(
                employee="EMP-OTHER",
                session_user="self@example.com",
                roles=["Employee"],
                linked_employee="EMP-SELF",
            )

    # --- Test 2: non-HR user querying their OWN employee record is ALLOWED ---
    def test_non_hr_querying_own_employee_is_allowed(self):
        """An employee is allowed to read their own attendance data."""
        result = self._call(
            employee="EMP-SELF",
            session_user="self@example.com",
            roles=["Employee"],
            linked_employee="EMP-SELF",
        )
        self.assertIsInstance(result, dict)
        for key in ("employee", "start_date", "end_date", "days"):
            self.assertIn(key, result)
        self.assertEqual(result["employee"], "EMP-SELF")

    # --- Test 3: HR staff querying ANY employee is ALLOWED ---
    def test_hr_staff_can_query_any_employee(self):
        """HR staff (HR Manager role) can read any employee's data."""
        result = self._call(
            employee="EMP-OTHER",
            session_user="hr@example.com",
            roles=["Employee", "HR Manager"],
            linked_employee="EMP-HR",
        )
        self.assertIsInstance(result, dict)
        self.assertEqual(result["employee"], "EMP-OTHER")


if __name__ == "__main__":
    unittest.main()
