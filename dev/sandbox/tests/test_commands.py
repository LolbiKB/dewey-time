from __future__ import annotations
import unittest

from frappe_sandbox.config import Config
from frappe_sandbox import commands as c


def _cfg() -> Config:
    return Config(
        app="zkteco_hr", app_src="/repo", required_apps=("erpnext", "hrms"),
        branch="version-15", frontend_dir="/repo/fe",
        compose_file="/repo/dev/sandbox/docker-compose.yml",
    )


class TestCommands(unittest.TestCase):
    def test_up(self):
        self.assertEqual(
            c.build_up(_cfg()),
            [["docker", "compose", "-f", "/repo/dev/sandbox/docker-compose.yml", "up", "-d"]],
        )

    def test_down_purge(self):
        cmd = c.build_down(_cfg(), purge=True)[0]
        self.assertEqual(cmd[-2:], ["down", "-v"])

    def test_run_tests_parity(self):
        cmd = c.build_run_tests(_cfg())[0]
        joined = " ".join(cmd)
        self.assertIn("exec", joined)
        self.assertIn("bench --site test_site run-tests --app zkteco_hr", joined)

    def test_run_tests_parity_module(self):
        joined = " ".join(c.build_run_tests(_cfg(), module="test_closeout")[0])
        self.assertIn("--module zkteco_hr.tests.test_closeout", joined)

    def test_run_tests_fast_is_host_unittest(self):
        cmd = c.build_run_tests(_cfg(), fast=True)[0]
        joined = " ".join(cmd)
        self.assertNotIn("docker", joined)
        self.assertIn("PYTHONPATH=/repo/zkteco_hr", joined)
        self.assertIn("python3 -m unittest discover", joined)
        self.assertIn("/repo/zkteco_hr/zkteco_hr/tests", joined)

    def test_provision_passes_env(self):
        cmd = c.build_provision(_cfg())[0]
        joined = " ".join(cmd)
        self.assertIn("-e", joined)
        self.assertIn("REQUIRED_APPS=erpnext hrms", joined)
        self.assertIn("BRANCH=version-15", joined)
        self.assertIn("provision.sh", joined)

    def test_seed_prod_restore_then_anonymize(self):
        cmds = c.build_seed_prod(_cfg(), "/backups/x")
        joined = " ".join(" ".join(x) for x in cmds)
        self.assertIn("seed_prod.sh", joined)
        self.assertIn("BACKUP_DIR=/backups/x", joined)

    def test_engine_run(self):
        joined = " ".join(c.build_engine_run(_cfg(), employee="HR-EMP-1",
                                             start="2026-06-01", end="2026-06-07")[0])
        self.assertIn("--site sandbox execute", joined)
        self.assertIn("run_engine_for_employee", joined)
        self.assertIn("HR-EMP-1", joined)

    def test_frontend_unit(self):
        joined = " ".join(c.build_frontend(_cfg(), mode="unit")[0])
        self.assertIn("npm run test:web", joined)


if __name__ == "__main__":
    unittest.main()
