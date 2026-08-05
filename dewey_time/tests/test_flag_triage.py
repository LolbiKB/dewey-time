import unittest

from dewey_time.attendance_engine.flag_triage import (
    TIER_ACT,
    TIER_REVIEW,
    TIER_ROUTINE,
    tier_for_rank,
    triage_rank,
)


class TestTriageRankFixedCodes(unittest.TestCase):
    """Flag codes with no minute-band: rank is constant regardless of evidence."""

    def test_unnotified_absence(self):
        self.assertEqual(triage_rank("UNNOTIFIED_ABSENCE", {}), 150)

    def test_attendance_issue_and_missing_in_or_out_share_a_band(self):
        self.assertEqual(triage_rank("ATTENDANCE_ISSUE", {}), 140)
        self.assertEqual(triage_rank("MISSING_IN_OR_OUT", {}), 140)

    def test_off_shift_punch_delivery_failed_unknown_device_branch_share_a_band(self):
        self.assertEqual(triage_rank("OFF_SHIFT_PUNCH", {}), 50)
        self.assertEqual(triage_rank("DELIVERY_FAILED", {}), 50)
        self.assertEqual(triage_rank("UNKNOWN_DEVICE_BRANCH", {}), 50)

    def test_non_primary_site_punch(self):
        self.assertEqual(triage_rank("NON_PRIMARY_SITE_PUNCH", {}), 10)

    def test_missing_lunch(self):
        self.assertEqual(triage_rank("MISSING_LUNCH", {}), 5)

    def test_unknown_flag_code_returns_5(self):
        self.assertEqual(triage_rank("SOME_FUTURE_CODE", {}), 5)
        self.assertEqual(triage_rank("SOME_FUTURE_CODE", {"minutes": 999}), 5)


class TestTriageRankMissingTimeBands(unittest.TestCase):
    """MISSING_TIME: 130 + min(minutes // 60, 9) once minutes >= 120, else the flat
    60 review band. 120 is the only real boundary — there is no separate band below
    30, so values under it (including 29) still land on 60, same as a missing value."""

    def test_29_minutes_falls_to_the_only_lower_band(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 29}), 60)

    def test_30_minutes(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 30}), 60)

    def test_119_minutes_still_under_the_act_threshold(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 119}), 60)

    def test_120_minutes_crosses_into_act(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 120}), 132)

    def test_scaling_beyond_120_and_the_cap_at_9(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 180}), 133)
        # 1000 // 60 == 16, which the spec's `min(..., 9)` clamps to 9.
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 1000}), 139)

    def test_missing_or_unparseable_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("MISSING_TIME", {}), 60)
        self.assertEqual(triage_rank("MISSING_TIME", None), 60)
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": "not-a-number"}), 60)
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": None}), 60)


class TestTriageRankLeftEarlyBand(unittest.TestCase):
    def test_59_minutes_is_routine(self):
        self.assertEqual(triage_rank("LEFT_EARLY", {"minutes": 59}), 25)

    def test_60_minutes_crosses_into_review(self):
        self.assertEqual(triage_rank("LEFT_EARLY", {"minutes": 60}), 70)

    def test_missing_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("LEFT_EARLY", {}), 25)


class TestTriageRankLateStartBand(unittest.TestCase):
    def test_59_minutes_is_routine(self):
        self.assertEqual(triage_rank("LATE_START", {"minutes": 59}), 20)

    def test_60_minutes_crosses_into_review(self):
        self.assertEqual(triage_rank("LATE_START", {"minutes": 60}), 65)

    def test_missing_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("LATE_START", {}), 20)


class TestTriageRankLateFromLunchBand(unittest.TestCase):
    def test_29_minutes_is_routine(self):
        self.assertEqual(triage_rank("LATE_FROM_LUNCH", {"minutes": 29}), 15)

    def test_30_minutes_crosses_into_review(self):
        self.assertEqual(triage_rank("LATE_FROM_LUNCH", {"minutes": 30}), 55)

    def test_missing_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("LATE_FROM_LUNCH", {}), 15)


class TestTriageRankOrderings(unittest.TestCase):
    """The two orderings the spec calls out by name — the reason this module exists
    as a dimension separate from `severity` at all (see the module docstring)."""

    def test_a_3h_missing_time_outranks_a_35_minute_one(self):
        long_gap = triage_rank("MISSING_TIME", {"minutes": 180})
        short_gap = triage_rank("MISSING_TIME", {"minutes": 35})
        self.assertGreater(long_gap, short_gap)
        self.assertEqual(tier_for_rank(long_gap), TIER_ACT)
        self.assertEqual(tier_for_rank(short_gap), TIER_REVIEW)

    def test_off_shift_punch_outranks_late_start_despite_equal_severity(self):
        # Both flag codes carry FLAG_SEVERITY "WARNING" (attendance_flag.py:6-20) —
        # severity alone cannot express this ordering, which is exactly why
        # triage_rank is a second, additive dimension rather than a severity change.
        off_shift = triage_rank("OFF_SHIFT_PUNCH", {})
        modest_late_start = triage_rank("LATE_START", {"minutes": 15})
        self.assertGreater(off_shift, modest_late_start)


class TestTierForRank(unittest.TestCase):
    def test_boundary_at_100_is_act(self):
        self.assertEqual(tier_for_rank(100), TIER_ACT)
        self.assertEqual(tier_for_rank(99), TIER_REVIEW)

    def test_boundary_at_50_is_review(self):
        self.assertEqual(tier_for_rank(50), TIER_REVIEW)
        self.assertEqual(tier_for_rank(49), TIER_ROUTINE)

    def test_zero_and_negative_are_routine(self):
        self.assertEqual(tier_for_rank(0), TIER_ROUTINE)
        self.assertEqual(tier_for_rank(-1), TIER_ROUTINE)
