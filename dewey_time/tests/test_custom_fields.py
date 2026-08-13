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

    def test_employee_khmer_name_fields_are_installed(self):
        # These were added through the Frappe UI, so they exist on prod and on
        # NO freshly created site. CI builds its site with `bench new-site`; a
        # query selecting them would pass locally against a prod restore and
        # fail there. The app has to install what it reads.
        emp = {f["fieldname"]: f for f in cf.CUSTOM_FIELDS["Employee"]}
        self.assertEqual(
            set(emp), {"custom_khmer_first_name", "custom_khmer_last_name"}
        )
        for fieldname in emp:
            self.assertEqual(emp[fieldname]["fieldtype"], "Data")
            # Most of the roster has both; a handful have neither. A required
            # field would make those records unsaveable.
            self.assertNotEqual(emp[fieldname].get("reqd"), 1)
        # Matches the prod docfield export: HR search by these already.
        self.assertEqual(emp["custom_khmer_last_name"]["in_global_search"], 1)
        self.assertEqual(emp["custom_khmer_first_name"]["in_global_search"], 1)
        self.assertEqual(emp["custom_khmer_last_name"]["label"], "Khmer Last Name")
        self.assertEqual(emp["custom_khmer_first_name"]["label"], "Khmer First Name")


if __name__ == "__main__":
    unittest.main()
