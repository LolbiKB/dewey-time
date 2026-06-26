"""Tests for the pure employment-type policy module (frappe-free).

These run with plain ``python3 -m unittest`` — no frappe mock needed, because
``employment_type`` imports only the standard library.
"""

from __future__ import annotations

import unittest

from dewey_time.attendance_engine.employment_type import (
    WEEKLY_SCHEDULE_EMPLOYMENT_TYPES,
    derive_employment_type,
    is_weekly_schedule_eligible,
    resolve_apply_employment_type,
    weekly_scheduled_minutes,
)


def _pattern(*days):
    """Build a week_pattern dict from (start, end, lunch_start, lunch_end) tuples.

    A bare ``None`` entry means an off day.
    """
    weekdays = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ]
    out = []
    for weekday, spec in zip(weekdays, days):
        if spec is None:
            out.append({"weekday": weekday, "works": False})
            continue
        start, end, lunch_start, lunch_end = spec
        out.append(
            {
                "weekday": weekday,
                "works": True,
                "start_time": start,
                "end_time": end,
                "lunch_start": lunch_start,
                "lunch_end": lunch_end,
                "grace_minutes": 10,
            }
        )
    return {"frequency": "Every Week", "days": out}


class TestEligibility(unittest.TestCase):
    def test_allowlist_has_no_probation(self):
        self.assertNotIn("Probation", WEEKLY_SCHEDULE_EMPLOYMENT_TYPES)
        self.assertEqual(
            set(WEEKLY_SCHEDULE_EMPLOYMENT_TYPES),
            {"Full-time", "Part-time Fixed", "Intern"},
        )

    def test_eligible_types(self):
        self.assertTrue(is_weekly_schedule_eligible("Full-time"))
        self.assertTrue(is_weekly_schedule_eligible("part-time fixed"))
        self.assertTrue(is_weekly_schedule_eligible("Intern"))

    def test_probation_is_now_ineligible(self):
        self.assertFalse(is_weekly_schedule_eligible("Probation"))

    def test_other_ineligible(self):
        self.assertFalse(is_weekly_schedule_eligible("Part-time Flexible"))
        self.assertFalse(is_weekly_schedule_eligible("Contract"))
        self.assertFalse(is_weekly_schedule_eligible(None))
        self.assertFalse(is_weekly_schedule_eligible(""))
        self.assertFalse(is_weekly_schedule_eligible("   "))


class TestDeriveEmploymentType(unittest.TestCase):
    def test_exactly_40h_is_full_time(self):
        self.assertEqual(derive_employment_type(40 * 60), "Full-time")

    def test_over_40h_is_full_time(self):
        self.assertEqual(derive_employment_type(40 * 60 + 1), "Full-time")

    def test_just_under_40h_is_part_time(self):
        self.assertEqual(derive_employment_type(40 * 60 - 1), "Part-time Fixed")

    def test_zero_is_part_time(self):
        self.assertEqual(derive_employment_type(0), "Part-time Fixed")


class TestWeeklyScheduledMinutes(unittest.TestCase):
    def test_split_days_exclude_lunch(self):
        # 07:00-17:00 with 11:00-13:00 lunch = 8h/day, Mon-Fri, weekends off = 2400.
        pat = _pattern(
            ("07:00", "17:00", "11:00", "13:00"),
            ("07:00", "17:00", "11:00", "13:00"),
            ("07:00", "17:00", "11:00", "13:00"),
            ("07:00", "17:00", "11:00", "13:00"),
            ("07:00", "17:00", "11:00", "13:00"),
            None,
            None,
        )
        self.assertEqual(weekly_scheduled_minutes(pat), 2400)

    def test_continuous_no_lunch(self):
        # 09:00-17:00 = 8h/day, Mon-Fri = 2400.
        pat = _pattern(
            ("09:00", "17:00", None, None),
            ("09:00", "17:00", None, None),
            ("09:00", "17:00", None, None),
            ("09:00", "17:00", None, None),
            ("09:00", "17:00", None, None),
            None,
            None,
        )
        self.assertEqual(weekly_scheduled_minutes(pat), 2400)

    def test_am_only_six_days_is_part_time_hours(self):
        # 07:00-11:00 = 4h/day x 6 days = 1440 (< 2400).
        pat = _pattern(
            ("07:00", "11:00", None, None),
            ("07:00", "11:00", None, None),
            ("07:00", "11:00", None, None),
            ("07:00", "11:00", None, None),
            ("07:00", "11:00", None, None),
            ("07:00", "11:00", None, None),
            None,
        )
        self.assertEqual(weekly_scheduled_minutes(pat), 1440)

    def test_accepts_seconds_in_time_strings(self):
        pat = _pattern(("08:00:00", "16:00:00", None, None), None, None, None, None, None, None)
        self.assertEqual(weekly_scheduled_minutes(pat), 480)

    def test_empty_and_none(self):
        self.assertEqual(weekly_scheduled_minutes(None), 0)
        self.assertEqual(weekly_scheduled_minutes({"days": []}), 0)


class TestResolveApplyEmploymentType(unittest.TestCase):
    FULL = _pattern(
        ("07:00", "17:00", "11:00", "13:00"),
        ("07:00", "17:00", "11:00", "13:00"),
        ("07:00", "17:00", "11:00", "13:00"),
        ("07:00", "17:00", "11:00", "13:00"),
        ("07:00", "17:00", "11:00", "13:00"),
        None,
        None,
    )
    PART = _pattern(
        ("07:00", "11:00", None, None),
        ("07:00", "11:00", None, None),
        ("07:00", "11:00", None, None),
        ("07:00", "11:00", None, None),
        ("07:00", "11:00", None, None),
        None,
        None,
    )

    def test_eligible_leaves_type_alone(self):
        action, value = resolve_apply_employment_type("Full-time", self.FULL, derive=True)
        self.assertEqual(action, "ok")
        self.assertIsNone(value)

    def test_derive_full_time(self):
        action, value = resolve_apply_employment_type(
            "Part-time Flexible", self.FULL, derive=True
        )
        self.assertEqual(action, "set")
        self.assertEqual(value, "Full-time")

    def test_derive_part_time_from_low_hours(self):
        action, value = resolve_apply_employment_type("", self.PART, derive=True)
        self.assertEqual(action, "set")
        self.assertEqual(value, "Part-time Fixed")

    def test_derive_overwrites_probation(self):
        action, value = resolve_apply_employment_type("Probation", self.FULL, derive=True)
        self.assertEqual(action, "set")
        self.assertEqual(value, "Full-time")

    def test_block_when_not_deriving_blank(self):
        action, value = resolve_apply_employment_type("", self.FULL, derive=False)
        self.assertEqual(action, "block")
        self.assertIn("no employment type", value.lower())
        self.assertNotIn("Probation", value)

    def test_block_when_not_deriving_value(self):
        action, value = resolve_apply_employment_type(
            "Part-time Flexible", self.FULL, derive=False
        )
        self.assertEqual(action, "block")
        self.assertIn("not eligible", value.lower())
        self.assertIn("Part-time Flexible", value)
        self.assertNotIn("Probation", value)


if __name__ == "__main__":
    unittest.main()
