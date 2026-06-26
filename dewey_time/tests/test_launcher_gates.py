"""Tests for dewey_time's launcher-tile gate predicates."""

import sys
import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# dashboard_auth imports `requests` at module level; stub it when absent.
if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

from dewey_time.attendance_engine import launcher_gates as mod  # noqa: E402


class CanSeeAttendanceTests(unittest.TestCase):
    def test_true_for_hr_staff(self):
        with patch.object(mod, "_is_hr_staff", return_value=True), \
             patch.object(mod, "_employee_linked_to_user", return_value=None):
            self.assertTrue(mod.can_see_attendance())

    def test_true_for_linked_employee(self):
        with patch.object(mod, "_is_hr_staff", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value="EMP-1"):
            self.assertTrue(mod.can_see_attendance())

    def test_false_for_neither(self):
        with patch.object(mod, "_is_hr_staff", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None):
            self.assertFalse(mod.can_see_attendance())


class CanSeeAdmsTests(unittest.TestCase):
    def test_true_when_holding_adms_role(self):
        with patch.object(mod, "ADMS_ROLES", {"ADMS Admin"}), \
             patch.object(mod.frappe, "get_roles", return_value=["ADMS Admin", "Other"]):
            self.assertTrue(mod.can_see_adms())

    def test_false_without_adms_role(self):
        with patch.object(mod, "ADMS_ROLES", {"ADMS Admin"}), \
             patch.object(mod.frappe, "get_roles", return_value=["Other"]):
            self.assertFalse(mod.can_see_adms())


if __name__ == "__main__":
    unittest.main()
