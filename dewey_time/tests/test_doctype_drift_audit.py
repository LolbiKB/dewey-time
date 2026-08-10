import unittest

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.utils import doctype_drift_audit as audit  # noqa: E402


def _clean(doctype="Attendance Flag"):
    return {"doctype": doctype, "would_be_deregistered": [], "would_be_added": []}


def _drifted(doctype="Attendance Flag", fields=("custom_note",)):
    return {"doctype": doctype, "would_be_deregistered": list(fields), "would_be_added": []}


class TestVerdict(unittest.TestCase):
    """The verdict is what a human reads; the JSON above it is what they read next."""

    def test_a_field_only_in_the_database_blocks_the_flip(self):
        result = audit.verdict([_clean("Device Sync Status"), _drifted()], {"Attendance Flag": 900})
        self.assertTrue(result.startswith("DRIFT_AUDIT_BLOCKED"))
        self.assertIn("Attendance Flag", result)

    def test_every_drifted_doctype_is_named_not_just_the_first(self):
        result = audit.verdict(
            [_drifted("Attendance Flag"), _drifted("Device Sync Status")],
            {"Attendance Flag": 900},
        )
        self.assertIn("Attendance Flag", result)
        self.assertIn("Device Sync Status", result)

    def test_no_drift_over_real_data_is_clear_and_says_how_much(self):
        result = audit.verdict([_clean()], {"Attendance Flag": 900, "Device Sync Status": 40})
        self.assertTrue(result.startswith("DRIFT_AUDIT_CLEAR"))
        self.assertIn("940", result)

    def test_no_drift_over_empty_tables_is_vacuous_not_clear(self):
        # The branch that matters. A site built from these JSONs has zero drift by
        # construction, so a CLEAR verdict there is indistinguishable from one
        # earned against production -- which is how a meaningless audit gets
        # mistaken for a passed one.
        result = audit.verdict([_clean()], {"Attendance Flag": 0, "Device Sync Status": 0})
        self.assertTrue(result.startswith("DRIFT_AUDIT_VACUOUS"))
        self.assertNotIn("DRIFT_AUDIT_CLEAR", result)

    def test_drift_outranks_emptiness(self):
        # An empty table can still be drifted: the columns are what drift, not the
        # rows. Reporting VACUOUS here would bury a blocking finding.
        result = audit.verdict([_drifted()], {"Attendance Flag": 0})
        self.assertTrue(result.startswith("DRIFT_AUDIT_BLOCKED"))


if __name__ == "__main__":
    unittest.main()
