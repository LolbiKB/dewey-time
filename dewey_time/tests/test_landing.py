import json
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import landing as mod  # noqa: E402

mod.frappe.PermissionError = PermissionError
mod.frappe.DoesNotExistError = Exception


class SetRoleLandingTests(unittest.TestCase):
    def _common(self, *, roles_of_user=None):
        # Patch the helpers + frappe writes; capture set_value calls.
        self.sets = []
        def _set_value(dt, name, field, value=None):
            self.sets.append((dt, name, field, value))
        return _set_value

    def test_non_system_manager_rejected(self):
        with patch.object(mod.frappe, "only_for", side_effect=PermissionError("nope")):
            with self.assertRaises(PermissionError):
                mod.set_role_landing("HR User", True)

    def test_enable_sets_role_home_page_and_nulls_workspace_and_clears_cache(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod.frappe.db, "get_value", return_value="Welcome Workspace"), \
             patch.object(mod.frappe.db, "exists", return_value=True), \
             patch.object(mod, "_load_snapshot", return_value={}), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache") as clear:
            out = mod.set_role_landing("HR User", True)
        self.assertEqual(out, {"role": "HR User", "enabled": True})
        self.assertIn(("Role", "HR User", "home_page", "home"), self.sets)
        self.assertIn(("User", "a@x.com", "default_workspace", None), self.sets)
        save_snap.assert_called_once()
        self.assertEqual(save_snap.call_args[0][0], {"a@x.com": "Welcome Workspace"})
        clear.assert_called_once()

    def test_enable_does_not_overwrite_existing_snapshot_entry(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod.frappe.db, "get_value", return_value="NEW"), \
             patch.object(mod.frappe.db, "exists", return_value=True), \
             patch.object(mod, "_load_snapshot", return_value={"a@x.com": "ORIGINAL"}), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache"):
            mod.set_role_landing("HR User", True)
        # existing snapshot kept; default_workspace NOT re-nulled-from-NEW into snapshot
        self.assertEqual(save_snap.call_args[0][0], {"a@x.com": "ORIGINAL"})

    def test_disable_clears_role_and_restores_when_no_other_landing_role(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod, "_load_snapshot", return_value={"a@x.com": "ORIGINAL"}), \
             patch.object(mod.frappe.db, "exists", return_value=True), \
             patch.object(mod, "_user_has_other_landing_role", return_value=False), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache"):
            out = mod.set_role_landing("HR User", False)
        self.assertEqual(out, {"role": "HR User", "enabled": False})
        self.assertIn(("Role", "HR User", "home_page", ""), self.sets)
        self.assertIn(("User", "a@x.com", "default_workspace", "ORIGINAL"), self.sets)
        self.assertEqual(save_snap.call_args[0][0], {})  # entry removed

    def test_disable_keeps_workspace_nulled_if_user_in_another_landing_role(self):
        sv = self._common()
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod.frappe.db, "set_value", side_effect=sv), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod, "_load_snapshot", return_value={"a@x.com": "ORIGINAL"}), \
             patch.object(mod.frappe.db, "exists", return_value=True), \
             patch.object(mod, "_user_has_other_landing_role", return_value=True), \
             patch.object(mod, "_save_snapshot") as save_snap, \
             patch.object(mod, "_clear_cache"):
            mod.set_role_landing("HR User", False)
        # not restored; snapshot entry retained
        self.assertNotIn(("User", "a@x.com", "default_workspace", "ORIGINAL"), self.sets)
        self.assertEqual(save_snap.call_args[0][0], {"a@x.com": "ORIGINAL"})


class GetLandingStateTests(unittest.TestCase):
    def test_reports_enabled_roles_and_masks(self):
        with patch.object(mod.frappe, "only_for", return_value=None), \
             patch.object(mod, "_assignable_roles", return_value=["HR User", "ADMS Admin"]), \
             patch.object(mod.frappe.db, "get_value", side_effect=lambda dt, n, f: "home" if n == "HR User" else ""), \
             patch.object(mod, "_system_users_with_role", return_value=["a@x.com"]), \
             patch.object(mod.frappe.db, "get_single_value", return_value=None), \
             patch.object(mod.frappe, "get_hooks", return_value=[]):
            out = mod.get_landing_state()
        roles = {r["role"]: r["enabled"] for r in out["roles"]}
        self.assertTrue(roles["HR User"])
        self.assertFalse(roles["ADMS Admin"])
        self.assertIn("masks", out)


if __name__ == "__main__":
    unittest.main()
