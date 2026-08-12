"""Pure bucket classification for the biometric enrollment register.

This module imports no frappe, so these run with no mock installed — the
point of keeping the logic pure.
"""

import unittest
from datetime import date

from dewey_time.attendance_engine import enrollment_buckets as mod


class ClassifyTest(unittest.TestCase):
    def test_an_active_employee_with_no_template_needs_enrolling(self):
        self.assertEqual(
            mod.classify(status="Active", is_registered=False, checkin_count=0),
            mod.NEEDS_ENROLLMENT,
        )

    def test_an_active_employee_who_is_enrolled_and_punching_is_ok(self):
        self.assertEqual(
            mod.classify(status="Active", is_registered=True, checkin_count=3),
            mod.OK,
        )

    def test_enrolled_but_no_punches_in_the_window_is_its_own_state(self):
        """A template that exists but produces nothing is a different problem
        from no template at all: a bad enrollment, or a long absence."""
        self.assertEqual(
            mod.classify(status="Active", is_registered=True, checkin_count=0),
            mod.ENROLLED_NOT_PUNCHING,
        )

    def test_a_leaver_who_is_still_enrolled_is_the_security_finding(self):
        self.assertEqual(
            mod.classify(status="Left", is_registered=True, checkin_count=0),
            mod.LEAVER_STILL_ENROLLED,
        )

    def test_a_leaver_with_no_template_is_not_reported(self):
        """Nothing to action: they left and their template is gone."""
        self.assertIsNone(
            mod.classify(status="Left", is_registered=False, checkin_count=0)
        )

    def test_deleting_the_left_branch_would_classify_registered_leavers_as_ok(self):
        """The regression guard: a registered leaver with check-ins must
        return LEAVER_STILL_ENROLLED, not OK. This guards against accidentally
        deleting or disabling the Left branch of the classify logic."""
        self.assertEqual(
            mod.classify(status="Left", is_registered=True, checkin_count=500),
            mod.LEAVER_STILL_ENROLLED,
        )

    def test_statuses_outside_the_population_are_excluded(self):
        for status in ("Inactive", "Suspended"):
            with self.subTest(status=status):
                self.assertIsNone(
                    mod.classify(status=status, is_registered=True, checkin_count=0)
                )

    def test_the_bucket_values_are_the_wire_contract(self):
        """Regression guard: bucket string values cross into TypeScript. Renaming
        a constant here must not silently break the frontend."""
        self.assertEqual(
            (mod.NEEDS_ENROLLMENT, mod.ENROLLED_NOT_PUNCHING, mod.OK, mod.LEAVER_STILL_ENROLLED),
            ("NEEDS_ENROLLMENT", "ENROLLED_NOT_PUNCHING", "OK", "LEAVER_STILL_ENROLLED"),
        )

    def test_the_reported_population_is_exactly_active_and_left(self):
        """Regression guard: REPORTED_STATUSES filters the employee query. The
        tuple must be exactly ("Active", "Left")."""
        self.assertEqual(mod.REPORTED_STATUSES, ("Active", "Left"))


class DaysSinceTest(unittest.TestCase):
    def test_it_counts_whole_days(self):
        self.assertEqual(mod.days_since(date(2026, 8, 1), date(2026, 8, 11)), 10)

    def test_a_missing_relieving_date_yields_none_not_zero(self):
        """Zero would render as "left today", which is a fabrication. The row
        still appears; only the day count is withheld."""
        self.assertIsNone(mod.days_since(None, date(2026, 8, 11)))

    def test_a_future_relieving_date_clamps_to_zero(self):
        self.assertEqual(mod.days_since(date(2026, 8, 20), date(2026, 8, 11)), 0)

    def test_an_empty_string_date_is_treated_as_missing(self):
        """Frappe hands back "" for an empty Date column, not None."""
        self.assertIsNone(mod.days_since("", date(2026, 8, 11)))


if __name__ == "__main__":
    unittest.main()
