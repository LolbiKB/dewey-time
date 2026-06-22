import sys
import types
import unittest
from unittest.mock import MagicMock

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# setup/custom_fields.py imports create_custom_fields from this dotted path; provide it.
_cf_mod = types.ModuleType("frappe.custom.doctype.custom_field.custom_field")
_cf_mod.create_custom_fields = MagicMock()
for _name in ("frappe.custom", "frappe.custom.doctype", "frappe.custom.doctype.custom_field"):
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["frappe.custom.doctype.custom_field.custom_field"] = _cf_mod

from dewey_time.setup import custom_fields as cf  # noqa: E402


class TestCustomFields(unittest.TestCase):
    def test_definitions_match_prod_export(self):
        ec = {f["fieldname"]: f for f in cf.CUSTOM_FIELDS["Employee Checkin"]}
        # device_branch is a Link to Branch (authoritative, from the prod docfield export)
        self.assertEqual(ec["custom_device_branch"]["fieldtype"], "Link")
        self.assertEqual(ec["custom_device_branch"]["options"], "Branch")
        # supabase log id is the UNIQUE idempotency field the Bridge relies on
        self.assertEqual(ec["custom_supabase_log_id"]["unique"], 1)
        st = {f["fieldname"] for f in cf.CUSTOM_FIELDS["Shift Type"]}
        self.assertEqual(st, {"custom_grace_minutes", "custom_lunch_start", "custom_lunch_end"})

    def test_make_custom_fields_invokes_creator(self):
        cf.create_custom_fields.reset_mock()
        cf.make_custom_fields()
        cf.create_custom_fields.assert_called_once_with(cf.CUSTOM_FIELDS, ignore_validate=True)


if __name__ == "__main__":
    unittest.main()
