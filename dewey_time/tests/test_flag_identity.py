import unittest
from datetime import date

from dewey_time.attendance_engine.flag_identity import (
    evidence_fingerprint,
    flag_identity,
    parse_evidence,
)


class TestFlagIdentity(unittest.TestCase):
    def test_provisional_and_final_produce_the_same_identity(self):
        # flag_identity() has no day_closed parameter at all, but the point
        # being guarded is behavioural, not just "the signature lacks a
        # field": a provisional flag row and the final row that later
        # replaces it at closeout carry identical employee/attendance_date/
        # flag_code/evidence and MUST resolve to the same key so a decision
        # recorded pre-closeout still attaches post-closeout.
        provisional = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="LATE_START",
            evidence={"minutes": 12, "reason": "late_start"},
        )
        final = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="LATE_START",
            evidence={"minutes": 12, "reason": "late_start"},
        )
        self.assertEqual(provisional, final)
        self.assertEqual(provisional, "AUTO-hr_emp_00042-2026-08-03-late_start")

    def test_day_closed_is_excluded_from_identity(self):
        # Simulates the real production shape: a provisional Attendance
        # Flag row (day_closed=0) and the final row that later replaces it
        # at closeout (day_closed=1) carry identical employee/
        # attendance_date/flag_code/evidence. Extracting only the four
        # flag_identity() contract fields from each row -- exactly as the
        # Task 5/Task 6 call sites will -- must yield the same identity in
        # both cases, since day_closed never reaches flag_identity() at
        # all. Uses MISSING_TIME (an evidence-keyed suffix, unlike
        # LATE_START above) and pins the resulting string, so a suffix
        # builder that started ignoring interval_start, or any other
        # deviation from the module's real behaviour, would fail this
        # assertion even though it says nothing about day_closed itself.
        provisional_row = {
            "day_closed": 0,
            "employee": "HR-EMP-00042",
            "attendance_date": date(2026, 8, 3),
            "flag_code": "MISSING_TIME",
            "evidence": {"interval_start": "2026-08-03T09:00:00"},
        }
        final_row = {**provisional_row, "day_closed": 1}

        def identity_from_row(row):
            return flag_identity(
                employee=row["employee"],
                attendance_date=row["attendance_date"],
                flag_code=row["flag_code"],
                evidence=row["evidence"],
            )

        self.assertEqual(identity_from_row(provisional_row), identity_from_row(final_row))
        self.assertEqual(
            identity_from_row(provisional_row),
            "AUTO-hr_emp_00042-2026-08-03-missing-time-2026_08_03t09:00:00",
        )

    def test_missing_time_identity_changes_when_interval_start_changes(self):
        first = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="MISSING_TIME",
            evidence={"interval_start": "2026-08-03T09:00:00"},
        )
        second = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="MISSING_TIME",
            evidence={"interval_start": "2026-08-03T11:30:00"},
        )
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("AUTO-hr_emp_00042-2026-08-03-missing-time-"))
        self.assertTrue(second.startswith("AUTO-hr_emp_00042-2026-08-03-missing-time-"))

    def test_delivery_failed_evidence_key_over_80_chars_is_capped(self):
        long_pin = "9" * 120
        identity = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="DELIVERY_FAILED",
            evidence={"pin": long_pin},
        )
        prefix = "AUTO-hr_emp_00042-2026-08-03-delivery-failed-"
        self.assertTrue(identity.startswith(prefix))
        suffix_key = identity[len(prefix):]
        # scrub() of an all-digit string is a no-op besides str(), so the
        # capped key is just the first 80 of the 120 nines -- this is the
        # exact truncation window attendance_flag.py:90-103 leaves open
        # (uncapped there); this module closes it.
        self.assertEqual(suffix_key, "9" * 80)
        self.assertEqual(len(suffix_key), 80)

    def test_delivery_failed_prefers_nested_undelivered_key_over_top_level(self):
        # _delivery_failed_suffix checks evidence["undelivered"] first and
        # only falls back to a top-level key if that lookup misses. A
        # future refactor that swapped the two lookup loops (or checked
        # top-level first) would pass every other DELIVERY_FAILED test in
        # this file -- none of them supply both a nested and a top-level
        # key at once -- while silently changing the identity of every
        # real DELIVERY_FAILED flag, orphaning any Attendance Flag
        # Decision stored against the old identity.
        identity = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="DELIVERY_FAILED",
            evidence={"undelivered": {"pin": "1234"}, "pin": "9999"},
        )
        self.assertEqual(identity, "AUTO-hr_emp_00042-2026-08-03-delivery-failed-1234")

    def test_attendance_issue_suffix_reflects_reason_and_never_falls_back(self):
        # ATTENDANCE_ISSUE folds two distinct real-world causes -- a
        # single checkin and an unknown device branch -- into one
        # flag_code, so two ATTENDANCE_ISSUE flags for the same
        # employee/date is the normal case, not an edge case. Unlike its
        # MISSING_TIME/DELIVERY_FAILED siblings, _attendance_issue_suffix
        # never returns None (its `reason` defaults to "issue"), so it can
        # never reach the scrub(flag_code) fallback -- a regression that
        # collapsed both reasons into one identity would go uncaught
        # without an assertion that two different reasons produce
        # different identities.
        single_checkin = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="ATTENDANCE_ISSUE",
            evidence={"reason": "single_checkin"},
        )
        unknown_device_branch = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="ATTENDANCE_ISSUE",
            evidence={"reason": "unknown_device_branch"},
        )
        self.assertNotEqual(single_checkin, unknown_device_branch)

        empty_evidence = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="ATTENDANCE_ISSUE",
            evidence={},
        )
        self.assertEqual(
            empty_evidence, "AUTO-hr_emp_00042-2026-08-03-attendance-issue-issue_"
        )

    def test_missing_evidence_keys_fall_back_to_scrub_flag_code(self):
        # MISSING_TIME with no interval_start: _missing_time_suffix returns
        # None, so flag_identity() falls back to scrub(flag_code) -- same
        # fallback attendance_flag.py's before_insert uses when its own
        # _missing_time_key() returns None.
        missing_time = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="MISSING_TIME",
            evidence={},
        )
        self.assertEqual(missing_time, "AUTO-hr_emp_00042-2026-08-03-missing_time")

        # DELIVERY_FAILED with none of the recognised keys present, at
        # top level or nested under "undelivered".
        delivery_failed = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="DELIVERY_FAILED",
            evidence={"undelivered": {"something_else": "x"}},
        )
        self.assertEqual(delivery_failed, "AUTO-hr_emp_00042-2026-08-03-delivery_failed")

        # A code with no evidence-keyed suffix at all (e.g. UNNOTIFIED_ABSENCE)
        # always falls straight to scrub(flag_code), regardless of evidence.
        unnotified = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="UNNOTIFIED_ABSENCE",
            evidence={"reason": "irrelevant"},
        )
        self.assertEqual(unnotified, "AUTO-hr_emp_00042-2026-08-03-unnotified_absence")

    def test_fingerprint_stable_for_equal_evidence_and_differs_when_minutes_change(self):
        fp_a = evidence_fingerprint({"minutes": 12, "reason": "late_start"})
        fp_b = evidence_fingerprint({"minutes": 12, "reason": "late_start"})
        fp_c = evidence_fingerprint({"minutes": 90, "reason": "late_start"})

        self.assertEqual(fp_a, fp_b)
        self.assertNotEqual(fp_a, fp_c)
        self.assertEqual(len(fp_a), 32)
        # lowercase hex only
        self.assertTrue(all(ch in "0123456789abcdef" for ch in fp_a))

    def test_flag_carrying_neither_minutes_nor_reason_has_a_constant_fingerprint(self):
        # UNNOTIFIED_ABSENCE-shaped evidence: no "minutes", no "reason" key
        # at all. Both should hash the same constant {"minutes": null,
        # "reason": null} payload regardless of what else is in evidence.
        fp_empty = evidence_fingerprint({})
        fp_other_keys = evidence_fingerprint({"employee_branch": "PP-HQ", "device_id": "42"})
        fp_none = evidence_fingerprint(None)

        self.assertEqual(fp_empty, fp_other_keys)
        self.assertEqual(fp_empty, fp_none)

    def test_parse_evidence_never_returns_none(self):
        self.assertEqual(parse_evidence(None), {})
        self.assertEqual(parse_evidence(""), {})
        self.assertEqual(parse_evidence("not json"), {})
        self.assertEqual(parse_evidence("[1, 2, 3]"), {})
        self.assertEqual(parse_evidence('{"minutes": 5}'), {"minutes": 5})
        self.assertEqual(parse_evidence({"minutes": 5}), {"minutes": 5})


if __name__ == "__main__":
    unittest.main()
