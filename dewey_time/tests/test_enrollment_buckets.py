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

    def test_a_leavers_punch_history_does_not_make_them_ok(self):
        """The regression guard: a departed employee has check-ins by
        definition. Ordering the status test before the registration test is
        what keeps their live template visible."""
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


class DaysSinceTest(unittest.TestCase):
    def test_it_counts_whole_days(self):
        self.assertEqual(mod.days_since(date(2026, 8, 1), date(2026, 8, 11)), 10)

    def test_a_missing_relieving_date_yields_none_not_zero(self):
        """Zero would render as "left today", which is a fabrication. The row
        still appears; only the day count is withheld."""
        self.assertIsNone(mod.days_since(None, date(2026, 8, 11)))

    def test_a_future_relieving_date_clamps_to_zero(self):
        self.assertEqual(mod.days_since(date(2026, 8, 20), date(2026, 8, 11)), 0)


if __name__ == "__main__":
    unittest.main()
