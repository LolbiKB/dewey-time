import unittest

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.utils import sandbox_verify as sv  # noqa: E402


def _row(employee, date, code, day_closed=1):
    return {"employee": employee, "attendance_date": date, "flag_code": code, "day_closed": day_closed}


class TestNoDuplicateFlags(unittest.TestCase):
    def test_detects_duplicate(self):
        rows = [
            _row("E1", "2026-06-01", "LATE_START"),
            _row("E1", "2026-06-01", "LATE_START"),
            _row("E1", "2026-06-02", "LATE_START"),
        ]
        violations = sv.no_duplicate_flags(rows)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["count"], 2)

    def test_clean_set_has_no_violations(self):
        rows = [
            _row("E1", "2026-06-01", "LATE_START"),
            _row("E1", "2026-06-01", "LEFT_EARLY"),
        ]
        self.assertEqual(sv.no_duplicate_flags(rows), [])

    def test_same_code_different_day_closed_is_not_duplicate(self):
        # day_closed is part of the identity: provisional + final are distinct rows.
        rows = [
            _row("E1", "2026-06-01", "MISSING_TIME", day_closed=0),
            _row("E1", "2026-06-01", "MISSING_TIME", day_closed=1),
        ]
        self.assertEqual(sv.no_duplicate_flags(rows), [])


class TestMutualExclusion(unittest.TestCase):
    def test_absence_with_off_shift_is_violation(self):
        rows = [
            _row("E1", "2026-06-01", "UNNOTIFIED_ABSENCE"),
            _row("E1", "2026-06-01", "OFF_SHIFT_PUNCH"),
        ]
        violations = sv.mutual_exclusion_violations(rows)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["groups"], ["ABSENCE", "OFF_SHIFT"])

    def test_absence_with_on_shift_punch_is_violation(self):
        rows = [
            _row("E1", "2026-06-01", "UNNOTIFIED_ABSENCE"),
            _row("E1", "2026-06-01", "LATE_START"),
        ]
        violations = sv.mutual_exclusion_violations(rows)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["groups"], ["ABSENCE", "ON_SHIFT_PUNCH"])

    def test_off_shift_with_on_shift_punch_is_violation(self):
        rows = [
            _row("E1", "2026-06-01", "OFF_SHIFT_PUNCH"),
            _row("E1", "2026-06-01", "MISSING_TIME"),
        ]
        violations = sv.mutual_exclusion_violations(rows)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["groups"], ["OFF_SHIFT", "ON_SHIFT_PUNCH"])

    def test_same_group_codes_are_fine(self):
        # LATE_START + LEFT_EARLY + NON_PRIMARY_SITE_PUNCH all live in one pass.
        rows = [
            _row("E1", "2026-06-01", "LATE_START"),
            _row("E1", "2026-06-01", "LEFT_EARLY"),
            _row("E1", "2026-06-01", "NON_PRIMARY_SITE_PUNCH"),
        ]
        self.assertEqual(sv.mutual_exclusion_violations(rows), [])

    def test_attendance_issue_does_not_cross_groups(self):
        # ATTENDANCE_ISSUE is emitted in BOTH the zero-checkins and on-shift paths,
        # so it legitimately co-occurs with UNNOTIFIED_ABSENCE — must NOT be flagged.
        rows = [
            _row("E1", "2026-06-01", "UNNOTIFIED_ABSENCE"),
            _row("E1", "2026-06-01", "ATTENDANCE_ISSUE"),
        ]
        self.assertEqual(sv.mutual_exclusion_violations(rows), [])

    def test_different_day_closed_is_not_a_violation(self):
        # Intraday (0) and closeout (1) are separate passes; cross-pass is allowed.
        rows = [
            _row("E1", "2026-06-01", "UNNOTIFIED_ABSENCE", day_closed=1),
            _row("E1", "2026-06-01", "MISSING_TIME", day_closed=0),
        ]
        self.assertEqual(sv.mutual_exclusion_violations(rows), [])


class TestProvisionalAfterCloseout(unittest.TestCase):
    def test_both_states_present_is_flagged(self):
        rows = [
            _row("E1", "2026-06-01", "MISSING_TIME", day_closed=0),
            _row("E1", "2026-06-01", "LATE_START", day_closed=1),
        ]
        violations = sv.provisional_after_closeout(rows)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["provisional_codes"], ["MISSING_TIME"])
        self.assertEqual(violations[0]["final_codes"], ["LATE_START"])

    def test_only_final_is_clean(self):
        rows = [
            _row("E1", "2026-06-01", "LATE_START", day_closed=1),
            _row("E1", "2026-06-01", "LEFT_EARLY", day_closed=1),
        ]
        self.assertEqual(sv.provisional_after_closeout(rows), [])

    def test_only_provisional_is_clean(self):
        rows = [_row("E1", "2026-06-01", "MISSING_TIME", day_closed=0)]
        self.assertEqual(sv.provisional_after_closeout(rows), [])


class TestOrphanEmployeeFlags(unittest.TestCase):
    def test_unknown_employee_is_flagged(self):
        rows = [
            _row("E1", "2026-06-01", "LATE_START"),
            _row("GHOST", "2026-06-01", "LATE_START"),
            _row("GHOST", "2026-06-02", "LEFT_EARLY"),
        ]
        violations = sv.orphan_employee_flags(rows, valid_employees={"E1"})
        self.assertEqual(violations, [{"employee": "GHOST", "flag_count": 2}])

    def test_all_known_is_clean(self):
        rows = [_row("E1", "2026-06-01", "LATE_START")]
        self.assertEqual(sv.orphan_employee_flags(rows, valid_employees={"E1", "E2"}), [])


class TestUnknownFlagCode(unittest.TestCase):
    def test_bogus_code_is_flagged(self):
        rows = [
            _row("E1", "2026-06-01", "LATE_START"),
            _row("E1", "2026-06-02", "WAT_IS_THIS"),
        ]
        violations = sv.unknown_flag_code(rows, valid_codes={"LATE_START", "LEFT_EARLY"})
        self.assertEqual(violations, [{"flag_code": "WAT_IS_THIS", "flag_count": 1}])

    def test_all_known_is_clean(self):
        rows = [_row("E1", "2026-06-01", "LATE_START")]
        self.assertEqual(sv.unknown_flag_code(rows, valid_codes={"LATE_START"}), [])


if __name__ == "__main__":
    unittest.main()
