import unittest

from dewey_time.attendance_engine.flag_identity import parse_evidence
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


class TestTriageRankNonFiniteMinutes(unittest.TestCase):
    """`minutes` is engine-written JSON, and json.loads accepts the bare tokens
    NaN, Infinity and -Infinity — so a malformed row really can carry a non-finite
    float. triage_rank sits on the queue read path, which reads EVERY flag in a
    range in one pass, so raising here 500s the whole queue for every employee
    instead of degrading one flag. Same rule as any other unreadable value: a
    number we cannot use is not evidence of urgency, so it takes the lowest band.
    """

    NON_FINITE = (float("nan"), float("inf"), float("-inf"))
    # The same three as they arrive from json.loads on a Long Text column that was
    # never re-encoded — the string branch of _minutes.
    NON_FINITE_TEXT = ("NaN", "Infinity", "-Infinity")

    def test_non_finite_float_minutes_degrade_to_the_lowest_band(self):
        for value in self.NON_FINITE:
            with self.subTest(value=value):
                self.assertEqual(triage_rank("MISSING_TIME", {"minutes": value}), 60)
                self.assertEqual(triage_rank("LEFT_EARLY", {"minutes": value}), 25)
                self.assertEqual(triage_rank("LATE_START", {"minutes": value}), 20)
                self.assertEqual(triage_rank("LATE_FROM_LUNCH", {"minutes": value}), 15)

    def test_non_finite_string_minutes_degrade_to_the_lowest_band(self):
        for value in self.NON_FINITE_TEXT:
            with self.subTest(value=value):
                self.assertEqual(triage_rank("MISSING_TIME", {"minutes": value}), 60)
                self.assertEqual(triage_rank("LEFT_EARLY", {"minutes": value}), 25)
                self.assertEqual(triage_rank("LATE_START", {"minutes": value}), 20)
                self.assertEqual(triage_rank("LATE_FROM_LUNCH", {"minutes": value}), 15)

    def test_the_real_path_a_non_finite_value_arrives_by(self):
        # parse_evidence is what the queue runs the Long Text column through before
        # triage_rank ever sees it, and json.loads passes these tokens straight
        # through — so this is not a hypothetical input shape.
        evidence = parse_evidence('{"minutes": Infinity, "reason": "gap"}')
        self.assertEqual(triage_rank("MISSING_TIME", evidence), 60)

    def test_finite_string_minutes_still_band_normally(self):
        # The widened except must not swallow values that parse perfectly well.
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": "180"}), 133)
        self.assertEqual(triage_rank("LATE_START", {"minutes": "60.4"}), 65)


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


class TestProvisionalNoShowRank(unittest.TestCase):
    """A no-show the day has not confirmed must not outrank everything.

    UNNOTIFIED_ABSENCE is a fixed 150 -- top of act, above ATTENDANCE_ISSUE.
    That is right for a confirmed no-show at closeout and wrong for a
    provisional one raised 31 minutes into a shift, which replaces a
    MISSING_TIME that ranked 60. Ranking the provisional row on the same
    banding keeps queue ordering identical to before the no-show existed.
    """

    def test_a_confirmed_no_show_still_tops_the_queue(self):
        from dewey_time.attendance_engine.flag_triage import triage_rank

        self.assertEqual(triage_rank("UNNOTIFIED_ABSENCE", {}), 150)
        self.assertEqual(
            triage_rank("UNNOTIFIED_ABSENCE", {"reason": "on_shift_no_checkins"}), 150
        )

    def test_a_provisional_no_show_ranks_like_the_missing_time_it_replaces(self):
        from dewey_time.attendance_engine.flag_triage import triage_rank

        # 31 minutes in: the MISSING_TIME this replaces ranked 60.
        self.assertEqual(
            triage_rank("UNNOTIFIED_ABSENCE", {"provisional": True, "minutes": 31}),
            triage_rank("MISSING_TIME", {"minutes": 31}),
        )
        # Six hours in: the same act-tier band, not a jump to 150.
        self.assertEqual(
            triage_rank("UNNOTIFIED_ABSENCE", {"provisional": True, "minutes": 360}),
            triage_rank("MISSING_TIME", {"minutes": 360}),
        )
        self.assertNotEqual(
            triage_rank("UNNOTIFIED_ABSENCE", {"provisional": True, "minutes": 360}), 150
        )

    def test_a_provisional_no_show_with_unreadable_minutes_takes_the_lowest_band(self):
        from dewey_time.attendance_engine.flag_triage import triage_rank

        # _minutes is total by design: a value it cannot read is not evidence
        # of urgency, and must never promote a row to a top band.
        for bad in ({"provisional": True}, {"provisional": True, "minutes": "nonsense"}):
            self.assertEqual(triage_rank("UNNOTIFIED_ABSENCE", bad), 60, bad)

    def test_the_provisional_flag_is_what_switches_it_not_the_minutes(self):
        # minutes present but not provisional -> still the confirmed 150.
        from dewey_time.attendance_engine.flag_triage import triage_rank

        self.assertEqual(triage_rank("UNNOTIFIED_ABSENCE", {"minutes": 31}), 150)


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
