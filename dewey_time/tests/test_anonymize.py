import unittest
from unittest.mock import patch

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

    def test_khmer_names_and_telegram_id_are_scrubbed(self):
        # The sandbox engine's baseline scrub covers NO Employee fields -- only
        # User, Contact, Communication, Email Queue, Address and the logs -- so
        # anything PII on Employee is this file's job alone. Both Khmer fields
        # and the Telegram chat id were carried into every prod restore in the
        # clear until this test existed.
        specs = anonymize._scrub_specs()
        employee = next(cols for dt, cols, _ in specs if dt == "Employee")
        for column in ("custom_khmer_first_name", "custom_khmer_last_name",
                       "custom_telegram_chat_id"):
            self.assertIn(column, employee, f"{column} is unscrubbed PII")
        # Telegram chat ID: blanked to NULL (not ''), which is type-agnostic and
        # avoids strict mode failures if the prod column is Int.
        self.assertEqual(employee["custom_telegram_chat_id"], "NULL")
        # Khmer fields: de-identified to deterministic id-derived values, but
        # preserve emptiness so "has no Khmer name" stays exercisable in the
        # sandbox. Both expressions differ (different prefixes) and both preserve
        # their own column's emptiness via CASE WHEN.
        khmer_last = employee["custom_khmer_last_name"]
        khmer_first = employee["custom_khmer_first_name"]
        self.assertNotEqual(khmer_last, khmer_first, "Khmer expressions must differ")
        for expr, col in [(khmer_last, "custom_khmer_last_name"),
                          (khmer_first, "custom_khmer_first_name")]:
            self.assertIn("CASE WHEN", expr, f"{col} must preserve emptiness")
            self.assertIn(col, expr, f"{col} expression must reference its own column")


class TestRunSkipsColumnsTheSchemaLacks(unittest.TestCase):
    """The guarantee the Employee spec's comment leans on.

    custom_telegram_chat_id is scrubbed by that spec and is NOT installed by
    this app -- setup/custom_fields.py owns the two Khmer fields and nothing
    else -- so on a site without the notifier it names a column that does not
    exist. That is safe only because run() intersects each spec with the
    columns the schema actually has, and until now nothing said so.
    """

    def _statements(self, columns):
        anonymize.frappe.local.site = "sandbox"
        sql = anonymize.frappe.db.sql
        sql.reset_mock()
        with patch.object(
            anonymize.frappe.db, "get_table_columns", return_value=columns
        ):
            anonymize.run()
        return [call.args[0] for call in sql.call_args_list]

    def test_a_column_the_schema_lacks_is_dropped_from_the_update(self):
        statements = self._statements(["employee_name", "personal_email"])
        self.assertTrue(statements, "the scrub issued no UPDATE at all")
        for statement in statements:
            self.assertNotIn("custom_telegram_chat_id", statement)
        # …and the run is not vacuous: what the schema DOES have is scrubbed.
        self.assertTrue(any("`employee_name` =" in s for s in statements))

    def test_the_column_is_scrubbed_where_the_schema_has_it(self):
        # The other direction, so the test above cannot pass by the scrub
        # having quietly stopped touching the field on every schema.
        statements = self._statements(["custom_telegram_chat_id"])
        self.assertTrue(
            any("`custom_telegram_chat_id` = NULL" in s for s in statements),
            "an installed chat id must still be blanked",
        )


if __name__ == "__main__":
    unittest.main()
