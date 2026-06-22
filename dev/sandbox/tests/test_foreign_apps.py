from __future__ import annotations

import unittest

from frappe_sandbox.foreign_apps import (
    filtered_installed_apps,
    foreign_apps,
    parse_major,
    version_warnings,
)


class TestParseMajor(unittest.TestCase):
    def test_parses(self):
        self.assertEqual(parse_major("16.23.0"), 16)
        self.assertEqual(parse_major("15"), 15)
        self.assertEqual(parse_major(" 14.0.1 "), 14)

    def test_unparseable_is_none(self):
        for bad in ("", None, "HEAD", "v16"):
            self.assertIsNone(parse_major(bad))


class TestForeignApps(unittest.TestCase):
    def test_detects_apps_absent_from_bench(self):
        db = ["frappe", "erpnext", "hrms", "education", "dewey_time", "doppio"]
        present = {"frappe", "erpnext", "hrms", "dewey_time"}
        self.assertEqual(foreign_apps(db, present), ["education", "doppio"])

    def test_order_preserved_and_deduped(self):
        db = ["education", "frappe", "education", "doppio"]
        self.assertEqual(foreign_apps(db, {"frappe"}), ["education", "doppio"])

    def test_none_foreign_when_all_present(self):
        db = ["frappe", "dewey_time"]
        self.assertEqual(foreign_apps(db, {"frappe", "dewey_time"}), [])


class TestFilteredInstalledApps(unittest.TestCase):
    def test_keeps_present_in_order(self):
        installed = ["frappe", "erpnext", "hrms", "education", "dewey_time", "doppio"]
        present = {"frappe", "erpnext", "hrms", "dewey_time"}
        self.assertEqual(
            filtered_installed_apps(installed, present),
            ["frappe", "erpnext", "hrms", "dewey_time"],
        )

    def test_empty_when_none_present(self):
        self.assertEqual(filtered_installed_apps(["education"], {"frappe"}), [])


class TestVersionWarnings(unittest.TestCase):
    def test_major_mismatch_warns(self):
        warns = version_warnings(
            {"frappe": "16.23.0", "hrms": "16.9.0"},
            {"frappe": "15.112.0", "hrms": "15.61.0"},
        )
        self.assertEqual(len(warns), 2)
        self.assertIn("frappe", warns[0])
        self.assertIn("v16", warns[0])
        self.assertIn("v15", warns[0])

    def test_same_major_is_quiet(self):
        warns = version_warnings({"frappe": "15.120.0"}, {"frappe": "15.112.0"})
        self.assertEqual(warns, [])

    def test_missing_bench_version_skipped(self):
        # App in backup but not measurable in bench → no warning (nothing to compare).
        self.assertEqual(version_warnings({"frappe": "16.0.0"}, {}), [])


if __name__ == "__main__":
    unittest.main()
