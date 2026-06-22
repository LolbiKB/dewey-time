import unittest

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.utils import anonymize  # noqa: E402


class TestAnonymizeStatements(unittest.TestCase):
    def test_scrub_targets_pii_and_preserves_engine_fields(self):
        specs = anonymize._scrub_specs()
        by_doctype = {dt: set_map for dt, set_map, _ in specs}
        # required doctypes present, PII columns scrubbed
        self.assertIn("Employee", by_doctype)
        self.assertIn("Employee Checkin", by_doctype)
        self.assertIn("employee_name", by_doctype["Employee"])
        self.assertIn("personal_email", by_doctype["Employee"])
        # device_id is deterministically masked (not nulled)
        self.assertIn("MD5(device_id)", by_doctype["Employee Checkin"]["device_id"])
        # engine-relevant fields are NEVER a scrub target (column key) in any spec
        for _dt, set_map, _where in specs:
            for protected in ("time", "log_type", "shift", "employee",
                              "custom_supabase_log_id"):
                self.assertNotIn(protected, set_map)

    def test_is_prod_site_guard(self):
        self.assertTrue(anonymize.is_prod_site("dewey.frappehr.com"))
        self.assertFalse(anonymize.is_prod_site("sandbox"))

    def test_run_refuses_on_prod_site(self):
        anonymize.frappe.local.site = "dewey.frappehr.com"
        with self.assertRaises(RuntimeError):
            anonymize.run()


if __name__ == "__main__":
    unittest.main()
