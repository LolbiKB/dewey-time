"""receipt.py -- the mid-stream replay of the timeline's pairing rule.

Frappe-free on both sides: the module imports no frappe, so these tests run
under plain ``python3 -m unittest`` with no mock install.

The fixture file is the contract. punch_replay_fixtures.json is read by this
suite AND by punchReplayParity.test.ts, so a change to either implementation
that moves a verb, a segment, or a total has to show up as a red test against
the same frozen day on at least one side.
"""

from __future__ import annotations

import json
import unittest
from datetime import datetime
from pathlib import Path

from dewey_time.telegram import receipt

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "punch_replay_fixtures.json").read_text()
)


def _p(time: str, branch: str | None = "DIS Iconic", log_type: str = "") -> dict:
    return {"time": time, "log_type": log_type, "custom_device_branch": branch}


class TestFixtureParity(unittest.TestCase):
    """Every fixture day, announced at every prefix.

    The verbs column is asserted per PREFIX, not per whole day: the notifier
    sees the day one punch at a time, and announce() promises that a punch's
    verb never changes when later punches arrive (the walk is causal). Running
    every prefix proves that promise instead of assuming it.
    """

    def test_every_case_at_every_prefix(self):
        for case in FIXTURES["cases"]:
            punches = case["punches"]
            expected_verbs = case["py_verbs"]
            self.assertEqual(
                len(expected_verbs), len(punches),
                f"{case['name']}: fixture columns disagree on punch count",
            )
            for k in range(1, len(punches) + 1):
                result = receipt.announce(punches[:k])
                self.assertEqual(
                    result["verb"], expected_verbs[k - 1],
                    f"{case['name']}: verb of punch {k - 1} announced mid-stream",
                )
            final = receipt.announce(punches)
            self.assertEqual(
                final["so_far_minutes"], case["py_so_far_minutes"],
                f"{case['name']}: hours figure at the day's last punch",
            )

    def test_the_clean_days_agree_with_the_timeline_total(self):
        # THE PARITY CLAIM ITSELF: whenever the receipt prints an hours
        # figure, it equals what deriveSegments sums for the same day. Days
        # where py_so_far_minutes is null carry no claim, and the double-tap
        # case documents WHY null: the retrospective total there (60) is the
        # figure the receipt refuses to print.
        printed = 0
        for case in FIXTURES["cases"]:
            if case["py_so_far_minutes"] is None:
                continue
            printed += 1
            self.assertEqual(
                case["py_so_far_minutes"], case["ts_total_minutes"],
                f"{case['name']}: receipt figure vs timeline total",
            )
        self.assertGreaterEqual(printed, 3, "the parity claim must not be vacuous")


