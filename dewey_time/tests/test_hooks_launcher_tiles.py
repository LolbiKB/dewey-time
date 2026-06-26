"""Wiring tests: the dewey_launcher_tiles hook is well-formed and resolvable."""

import importlib
import sys
import unittest
from unittest.mock import MagicMock

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

import dewey_time.hooks as hooks  # noqa: E402

_BUILTINS = {"desk", "roles"}


def _resolve(path):
    mod_path, attr = path.rsplit(".", 1)
    return getattr(importlib.import_module(mod_path), attr)


class HookShapeTests(unittest.TestCase):
    def test_is_list_of_tiles(self):
        self.assertIsInstance(hooks.dewey_launcher_tiles, list)
        self.assertGreaterEqual(len(hooks.dewey_launcher_tiles), 3)

    def test_required_keys_present(self):
        for t in hooks.dewey_launcher_tiles:
            for field in ("key", "title", "route", "gate"):
                self.assertIn(field, t, f"{t} missing {field}")

    def test_keys_unique(self):
        keys = [t["key"] for t in hooks.dewey_launcher_tiles]
        self.assertEqual(len(keys), len(set(keys)))

    def test_dewey_time_tile_titled_dewey_time(self):
        by_key = {t["key"]: t for t in hooks.dewey_launcher_tiles}
        self.assertEqual(by_key["dewey_time"]["title"], "Dewey Time")

    def test_gates_resolve(self):
        for t in hooks.dewey_launcher_tiles:
            gate = t["gate"]
            if gate in _BUILTINS:
                continue
            self.assertIn(".", gate, f"{gate} is neither built-in nor dotted")
            self.assertTrue(callable(_resolve(gate)), f"{gate} not callable")

    def test_access_roles_hook_well_formed(self):
        groups = hooks.dewey_portal_access_roles
        self.assertIsInstance(groups, list)
        labels = {g["label"] for g in groups}
        self.assertIn("HR", labels)
        self.assertIn("ADMS", labels)
        for g in groups:
            self.assertIsInstance(g["roles"], (list, tuple))
            self.assertTrue(g["roles"])

    def test_access_roles_match_source_constants(self):
        # The hook's role names are INLINED in hooks.py (importing the source
        # constants there would poison the module cache for mock tests). Import
        # them here — under the mock installed at module top — to guard drift.
        from dewey_time.attendance_engine.dashboard_auth import ALLOWED_ROLES
        from dewey_time.attendance_engine.hr_calendar import HR_STAFF_ROLES

        by_label = {g["label"]: set(g["roles"]) for g in hooks.dewey_portal_access_roles}
        self.assertEqual(by_label["HR"], set(HR_STAFF_ROLES))
        self.assertEqual(by_label["ADMS"], set(ALLOWED_ROLES))


if __name__ == "__main__":
    unittest.main()
