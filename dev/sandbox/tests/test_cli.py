from __future__ import annotations
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from frappe_sandbox.cli import main

CONFIG = str(Path(__file__).resolve().parents[1] / "frappe-sandbox.json")


class TestCliDryRun(unittest.TestCase):
    def _run(self, *args) -> str:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = main(["--config", CONFIG, "--dry-run", *args])
        self.assertEqual(rc, 0)
        return buf.getvalue()

    def test_test_backend_dry_run(self):
        out = self._run("test", "--backend")
        self.assertIn("run-tests --app zkteco_hr", out)

    def test_test_fast_dry_run(self):
        out = self._run("test", "--backend", "--fast")
        self.assertIn("python3 -m unittest discover", out)
        self.assertNotIn("docker", out)

    def test_up_dry_run(self):
        out = self._run("up")
        self.assertIn("docker compose", out)
        self.assertIn("up -d", out)


if __name__ == "__main__":
    unittest.main()
