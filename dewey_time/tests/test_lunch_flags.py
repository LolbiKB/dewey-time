import sys
import unittest
from datetime import date, datetime

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


class TestLunchFlags(unittest.TestCase):
    def test_missing_lunch_when_no_pair_in_window(self):
        from dewey_time.attendance_engine.lunch_flags import evaluate_lunch_flags

        d = date(2026, 6, 3)
        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0)},
            {"time": datetime(2026,  6, 3, 17, 0)},
        ]
        meta = {
            "custom_lunch_start": datetime(2026, 1, 1, 12, 0).time(),
            "custom_lunch_end": datetime(2026, 1, 1, 13, 0).time(),
        }
        flags = evaluate_lunch_flags(
            checkins=checkins, shift_meta=meta, attendance_date=d, grace_minutes=15
        )
        self.assertEqual(flags, [])

    def test_no_flags_when_lunch_out_in_present(self):
        from dewey_time.attendance_engine.lunch_flags import evaluate_lunch_flags

        d = date(2026, 6, 3)
        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0)},
            {"time": datetime(2026, 6, 3, 12, 5)},
            {"time": datetime(2026, 6, 3, 12, 55)},
            {"time": datetime(2026, 6, 3, 17, 0)},
        ]
        meta = {
            "custom_lunch_start": datetime(2026, 1, 1, 12, 0).time(),
            "custom_lunch_end": datetime(2026, 1, 1, 13, 0).time(),
        }
        flags = evaluate_lunch_flags(
            checkins=checkins, shift_meta=meta, attendance_date=d, grace_minutes=15
        )
        self.assertEqual(flags, [])

    def test_late_from_lunch_after_grace(self):
        from dewey_time.attendance_engine.lunch_flags import evaluate_lunch_flags

        d = date(2026, 6, 3)
        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0)},
            {"time": datetime(2026, 6, 3, 12, 5)},
            {"time": datetime(2026, 6, 3, 13, 30)},
            {"time": datetime(2026, 6, 3, 17, 0)},
        ]
        meta = {
            "custom_lunch_start": datetime(2026, 1, 1, 12, 0).time(),
            "custom_lunch_end": datetime(2026, 1, 1, 13, 0).time(),
        }
        flags = evaluate_lunch_flags(
            checkins=checkins, shift_meta=meta, attendance_date=d, grace_minutes=15
        )
        codes = [c for c, _ in flags]
        self.assertIn("LATE_FROM_LUNCH", codes)
        self.assertNotIn("MISSING_LUNCH", codes)

    def test_ignores_short_pair_and_does_not_flag_late_from_lunch(self):
        from dewey_time.attendance_engine.lunch_flags import evaluate_lunch_flags

        d = date(2026, 6, 3)
        # Scheduled lunch: 12:00–13:00 (60m). Min observed lunch = 30m (half scheduled).
        # A 15m OUT→IN pair inside the lunch window should be ignored as "not lunch".
        checkins = [
            {"time": datetime(2026, 6, 3, 8, 0)},
            {"time": datetime(2026, 6, 3, 12, 0)},
            {"time": datetime(2026, 6, 3, 12, 15)},
            {"time": datetime(2026, 6, 3, 13, 0)},
            {"time": datetime(2026, 6, 3, 17, 0)},
        ]
        meta = {
            "custom_lunch_start": datetime(2026, 1, 1, 12, 0).time(),
            "custom_lunch_end": datetime(2026, 1, 1, 13, 0).time(),
        }
        flags = evaluate_lunch_flags(checkins=checkins, shift_meta=meta, attendance_date=d, grace_minutes=0)
        self.assertEqual(flags, [])

    def test_skips_short_shift_without_lunch_fields(self):
        from dewey_time.attendance_engine.lunch_flags import evaluate_lunch_flags

        d = date(2026, 6, 6)
        checkins = [
            {"time": datetime(2026, 6, 6, 8, 0)},
            {"time": datetime(2026, 6, 6, 12, 0)},
        ]
        meta = {"custom_lunch_start": None, "custom_lunch_end": None}
        self.assertEqual(
            evaluate_lunch_flags(checkins=checkins, shift_meta=meta, attendance_date=d),
            [],
        )


if __name__ == "__main__":
    unittest.main()
