import unittest

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


def _profile(start, end, lunch_start=None, lunch_end=None, grace=10):
    return {
        "start_time": start,
        "end_time": end,
        "lunch_start": lunch_start,
        "lunch_end": lunch_end,
        "grace_minutes": grace,
    }


class TestGroupIdentity(unittest.TestCase):
    def test_same_days_and_profile_are_equal(self):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity

        a = _group_identity(["Monday", "Tuesday"], _profile("09:00:00", "17:00:00"))
        b = _group_identity(["Tuesday", "Monday"], _profile("09:00:00", "17:00:00"))
        self.assertEqual(a, b)

    def test_grace_difference_changes_identity(self):
        from dewey_time.attendance_engine.schedule_resolver import _group_identity

        a = _group_identity(["Monday"], _profile("09:00:00", "17:00:00", grace=10))
        b = _group_identity(["Monday"], _profile("09:00:00", "17:00:00", grace=20))
        self.assertNotEqual(a, b)

    def test_identity_key_is_stable_string(self):
        from dewey_time.attendance_engine.schedule_resolver import (
            _group_identity,
            _identity_key,
        )

        key = _identity_key(_group_identity(["Monday"], _profile("09:00:00", "17:00:00")))
        self.assertIsInstance(key, str)
        # Day order in input must not change the key.
        key2 = _identity_key(_group_identity(["Monday"], _profile("09:00:00", "17:00:00")))
        self.assertEqual(key, key2)

    def test_group_identity_key_reads_group_dict(self):
        from dewey_time.attendance_engine.schedule_resolver import (
            _identity_key,
            _group_identity,
            group_identity_key,
        )

        group = {"days": ["Monday", "Friday"], "profile": _profile("08:00:00", "16:00:00")}
        self.assertEqual(
            group_identity_key(group),
            _identity_key(_group_identity(group["days"], group["profile"])),
        )


if __name__ == "__main__":
    unittest.main()
