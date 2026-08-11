import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import enrollment as mod  # noqa: E402


class UpsertTest(unittest.TestCase):
    def test_the_docname_is_the_employee_id(self):
        """One row per employee, name-keyed, so the upsert needs no lookup."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=False), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            name = mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=True,
                fingerprint_count=2,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )

        get_doc.assert_called_once_with(
            {"doctype": mod.ENROLLMENT_DOCTYPE, "name": "HR-EMP-0042"}
        )
        self.assertEqual(doc.employee, "HR-EMP-0042")
        self.assertEqual(doc.fingerprint_count, 2)
        self.assertEqual(name, "HR-EMP-0042")
        doc.save.assert_called_once()

    def test_an_existing_row_is_loaded_not_recreated(self):
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=True), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ) as get_doc:
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=False,
                fingerprint_count=0,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )

        get_doc.assert_called_once_with(mod.ENROLLMENT_DOCTYPE, "HR-EMP-0042")
        self.assertEqual(doc.is_registered, 0)

    def test_is_registered_is_stored_as_an_int_not_a_bool(self):
        """Frappe Check fields are 0/1. A Python bool round-trips through the
        ORM but compares badly in db filters like {"is_registered": 1}."""
        doc = MagicMock()
        with patch.object(mod.frappe.db, "exists", return_value=False), patch.object(
            mod.frappe, "get_doc", return_value=doc
        ):
            mod.upsert_enrollment_row(
                employee="HR-EMP-0042",
                pin="1042",
                is_registered=True,
                fingerprint_count=1,
                face_count=0,
                synced_at="2026-08-11 09:14:03",
                bridge_env="prod",
            )
        self.assertIs(doc.is_registered, 1)


if __name__ == "__main__":
    unittest.main()
