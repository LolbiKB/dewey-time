import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402

from dewey_time.patches import guard_doctype_drift_before_flip as guard  # noqa: E402


def _clean(doctype):
    return {"doctype": doctype, "would_be_deregistered": [], "would_be_added": []}


def _drifted(doctype, fields):
    return {"doctype": doctype, "would_be_deregistered": list(fields), "would_be_added": []}


class TestGuardDoctypeDriftBeforeFlip(unittest.TestCase):
    """The guard aborts a migrate that would de-register a field.

    `frappe.throw` in the suite's mock carries a side_effect that RAISES
    (test_closeout.py:38), so the abort is asserted as an exception rather than
    as a recorded call. reset_mock() clears the call record and leaves the
    side_effect in place, which is what we want on both counts.
    """

    def setUp(self):
        frappe.throw.reset_mock()

    def _run_with(self, report):
        with patch.object(guard, "audit_schema_drift", return_value=report):
            guard.execute()

    def _message_from_abort(self, report):
        with self.assertRaises(Exception):
            self._run_with(report)
        self.assertTrue(frappe.throw.called)
        return frappe.throw.call_args[0][0]

    def test_a_field_only_in_the_database_aborts_the_migrate(self):
        with self.assertRaises(Exception):
            self._run_with([_drifted("Attendance Flag", ["custom_note"])])
        self.assertTrue(frappe.throw.called)

    def test_the_message_names_the_doctype_and_the_field(self):
        # The operator reads this mid-migrate with no other context, so
        # "drift detected" would send them hunting. It has to say what and where.
        message = self._message_from_abort([_drifted("Device Sync Status", ["custom_note"])])
        self.assertIn("Device Sync Status", message)
        self.assertIn("custom_note", message)

    def test_every_drifted_doctype_is_named_not_just_the_first(self):
        message = self._message_from_abort(
            [_drifted("Attendance Flag", ["a"]), _drifted("Dewey Time Settings", ["b"])]
        )
        self.assertIn("Attendance Flag", message)
        self.assertIn("Dewey Time Settings", message)

    def test_no_drift_lets_the_migrate_proceed(self):
        self._run_with([_clean("Attendance Flag"), _clean("Dewey Time Settings")])
        self.assertFalse(frappe.throw.called)

    def test_a_doctype_absent_from_the_site_is_not_drift(self):
        # A fresh site migrating for the first time has none of the seven yet.
        # Reading would_be_deregistered with [] instead of .get() would raise
        # KeyError here and abort a migrate that had nothing wrong with it.
        self._run_with([{"doctype": "Attendance Flag", "status": "absent from this site"}])
        self.assertFalse(frappe.throw.called)


if __name__ == "__main__":
    unittest.main()
