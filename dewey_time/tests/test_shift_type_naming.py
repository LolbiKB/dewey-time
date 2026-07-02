import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.setup import shift_type_naming as stn  # noqa: E402

# A DocType-Event Server Script that auto-names Shift Type by start/end only — the
# real prod override that stripped the lunch/grace suffix and collapsed variants.
_FT_NAMING_SCRIPT = 'doc.name = "FT_" + start + "_" + end'


class TestEnsureScheduleNaming(unittest.TestCase):
    def test_removes_property_setters_and_naming_rules_for_both_doctypes(self):
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True
            # get_all is called per doctype: Shift Type PS, Shift Type DNR, Shift
            # Schedule PS, Shift Schedule DNR, then the Server Script query.
            fr.get_all.side_effect = [
                ["Shift Type-main-autoname"],  # Shift Type property setters
                [],                             # Shift Type naming rules
                [],                             # Shift Schedule property setters
                ["Shift Schedule-rule"],       # Shift Schedule naming rules
                [],                             # server scripts
            ]
            meta = MagicMock()
            meta.autoname = "prompt"
            fr.get_meta.return_value = meta

            removed = stn.ensure_schedule_naming()

        self.assertEqual(removed["property_setters"], ["Shift Type-main-autoname"])
        self.assertEqual(removed["document_naming_rules"], ["Shift Schedule-rule"])
        fr.delete_doc.assert_any_call(
            "Property Setter", "Shift Type-main-autoname",
            force=1, ignore_permissions=True, ignore_missing=True,
        )
        fr.delete_doc.assert_any_call(
            "Document Naming Rule", "Shift Schedule-rule",
            force=1, ignore_permissions=True, ignore_missing=True,
        )
        fr.log_error.assert_not_called()

    def test_disables_naming_server_scripts_that_assign_doc_name(self):
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True
            fr.get_all.side_effect = [
                [], [], [], [],  # no PS / DNR on either doctype
                [
                    {"name": "Shift Type - Auto name FT_*", "script": _FT_NAMING_SCRIPT, "disabled": 0},
                    {"name": "Reads name only", "script": "x = doc.name  # compare", "disabled": 0},
                    {"name": "Already off", "script": _FT_NAMING_SCRIPT, "disabled": 1},
                ],
            ]
            meta = MagicMock()
            meta.autoname = "prompt"
            fr.get_meta.return_value = meta

            removed = stn.ensure_schedule_naming()

        # Only the enabled, name-ASSIGNING script is disabled.
        self.assertEqual(removed["server_scripts"], ["Shift Type - Auto name FT_*"])
        fr.db.set_value.assert_called_once_with(
            "Server Script", "Shift Type - Auto name FT_*", "disabled", 1
        )

    def test_does_not_touch_comparison_only_scripts(self):
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True
            fr.get_all.side_effect = [
                [], [], [], [],
                [{"name": "guard", "script": "if doc.name == 'X': pass", "disabled": 0}],
            ]
            meta = MagicMock()
            meta.autoname = "prompt"
            fr.get_meta.return_value = meta

            removed = stn.ensure_schedule_naming()

        self.assertEqual(removed["server_scripts"], [])
        fr.db.set_value.assert_not_called()

    def test_logs_when_naming_still_forced(self):
        with patch.object(stn, "frappe") as fr:
            fr.db.exists.return_value = True
            fr.get_all.side_effect = [[], [], [], [], []]
            meta = MagicMock()
            meta.autoname = "format:FT_{start_time}_{end_time}"
            fr.get_meta.return_value = meta

            stn.ensure_schedule_naming()

        # One log per schedule doctype whose naming is still forced.
        self.assertTrue(fr.log_error.called)

    def test_backward_compatible_alias_delegates(self):
        with patch.object(stn, "ensure_schedule_naming") as m:
            m.return_value = {"property_setters": [], "document_naming_rules": [], "server_scripts": []}
            stn.ensure_shift_type_prompt_naming()
        m.assert_called_once()


if __name__ == "__main__":
    unittest.main()
