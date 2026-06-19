from __future__ import annotations
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from frappe_sandbox.cli import _init
from frappe_sandbox.config import load_config


class TestInit(unittest.TestCase):
    def test_scaffolds_valid_config_and_stubs(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            sandbox = root / "dev" / "sandbox"
            sandbox.mkdir(parents=True)
            (root / "myapp").mkdir()  # standard layout: <app-src>/<app>/
            cfg_path = sandbox / "frappe-sandbox.json"
            rc = _init(str(cfg_path), app="myapp", app_src="../..", frontend_dir="../..")
            self.assertEqual(rc, 0)
            cfg = load_config(cfg_path)              # scaffold must be load_config-valid
            self.assertEqual(cfg.app, "myapp")
            self.assertTrue((root / "myapp" / "utils" / "anonymize.py").is_file())
            self.assertTrue((root / "myapp" / "utils" / "sandbox_verify.py").is_file())

    def test_refuses_to_overwrite(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            sandbox = root / "dev" / "sandbox"; sandbox.mkdir(parents=True)
            (root / "myapp").mkdir()
            cfg_path = sandbox / "frappe-sandbox.json"
            cfg_path.write_text("{}")
            rc = _init(str(cfg_path), app="myapp", app_src="../..", frontend_dir="../..")
            self.assertEqual(rc, 1)
            self.assertEqual(cfg_path.read_text(), "{}")  # untouched


if __name__ == "__main__":
    unittest.main()
