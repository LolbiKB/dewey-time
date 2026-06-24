import json
import sys
import types
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# dashboard_auth imports `requests` at module level; stub it so we can import
# access.py without installing the package in the test environment.
if "requests" not in sys.modules:
    sys.modules["requests"] = types.ModuleType("requests")

from dewey_time.attendance_engine import access as mod  # noqa: E402

mod.frappe.PermissionError = PermissionError


class GuardTests(unittest.TestCase):
    def test_apis_require_system_manager(self):
        for fn in (lambda: mod.get_assignable_roles(),
                   lambda: mod.get_tile_roles("t"),
                   lambda: mod.set_tile_roles("t", []),
                   lambda: mod.get_access_overview()):
            with patch.object(mod.frappe, "only_for", side_effect=PermissionError("no")):
                with self.assertRaises(PermissionError):
                    fn()


class RolePickerTests(unittest.TestCase):
    def test_get_assignable_roles_excludes_pseudo(self):
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_all", return_value=["System Manager", "HR User", "Guest", "All", "Administrator"]):
            self.assertEqual(mod.get_assignable_roles(), ["System Manager", "HR User"])

    def test_get_tile_roles(self):
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_all", return_value=["Sales User", "Support"]):
            self.assertEqual(mod.get_tile_roles("crm"), ["Sales User", "Support"])

    def test_set_tile_roles_writes_child_rows(self):
        captured = {}
        class _Doc:
            def set(self, field, value): captured["field"] = field; captured["value"] = value
            def save(self, **kw): captured["saved"] = True
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_doc", return_value=_Doc()):
            out = mod.set_tile_roles("crm", ["Sales User", "Support"])
        self.assertEqual(captured["field"], "visible_to_roles")
        self.assertEqual(captured["value"], [{"role": "Sales User"}, {"role": "Support"}])
        self.assertTrue(captured["saved"])
        self.assertEqual(out, {"tile": "crm", "roles": ["Sales User", "Support"]})

    def test_set_tile_roles_accepts_json_string(self):
        class _Doc:
            def set(self, field, value): self.value = value
            def save(self, **kw): pass
        d = _Doc()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_doc", return_value=d):
            mod.set_tile_roles("crm", json.dumps(["A", "B"]))
        self.assertEqual(d.value, [{"role": "A"}, {"role": "B"}])


class AccessOverviewTests(unittest.TestCase):
    def test_overview_computes_flags(self):
        # Has Role rows, landing roles, user info — driven by the doctype arg.
        def _get_all(doctype, **kw):
            if doctype == "Role":  # landing roles query
                return ["HR User"]
            if doctype == "Has Role":
                return [
                    {"parent": "maria@x.com", "role": "HR User"},
                    {"parent": "dev@x.com", "role": "ADMS Admin"},
                ]
            if doctype == "User":
                return [
                    {"name": "maria@x.com", "full_name": "Maria", "user_type": "System User"},
                    {"name": "dev@x.com", "full_name": "Dev", "user_type": "Website User"},
                ]
            return []
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe, "get_all", side_effect=_get_all):
            out = mod.get_access_overview()
        rows = {r["user"]: r for r in out["users"]}
        self.assertTrue(rows["maria@x.com"]["hr"])
        self.assertTrue(rows["maria@x.com"]["desk"])
        self.assertTrue(rows["maria@x.com"]["lands_on_home"])
        self.assertTrue(rows["dev@x.com"]["adms"])
        self.assertFalse(rows["dev@x.com"]["desk"])
        self.assertFalse(rows["dev@x.com"]["lands_on_home"])
        self.assertEqual(rows["maria@x.com"]["roles"], ["HR User"])
        self.assertEqual(rows["dev@x.com"]["roles"], ["ADMS Admin"])


if __name__ == "__main__":
    unittest.main()
