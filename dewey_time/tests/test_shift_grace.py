import unittest

from dewey_time.attendance_engine.shift_grace import (
    effective_end_grace,
    effective_lunch_return_grace,
    effective_start_grace,
    enrich_shift_meta,
    grace_evidence,
)


class TestShiftGrace(unittest.TestCase):
    def test_effective_start_uses_max_of_custom_and_hrms(self):
        meta = enrich_shift_meta(
            {
                "custom_grace_minutes": 10,
                "late_entry_grace_period": 30,
                "early_exit_grace_period": 5,
            }
        )
        self.assertEqual(effective_start_grace(meta), 30)
        self.assertEqual(effective_end_grace(meta), 10)
        self.assertEqual(effective_lunch_return_grace(meta), 30)

    def test_effective_end_uses_max_of_custom_and_early_exit(self):
        meta = enrich_shift_meta(
            {
                "custom_grace_minutes": 5,
                "late_entry_grace_period": 0,
                "early_exit_grace_period": 20,
            }
        )
        self.assertEqual(effective_start_grace(meta), 5)
        self.assertEqual(effective_end_grace(meta), 20)

    def test_none_and_negative_treated_as_zero(self):
        meta = enrich_shift_meta(
            {
                "custom_grace_minutes": None,
                "late_entry_grace_period": 15,
                "early_exit_grace_period": None,
            }
        )
        self.assertEqual(effective_start_grace(meta), 15)
        self.assertEqual(effective_end_grace(meta), 0)

    def test_grace_evidence_for_start_and_end(self):
        meta = enrich_shift_meta(
            {
                "custom_grace_minutes": 10,
                "late_entry_grace_period": 25,
                "early_exit_grace_period": 40,
            }
        )
        start_ev = grace_evidence(meta)
        self.assertEqual(start_ev["grace_minutes"], 25)
        self.assertEqual(start_ev["custom_grace_minutes"], 10)
        self.assertEqual(start_ev["late_entry_grace_period"], 25)

        end_ev = grace_evidence(meta, for_end=True)
        self.assertEqual(end_ev["grace_minutes"], 40)
        self.assertEqual(end_ev["effective_end_grace_minutes"], 40)

    def test_effective_without_enrich_reads_sources(self):
        meta = {
            "custom_grace_minutes": 0,
            "late_entry_grace_period": 12,
            "early_exit_grace_period": 8,
        }
        self.assertEqual(effective_start_grace(meta), 12)
        self.assertEqual(effective_end_grace(meta), 8)
