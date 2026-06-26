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

mod.frappe.AuthenticationError = type("AuthenticationError", (Exception,), {})
mod.frappe.PermissionError = PermissionError


def _throw(msg, exc=None, *args, **kwargs):
    raise (exc or Exception)(msg)


def _patched_throw():
    return patch.object(mod.frappe, "throw", side_effect=_throw)


_GATE_ATT = "dewey_time.attendance_engine.launcher_gates.can_see_attendance"
_GATE_ADMS = "dewey_time.attendance_engine.launcher_gates.can_see_adms"

# The three curated tiles, as they appear in the Launcher Tile DocType.
_TILES = [
    {"name": "dewey_time", "app_name": "dewey_time", "title": "Dewey Time", "route": "/hr-attendance", "icon": "/x/d.svg", "is_admin": 0, "gate": _GATE_ATT},
    {"name": "adms", "app_name": "adms", "title": "ADMS", "route": "/adms", "icon": "/x/a.svg", "is_admin": 1, "gate": _GATE_ADMS},
    {"name": "desk", "app_name": "desk", "title": "Frappe Desk", "route": "/desk", "icon": "/x/k.svg", "is_admin": 1, "gate": "desk"},
]


def _get_all(tiles=None, tile_roles=None):
    tiles = _TILES if tiles is None else tiles
    tile_roles = tile_roles or []
    def _impl(doctype, *a, **kw):
        if doctype == "Launcher Tile":
            return list(tiles)
        if doctype == "Launcher Tile Role":
            return list(tile_roles)
        return []
    return _impl


def _attr_for(*, hr, employee, adms):
    """Stub frappe.get_attr: map a dotted gate path to a persona-aware predicate."""
    def _impl(path):
        if path.endswith("can_see_attendance"):
            return lambda: bool(hr or employee)
        if path.endswith("can_see_adms"):
            return lambda: bool(adms)
        raise ImportError(path)
    return _impl


def _run(*, user="u@x.com", roles=None, hr=False, employee=None, desk=False, tiles=None, tile_roles=None):
    """Invoke get_launcher() with a fully mocked persona."""
    roles = roles or []
    adms = bool(set(roles) & {"ADMS Admin", "ADMS Super Admin"})
    with patch.object(mod.frappe, "session", SimpleNamespace(user=user)), \
         patch.object(mod.frappe, "get_roles", return_value=roles), \
         patch.object(mod.frappe, "get_all", side_effect=_get_all(tiles, tile_roles)), \
         patch.object(mod.frappe, "get_attr", side_effect=_attr_for(hr=hr, employee=employee, adms=adms)), \
         patch.object(mod, "_has_desk_access", return_value=desk), \
         patch.object(mod, "_employee_linked_to_user", return_value=employee), \
         patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
        return mod.get_launcher()


def _names(result):
    return [a["name"] for a in result["apps"]]


