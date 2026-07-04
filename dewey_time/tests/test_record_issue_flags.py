"""Unit coverage for the ATTENDANCE_ISSUE sub-reasons emitted by
``evaluate_record_issue_flags`` (record_issue_flags.py).

Closes punch-list finding T2-4: prior to this, only ``single_checkin`` and
``delivery_failed`` were asserted (via closeout / integration tests). Here we
exercise the pure function directly for every reason it can emit, plus pin the
one reason that is currently *unreachable* so a future change can't silently
change that without a test flipping.

The function is pure (plain-dict checkins in, ``(code, evidence)`` tuples out),
so these run under the shared frappe mock with no bench.
"""

import unittest
from datetime import date, datetime

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

D = date(2026, 6, 3)


def _reasons(flags):
    """All ATTENDANCE_ISSUE reasons in an evaluate_record_issue_flags result."""
    reasons = []
    for code, evidence in flags:
        assert code == "ATTENDANCE_ISSUE", code
        reasons.append(evidence["reason"])
    return reasons


class TestRecordIssueReasons(unittest.TestCase):
    def test_single_checkin_reason(self):
        """One punch on-shift → exactly the single_checkin reason (the lone
        punch is excluded from the unpaired-punch path by the count==1 guard)."""
        from dewey_time.attendance_engine.record_issue_flags import (
            evaluate_record_issue_flags,
        )

        checkins = [{"time": datetime(2026, 6, 3, 8, 0), "custom_device_branch": "BR1"}]
        flags = evaluate_record_issue_flags(
            checkins=checkins, shift_meta=None, attendance_date=D
        )
        self.assertEqual(_reasons(flags), ["single_checkin"])

    def test_unpaired_punch_reason_on_odd_same_branch_day(self):
        """Three same-branch punches (an odd run) → the trailing punch is
        unpaired → exactly one unpaired_punch reason, nothing else."""
        from dewey_time.attendance_engine.record_issue_flags import (
            evaluate_record_issue_flags,
        )

        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0), "custom_device_branch": "BR1"},
            {"time": datetime(2026, 6, 3, 12, 0), "custom_device_branch": "BR1"},
            {"time": datetime(2026, 6, 3, 17, 0), "custom_device_branch": "BR1"},
        ]
        flags = evaluate_record_issue_flags(
            checkins=checkins, shift_meta=None, attendance_date=D
        )
        self.assertEqual(_reasons(flags), ["unpaired_punch"])
        # The unpaired one is the trailing 17:00 punch.
        (_, evidence), = flags
        self.assertEqual(evidence["punch_time"], datetime(2026, 6, 3, 17, 0).isoformat())
        self.assertEqual(evidence["custom_device_branch"], "BR1")

    def test_unknown_device_branch_reason_on_blank_branch_punches(self):
        """Punches whose custom_device_branch is blank/None → an
        unknown_device_branch reason counting them (they also count as
        unpaired, which is fine — we assert the unknown reason + its count)."""
        from dewey_time.attendance_engine.record_issue_flags import (
            evaluate_record_issue_flags,
        )

        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0), "custom_device_branch": ""},
            {"time": datetime(2026, 6, 3, 17, 0), "custom_device_branch": None},
        ]
        flags = evaluate_record_issue_flags(
            checkins=checkins, shift_meta=None, attendance_date=D
        )
        reasons = _reasons(flags)
        self.assertIn("unknown_device_branch", reasons)
        unknown = [ev for _, ev in flags if ev["reason"] == "unknown_device_branch"]
        self.assertEqual(len(unknown), 1)
        self.assertEqual(unknown[0]["unknown_branch_checkins"], 2)

    def test_missing_lunch_pair_reason_is_currently_unreachable(self):
        """A shift WITH a lunch window and two clean punches but no observed
        lunch pair does NOT emit missing_lunch_pair.

        The reason's only feed is ``evaluate_lunch_flags``, which emits
        LATE_FROM_LUNCH or nothing — never MISSING_LUNCH — so the
        ``if code == "MISSING_LUNCH"`` branch in record_issue_flags.py is
        currently dead. This test pins that behavior: if a MISSING_LUNCH
        detector is ever wired up, this assertion flips and forces a
        deliberate revisit of the missing_lunch_pair reason. (Punch-list T2-4.)
        """
        from dewey_time.attendance_engine.record_issue_flags import (
            evaluate_record_issue_flags,
        )

        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0), "custom_device_branch": "BR1"},
            {"time": datetime(2026, 6, 3, 17, 0), "custom_device_branch": "BR1"},
        ]
        meta = {
            "custom_lunch_start": datetime(2026, 1, 1, 12, 0).time(),
            "custom_lunch_end": datetime(2026, 1, 1, 13, 0).time(),
        }
        flags = evaluate_record_issue_flags(
            checkins=checkins, shift_meta=meta, attendance_date=D, grace_minutes=15
        )
        self.assertNotIn("missing_lunch_pair", _reasons(flags))
        # A clean even-count day with a lunch window but no lunch pair is silent.
        self.assertEqual(flags, [])


if __name__ == "__main__":
    unittest.main()
