import unittest
from datetime import date, datetime, time, timedelta

from dewey_time.attendance_engine.shift_times import combine_date_time, shift_time_to_minutes


class TestShiftTimes(unittest.TestCase):
    def test_shift_time_to_minutes_timedelta(self):
        self.assertEqual(shift_time_to_minutes(timedelta(hours=8)), 8 * 60)
        self.assertEqual(shift_time_to_minutes(timedelta(hours=8, minutes=30)), 8 * 60 + 30)

    def test_combine_date_time_timedelta(self):
        result = combine_date_time(date(2026, 6, 1), timedelta(hours=8, minutes=15))
        self.assertEqual(result, datetime(2026, 6, 1, 8, 15, 0))

    def test_combine_date_time_time(self):
        result = combine_date_time(date(2026, 6, 1), time(9, 30))
        self.assertEqual(result, datetime(2026, 6, 1, 9, 30, 0))

    def test_combine_date_time_string(self):
        result = combine_date_time(date(2026, 6, 1), "17:00:00")
        self.assertEqual(result.hour, 17)
        self.assertEqual(result.minute, 0)