class GetLauncherTests(unittest.TestCase):
    def test_guest_is_rejected(self):
        with _patched_throw(), patch.object(mod.frappe, "session", SimpleNamespace(user="Guest")):
            with self.assertRaises(mod.frappe.AuthenticationError):
                mod.get_launcher()

    def test_linked_employee_sees_only_attendance(self):
        self.assertEqual(_names(_run(employee="EMP-001")), ["dewey_time"])

    def test_adms_admin_sees_only_adms(self):
        self.assertEqual(_names(_run(roles=["ADMS Admin"])), ["adms"])

    def test_hr_user_sees_attendance_and_desk(self):
        self.assertEqual(_names(_run(hr=True, desk=True)), ["dewey_time", "desk"])

    def test_disabled_tiles_excluded_via_filter(self):
        captured = {}
        def _impl(doctype, *a, **kw):
            if doctype == "Launcher Tile":
                captured["filters"] = kw.get("filters")
                captured["order_by"] = kw.get("order_by")
                return list(_TILES)
            return []
        with _patched_throw(), patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_all", side_effect=_impl), \
             patch.object(mod.frappe, "get_attr", side_effect=_attr_for(hr=False, employee=None, adms=False)), \
             patch.object(mod, "_has_desk_access", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="X"):
            mod.get_launcher()
        self.assertEqual(captured["filters"], {"enabled": 1})
        self.assertEqual(captured["order_by"], "tile_order asc")

    def test_order_preserved_from_get_all(self):
        reordered = list(reversed(_TILES))
        self.assertEqual(_names(_run(hr=True, desk=True, tiles=reordered)), ["desk", "dewey_time"])

    def test_roles_gate_matches_user_role(self):
        tile = [{"name": "crm", "app_name": "crm", "title": "CRM", "route": "/crm", "icon": "/x/c.svg", "is_admin": 1, "gate": "roles"}]
        roles_rows = [{"role": "Sales User"}]
        self.assertEqual(_names(_run(roles=["Sales User"], tiles=tile, tile_roles=roles_rows)), ["crm"])
        self.assertEqual(_names(_run(roles=["Other"], tiles=tile, tile_roles=roles_rows)), [])

    def test_unknown_gate_skipped(self):
        tile = [{"name": "x", "app_name": "x", "title": "X", "route": "/x", "icon": "", "is_admin": 0, "gate": "bogus"}]
        self.assertEqual(_names(_run(tiles=tile)), [])

    def test_no_tiles_returns_empty(self):
        self.assertEqual(_names(_run(tiles=[])), [])

    def test_admin_flag_passthrough(self):
        apps = {a["name"]: a for a in _run(hr=True, desk=True)["apps"]}
        self.assertFalse(apps["dewey_time"]["admin"])
        self.assertTrue(apps["desk"]["admin"])

    def test_can_manage_tiles_true_for_system_manager(self):
        self.assertTrue(_run(roles=["System Manager"], hr=True, desk=True)["user"]["can_manage_tiles"])

    def test_can_manage_tiles_false_otherwise(self):
        self.assertFalse(_run(employee="EMP-001")["user"]["can_manage_tiles"])

    def test_greeting_initials(self):
        out = _run(employee="EMP-001")["user"]
        self.assertEqual(out["full_name"], "Maria Rossi")
        self.assertEqual(out["initials"], "MR")
        self.assertEqual(out["image_url"], None)
        self.assertIn("can_manage_tiles", out)

    def test_broad_gate_error_fails_open(self):
        def _attr(path):
            if path.endswith("can_see_attendance"):
                def _boom():
                    raise RuntimeError("boom")
                return _boom
            return lambda: False
        with patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_all", side_effect=_get_all()), \
             patch.object(mod.frappe, "get_attr", side_effect=_attr), \
             patch.object(mod, "_has_desk_access", return_value=False), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
            self.assertIn("dewey_time", _names(mod.get_launcher()))

    def test_admin_gate_error_fails_closed(self):
        def _attr(path):
            if path.endswith("can_see_attendance"):
                return lambda: True
            return lambda: False
        with patch.object(mod.frappe, "session", SimpleNamespace(user="u@x.com")), \
             patch.object(mod.frappe, "get_roles", return_value=[]), \
             patch.object(mod.frappe, "get_all", side_effect=_get_all()), \
             patch.object(mod.frappe, "get_attr", side_effect=_attr), \
             patch.object(mod, "_has_desk_access", side_effect=RuntimeError("boom")), \
             patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.utils, "get_fullname", return_value="Maria Rossi"):
            self.assertNotIn("desk", _names(mod.get_launcher()))

    def test_user_image_employee_photo_takes_precedence(self):
        with patch.object(mod, "_employee_linked_to_user", return_value="EMP-001"), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, name, field: (
                 "/files/emp.jpg" if dt == "Employee" else "/files/user.jpg"
             )):
            self.assertEqual(mod._user_image(), "/files/emp.jpg")

        with patch.object(mod, "_employee_linked_to_user", return_value="EMP-001"), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, name, field: (
                 None if dt == "Employee" else "/files/user.jpg"
             )):
            self.assertEqual(mod._user_image(), "/files/user.jpg")

        with patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.db, "get_value", return_value="/files/user.jpg"):
            self.assertEqual(mod._user_image(), "/files/user.jpg")

        with patch.object(mod, "_employee_linked_to_user", return_value=None), \
             patch.object(mod.frappe.db, "get_value", return_value=None):
            self.assertIsNone(mod._user_image())


if __name__ == "__main__":
    unittest.main()
