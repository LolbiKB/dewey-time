import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.setup import shift_type_naming as stn  # noqa: E402


class TestEnsureShiftTypePromptNaming(unittest.TestCase):
    def test_removes_overrides_and_reports_them(self):
        """A Property Setter on autoname and a Document Naming Rule are both
        deleted, autoname reverts to prompt, and nothing is logged as unresolved."""
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True  # Shift Type + Document Naming Rule doctypes exist
            # get_all is called for property setters first, then naming rules.
            fr.get_all.side_effect = [["Shift Type-main-autoname"], ["Shift Type-rule"]]
            meta = MagicMock()
            meta.autoname = "prompt"
            fr.get_meta.return_value = meta

            removed = stn.ensure_shift_type_prompt_naming()

        self.assertEqual(removed["property_setters"], ["Shift Type-main-autoname"])
        self.assertEqual(removed["document_naming_rules"], ["Shift Type-rule"])
        fr.delete_doc.assert_any_call(
            "Property Setter", "Shift Type-main-autoname",
            force=1, ignore_permissions=True, ignore_missing=True,
        )
        fr.delete_doc.assert_any_call(
            "Document Naming Rule", "Shift Type-rule",
            force=1, ignore_permissions=True, ignore_missing=True,
        )
        fr.clear_cache.assert_called_once_with(doctype="Shift Type")
        # prompt is acceptable -> no unresolved-override error logged
        fr.log_error.assert_not_called()

    def test_noop_when_already_prompt(self):
        """No naming artifacts -> nothing deleted, nothing logged."""
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True
            fr.get_all.side_effect = [[], []]
            meta = MagicMock()
            meta.autoname = "prompt"
            fr.get_meta.return_value = meta

            removed = stn.ensure_shift_type_prompt_naming()

        self.assertEqual(removed, {"property_setters": [], "document_naming_rules": []})
        fr.delete_doc.assert_not_called()
        fr.log_error.assert_not_called()

    def test_logs_when_override_persists(self):
        """If naming is STILL forced after removing PS/DNR (e.g. a Server Script or a
        direct core edit), surface it loudly instead of silently leaving it broken."""
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True
            fr.get_all.side_effect = [[], []]
            meta = MagicMock()
            meta.autoname = "format:FT_{start_time}_{end_time}"
            fr.get_meta.return_value = meta

            stn.ensure_shift_type_prompt_naming()

        fr.log_error.assert_called_once()

    def test_skips_when_shift_type_doctype_absent(self):
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = False  # Shift Type doctype not present
            removed = stn.ensure_shift_type_prompt_naming()
        self.assertEqual(removed, {"property_setters": [], "document_naming_rules": []})
        fr.get_all.assert_not_called()


if __name__ == "__main__":
    unittest.main()
