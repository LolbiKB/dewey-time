import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


class TestNonPrimarySeverityPatch(unittest.TestCase):
    def test_patch_updates_only_non_primary_rows(self):
        from dewey_time.patches import non_primary_site_punch_severity_to_info as patch_mod

        with patch.object(patch_mod.frappe.db, "sql") as sql:
            patch_mod.execute()

        self.assertEqual(sql.call_count, 1)
        statement = sql.call_args[0][0]
        self.assertIn("tabAttendance Flag", statement)
        self.assertIn("NON_PRIMARY_SITE_PUNCH", statement)
        self.assertIn("INFO", statement)

    def test_patch_is_idempotent_by_construction(self):
        """It must skip rows already at INFO, so a second migrate is a no-op
        rather than a full-table rewrite."""
        from dewey_time.patches import non_primary_site_punch_severity_to_info as patch_mod

        with patch.object(patch_mod.frappe.db, "sql") as sql:
            patch_mod.execute()

        statement = " ".join(sql.call_args[0][0].split())
        self.assertIn("severity != 'INFO'", statement)

    def test_registered_in_patches_txt(self):
        """A patch file with no manifest entry never runs."""
        from pathlib import Path

        manifest = Path(__file__).resolve().parents[1] / "patches.txt"
        self.assertIn(
            "dewey_time.patches.non_primary_site_punch_severity_to_info",
            manifest.read_text(),
        )
