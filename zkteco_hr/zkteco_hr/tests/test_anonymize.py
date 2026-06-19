import unittest

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.utils import anonymize  # noqa: E402


class TestAnonymizeStatements(unittest.TestCase):
    def test_scrub_targets_pii_and_preserves_engine_fields(self):
        stmts = anonymize._scrub_statements()
        blob = " ".join(sql.lower() for sql, _ in stmts)
        # PII columns scrubbed
        self.assertIn("update `tabemployee`", blob)
        self.assertIn("employee_name", blob)
        self.assertIn("personal_email", blob)
        self.assertIn("update `tabemployee checkin`", blob)
        # engine-relevant fields NEVER appear in a SET clause
        for protected in (" time =", " log_type =", " shift =", " employee =",
                          "custom_supabase_log_id ="):
            self.assertNotIn(protected, blob)

    def test_is_prod_site_guard(self):
        self.assertTrue(anonymize.is_prod_site("dewey.frappehr.com"))
        self.assertFalse(anonymize.is_prod_site("sandbox"))


if __name__ == "__main__":
    unittest.main()
