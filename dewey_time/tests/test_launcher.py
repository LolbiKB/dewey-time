"""Tests for the home launcher resolver."""

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# Installs the shared MagicMock `frappe` into sys.modules (no bench needed).
from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# dashboard_auth imports requests at module level; stub it when absent.
if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

from dewey_time.attendance_engine import launcher as mod  # noqa: E402

# Make the mock's exception classes real so `raises`/policy checks behave.
mod.frappe.AuthenticationError = type("AuthenticationError", (Exception,), {})
mod.frappe.PermissionError = PermissionError


# ---------------------------------------------------------------------------
# _patched_throw: mirrors the helper from test_dashboard_auth so that
# frappe.throw actually raises instead of being a no-op MagicMock.
# ---------------------------------------------------------------------------

def _throw(msg, exc=None, *args, **kwargs):
    raise (exc or Exception)(msg)


def _patched_throw():
    """Own our throw behaviour — the shared frappe mock's throw gets
    reassigned by other test modules, so never rely on it."""
    return patch.object(mod.frappe, "throw", side_effect=_throw)


# The two curated tiles, as they appear in hooks.add_to_apps_screen.
_ENTRIES = [
    {"name": "dewey_time", "title": "Dewey Time", "logo": "/x/dewey.svg", "route": "/hr-attendance"},
    {"name": "adms", "title": "ADMS Bridge", "logo": "/x/adms.svg", "route": "/adms"},
]


def _run(*, user="u@x.com", roles=None, hr=False, employee=None, desk=False):
    """Invoke get_launcher() with a fully mocked persona."""
    roles = roles or []
    with patch.object(mod.frappe, "session", SimpleNamespace(user=user)), \
         patch.object(mod.frappe, "throw", side_effect=_throw), \
         patch.object(mod.frappe, "get_roles", return_value=roles), \
         patch.object(mod.frappe, "get_hooks", return_value=_ENTRIES), \
         patch.object(mod, "_is_hr_staff", return_value=hr), \
         patch.object(mod, "_employee_linked_to_user", return_value=employee), \
         patch.object(mod, "_has_desk_access", return_value=desk), \
         patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
        return mod.get_launcher()


def _names(result):
    return [a["name"] for a in result["apps"]]


class GetLauncherTests(unittest.TestCase):
    def test_guest_is_rejected(self):
        with _patched_throw():
            with patch.object(mod.frappe, "session", SimpleNamespace(user="Guest")):
                with self.assertRaises(mod.frappe.AuthenticationError):
                    mod.get_launcher()

    def test_linked_employee_sees_only_hr(self):
        self.assertEqual(_names(_run(employee="EMP-001")), ["dewey_time"])

    def test_adms_admin_sees_only_adms(self):
        self.assertEqual(_names(_run(roles=["ADMS Admin"])), ["adms"])

    def test_hr_user_sees_hr_and_desk(self):
        self.assertEqual(_names(_run(hr=True, desk=True)), ["dewey_time", "desk"])

    def test_system_manager_no_adms(self):
        # System Manager is HR staff + desk, but NOT an ADMS role.
        out = _names(_run(roles=["System Manager"], hr=True, desk=True))
        self.assertEqual(out, ["dewey_time", "desk"])

    def test_no_apps_returns_empty(self):
        self.assertEqual(_names(_run()), [])

    def test_greeting_initials(self):
        self.assertEqual(
            _run(employee="EMP-001")["user"],
            {"full_name": "Maria Rossi", "initials": "MR", "image_url": None},
        )

    def test_user_image_employee_photo_takes_precedence(self):
        """Employee photo wins over User image; User image fallback works; None when both absent."""
        # Employee has a photo → use it.
        with patch.object(mod, "_employee_linked_to_user", return_value="EMP-001"), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, name, field: (
                 "/files/emp.jpg" if dt == "Employee" else "/files/user.jpg"
             )):
            self.assertEqual(mod._user_image(), "/files/emp.jpg")

        # Employee exists but no photo → fall back to User image.
        with patch.object(mod, "_employee_linked_to_user", return_value="EMP-001"), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, name, field: (
                 None if dt == "Employee" else "/files/user.jpg"
             )):
            self.assertEqual(mod._user_image(), "/files/user.jpg")

        # No employee at all → User image.
        with patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.db, "get_value", return_value="/files/user.jpg"):
            self.assertEqual(mod._user_image(), "/files/user.jpg")

        # No employee, no User image → None.
        with patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.db, "get_value", return_value=None):
            self.assertIsNone(mod._user_image())

    def test_broad_gate_error_fails_open(self):
        # Cannot use _run() here: its patches for _is_hr_staff/_employee_linked_to_user
        # would override the side_effect we need. Drive get_launcher() directly.
        with patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "throw", side_effect=_throw), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_hooks", return_value=_ENTRIES), \
             patch.object(mod, "_is_hr_staff", side_effect=RuntimeError("boom")), \
             patch.object(mod, "_employee_linked_to_user", side_effect=RuntimeError("boom")), \
             patch.object(mod, "_has_desk_access", return_value=False), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
            self.assertIn("dewey_time", _names(mod.get_launcher()))

    def test_admin_gate_error_fails_closed(self):
        # Cannot use _run() here: its _has_desk_access patch would override side_effect.
        with patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "throw", side_effect=_throw), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_hooks", return_value=_ENTRIES), \
             patch.object(mod, "_is_hr_staff", return_value=True), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod, "_has_desk_access", side_effect=RuntimeError("boom")), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
            self.assertNotIn("desk", _names(mod.get_launcher()))


if __name__ == "__main__":
    unittest.main()
