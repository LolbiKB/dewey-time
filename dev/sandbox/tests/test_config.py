from __future__ import annotations
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from frappe_sandbox.config import load_config, Config, ConfigError


class TestLoadConfig(unittest.TestCase):
    def _write(self, d: str, data: dict) -> Path:
        p = Path(d) / "frappe-sandbox.json"
        p.write_text(json.dumps(data))
        return p

    def test_loads_and_resolves_paths(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "zkteco_hr",
                "app_src": "../..",
                "required_apps": ["erpnext", "hrms"],
                "branch": "version-15",
                "frontend_dir": "../../frontend",
            })
            cfg = load_config(p)
            self.assertIsInstance(cfg, Config)
            self.assertEqual(cfg.app, "zkteco_hr")
            self.assertEqual(cfg.required_apps, ("erpnext", "hrms"))
            self.assertEqual(cfg.branch, "version-15")
            self.assertTrue(Path(cfg.app_src).is_absolute())
            self.assertTrue(cfg.register_app_in_apps_txt)  # defaults True
            self.assertEqual(cfg.test_site, "test_site")
            self.assertEqual(cfg.sandbox_site, "sandbox")

    def test_missing_key_raises(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {"app": "x"})
            with self.assertRaises(ConfigError):
                load_config(p)

    def test_empty_required_apps_raises(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "x", "app_src": ".", "required_apps": [],
                "branch": "version-15", "frontend_dir": ".",
            })
            with self.assertRaises(ConfigError):
                load_config(p)

    def test_non_string_required_apps_raises(self):
        with TemporaryDirectory() as d:
            p = self._write(d, {
                "app": "x", "app_src": ".", "required_apps": ["erpnext", 42],
                "branch": "version-15", "frontend_dir": ".",
            })
            with self.assertRaises(ConfigError):
                load_config(p)

    def test_invalid_json_raises(self):
        with TemporaryDirectory() as d:
            p = Path(d) / "frappe-sandbox.json"
            p.write_text("{invalid json}")
            with self.assertRaises(ConfigError):
                load_config(p)

    def test_missing_file_raises(self):
        with self.assertRaises(ConfigError):
            load_config("/nonexistent/path/frappe-sandbox.json")


if __name__ == "__main__":
    unittest.main()