class TestAnnounce(unittest.TestCase):
    def test_first_punch_of_day_is_an_arrival(self):
        result = receipt.announce([_p("2026-08-17 07:58:00")])
        self.assertEqual(result["verb"], receipt.IN)
        self.assertTrue(result["is_first_punch_of_day"])

    def test_a_duplicate_is_not_the_first_punch_of_day(self):
        result = receipt.announce(
            [_p("2026-08-17 07:58:00"), _p("2026-08-17 07:58:05")]
        )
        self.assertEqual(result["verb"], receipt.NO_VERB)
        self.assertFalse(result["is_first_punch_of_day"])

    def test_the_duplicate_window_has_an_edge(self):
        # Ten seconds in: still a duplicate. Eleven: a real punch that closes
        # the open arrival. The window must stay this tight -- see the
        # constant's comment; at 120s it swallowed genuine movement and the
        # drop itself inverted the rest of the run.
        at_window = receipt.announce(
            [_p("2026-08-17 08:00:00"), _p("2026-08-17 08:00:10")]
        )
        self.assertEqual(at_window["verb"], receipt.NO_VERB)
        past_window = receipt.announce(
            [_p("2026-08-17 08:00:00"), _p("2026-08-17 08:00:11")]
        )
        self.assertEqual(past_window["verb"], receipt.OUT)

    def test_the_window_is_measured_from_the_kept_punch_not_the_dropped_one(self):
        # A bounce must not extend the window: the third row is 4 seconds
        # after a DROPPED tap but 12 after the kept arrival, so it is a real
        # punch and closes the day's arrival. Measuring from the last punch
        # seen (dropped or not) would let a tap chain swallow it.
        result = receipt.announce(
            [
                _p("2026-08-17 08:00:00"),
                _p("2026-08-17 08:00:08"),
                _p("2026-08-17 08:00:12"),
            ]
        )
        self.assertEqual(result["verb"], receipt.OUT)

    def test_a_quick_punch_at_another_campus_is_not_a_duplicate(self):
        # The duplicate rule is same-branch by design: a punch at a second
        # campus seconds after the first is physically two devices, not one
        # bounced tap. If it were dropped as a duplicate it would never open
        # its run, and the campus-B departure below would degrade to "" --
        # that is the observable difference this test pins.
        result = receipt.announce(
            [
                _p("2026-08-17 08:00:00", branch="DIS Iconic"),
                _p("2026-08-17 08:01:00", branch="DIU"),
                _p("2026-08-17 12:00:00", branch="DIU"),
            ]
        )
        self.assertEqual(result["verb"], receipt.OUT)

    def test_a_labelled_punch_is_never_a_duplicate(self):
        # Labels are Desk edits -- deliberate. A labelled OUT seconds after
        # an arrival is believed, not dropped.
        result = receipt.announce(
            [_p("2026-08-17 08:00:00"), _p("2026-08-17 08:00:30", log_type="OUT")]
        )
        self.assertEqual(result["verb"], receipt.OUT)

    def test_datetime_objects_and_strings_are_the_same_day(self):
        # Production hands datetimes; fixtures hand strings. One rule.
        as_strings = receipt.announce(
            [_p("2026-08-17 08:00:00"), _p("2026-08-17 17:00:00")]
        )
        as_datetimes = receipt.announce(
            [
                {"time": datetime(2026, 8, 17, 8, 0), "custom_device_branch": "DIS Iconic"},
                {"time": datetime(2026, 8, 17, 17, 0), "custom_device_branch": "DIS Iconic"},
            ]
        )
        self.assertEqual(as_strings, as_datetimes)

    def test_hours_are_withheld_while_an_arrival_is_still_open(self):
        # in@A, out@A, in@A again, out@A: fine. But in@A, out@A, in@B (open),
        # out@... no -- an OUT that leaves a sibling arrival open elsewhere
        # cannot happen within one run; what CAN happen is a stray OUT.
        stray_out = receipt.announce(
            [
                _p("2026-08-17 08:00:00"),
                _p("2026-08-17 12:00:00"),
                _p("2026-08-17 13:00:00", branch="DIU", log_type="OUT"),
            ]
        )
        self.assertEqual(stray_out["verb"], receipt.OUT)
        self.assertIsNone(stray_out["so_far_minutes"])

    def test_empty_day_says_nothing(self):
        result = receipt.announce([])
        self.assertEqual(result["verb"], receipt.NO_VERB)
        self.assertFalse(result["is_first_punch_of_day"])
        self.assertIsNone(result["so_far_minutes"])

    def test_an_unparseable_time_never_raises(self):
        # A malformed fixture row or a NULL time column must degrade, not
        # crash the notification job.
        result = receipt.announce(
            [_p("garbage"), {"time": None, "custom_device_branch": "DIS Iconic"}]
        )
        self.assertIn(result["verb"], (receipt.IN, receipt.OUT, receipt.NO_VERB))

    def test_a_timeless_punch_closing_an_arrival_degrades_instead_of_raising(self):
        # The shape the test above never reaches: an arrival is OPEN when the
        # timeless row lands, so the pairing subtraction is one deleted guard
        # away from `None - datetime` in a queued job. The verb is still OUT
        # (it closes the arrival) but no pair is countable, so the day's
        # figure stays withheld.
        unlabelled = receipt.announce(
            [_p("2026-08-17 08:00:00"), {"time": None, "custom_device_branch": "DIS Iconic"}]
        )
        self.assertEqual(unlabelled["verb"], receipt.OUT)
        self.assertIsNone(unlabelled["so_far_minutes"])

        labelled = receipt.announce(
            [
                _p("2026-08-17 08:00:00"),
                {"time": None, "custom_device_branch": "DIS Iconic", "log_type": "OUT"},
            ]
        )
        self.assertEqual(labelled["verb"], receipt.OUT)
        self.assertIsNone(labelled["so_far_minutes"])


if __name__ == "__main__":
    unittest.main()
