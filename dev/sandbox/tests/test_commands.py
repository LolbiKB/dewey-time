from __future__ import annotations
import unittest

from frappe_sandbox.config import Config, ExerciseArg
from frappe_sandbox import commands as c


def _cfg(*, exercise_method="zkteco_hr.attendance_engine.dev_tools.run_engine_for_employee",
         verify_method="zkteco_hr.utils.sandbox_verify.run",
         anonymize_method="zkteco_hr.utils.anonymize.run",
         bootstrap_method="") -> Config:
    return Config(
        app="zkteco_hr", app_src="/repo", required_apps=("erpnext", "hrms"),
        branch="version-15", frontend_dir="/repo/fe",
        compose_file="/repo/dev/sandbox/docker-compose.yml",
        exercise_method=exercise_method,
        exercise_args=(ExerciseArg("employee", "employee", required=True),),
        anonymize_method=anonymize_method, verify_method=verify_method,
        bootstrap_method=bootstrap_method,
    )


class TestCommands(unittest.TestCase):
    def test_build_ready_is_up_then_provision(self):
        cmds = c.build_ready(_cfg())
        self.assertEqual(cmds, c.build_up(_cfg()) + c.build_provision(_cfg()))
        self.assertIn("up", cmds[0])

    def test_build_bootstrap_empty_when_unset(self):
        self.assertEqual(c.build_bootstrap(_cfg()), [])

    def test_build_bootstrap_runs_method_on_site(self):
        joined = " ".join(c.build_bootstrap(_cfg(bootstrap_method="myapp.b.run"),
                                            site="test_site")[0])
        self.assertIn("--site test_site execute myapp.b.run", joined)

    def test_provision_passes_bootstrap_method(self):
        joined = " ".join(" ".join(x) for x in
                          c.build_provision(_cfg(bootstrap_method="myapp.b.run")))
        self.assertIn("BOOTSTRAP_METHOD=myapp.b.run", joined)

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

    def test_build_exercise(self):
        cfg = _cfg()
        cmd = c.build_exercise(cfg, {"employee": "HR-EMP-1", "start_date": "2026-06-01"})[0]
        joined = " ".join(cmd)
        self.assertIn("--site sandbox execute", joined)
        self.assertIn("zkteco_hr.attendance_engine.dev_tools.run_engine_for_employee", joined)
        self.assertIn("HR-EMP-1", joined)

    def test_build_exercise_no_method_raises(self):
        cfg = _cfg(exercise_method=None)
        with self.assertRaises(ValueError):
            c.build_exercise(cfg, {})

    def test_verify_uses_config_method(self):
        joined = " ".join(c.build_verify(_cfg(verify_method="myapp.v.run"))[0])
        self.assertIn("execute myapp.v.run", joined)

    def test_seed_prod_passes_anonymize_method(self):
        joined = " ".join(" ".join(x) for x in c.build_seed_prod(_cfg(anonymize_method="myapp.a.run"), "/b"))
        self.assertIn("ANONYMIZE_METHOD=myapp.a.run", joined)

    def test_frontend_unit(self):
        joined = " ".join(c.build_frontend(_cfg(), mode="unit")[0])
        self.assertIn("npm run test:web", joined)

    def test_run_tests_fast_module(self):
        joined = " ".join(c.build_run_tests(_cfg(), fast=True, module="test_closeout")[0])
        self.assertNotIn("docker", joined)
        self.assertIn("zkteco_hr.tests.test_closeout", joined)

    def test_frontend_unknown_mode_raises(self):
        with self.assertRaises(ValueError):
            c.build_frontend(_cfg(), mode="bogus")


if __name__ == "__main__":
    unittest.main()
