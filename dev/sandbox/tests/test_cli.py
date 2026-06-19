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

    def test_ready_dry_run(self):
        out = self._run("ready")
        self.assertIn("up -d", out)
        self.assertIn("provision.sh", out)

    def test_bootstrap_dry_run(self):
        out = self._run("bootstrap")
        self.assertIn("execute zkteco_hr.utils.sandbox_bootstrap.run", out)
        self.assertIn("--site sandbox", out)

    def test_bootstrap_test_site_dry_run(self):
        out = self._run("bootstrap", "--test-site")
        self.assertIn("--site test_site", out)

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

    def test_seed_without_clean_or_prod_errors(self):
        from frappe_sandbox.cli import main
        self.assertEqual(main(["--config", CONFIG, "seed"]), 2)

    def test_test_without_backend_or_frontend_errors(self):
        from frappe_sandbox.cli import main
        self.assertEqual(main(["--config", CONFIG, "test"]), 2)

    def test_shim_runs_from_repo_root(self):
        import subprocess
        shim = str(Path(__file__).resolve().parents[1] / "frappe-sandbox")
        repo_root = str(Path(__file__).resolve().parents[3])
        r = subprocess.run([shim, "--dry-run", "up"], cwd=repo_root,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("docker compose", r.stdout)

    def test_exercise_dry_run(self):
        out = self._run("exercise", "--employee", "E1", "--start", "2026-06-01", "--end", "2026-06-07")
        self.assertIn("run_engine_for_employee", out)
        self.assertIn("E1", out)

    def test_engine_run_removed(self):
        import io
        from contextlib import redirect_stderr
        with self.assertRaises(SystemExit):
            with redirect_stderr(io.StringIO()):
                main(["--config", CONFIG, "--dry-run", "engine-run", "--employee", "E1"])


if __name__ == "__main__":
    unittest.main()
