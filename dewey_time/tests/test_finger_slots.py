"""The finger-slot table — the one convention in this feature most likely wrong.

Deliberately imports no frappe mock: finger_slots is frappe-free, and keeping it
that way is what makes this file run in milliseconds.
"""

import unittest

from dewey_time.attendance_engine import finger_slots


class TestSlugFor(unittest.TestCase):
    def test_every_device_slot_has_a_name(self):
        self.assertEqual(
            [finger_slots.slug_for(i) for i in range(10)],
            [
                "left_little", "left_ring", "left_middle", "left_index", "left_thumb",
                "right_thumb", "right_index", "right_middle", "right_ring", "right_little",
            ],
        )

    def test_the_hands_mirror_around_the_thumbs(self):
        # The ordering is the whole point of the table and the single thing most
        # likely to be wrong. A device counts inwards from the left little
        # finger to the left thumb, then outwards from the right thumb. This
        # catches a table someone "tidied" into left-to-right 0..9, which reads
        # perfectly plausible and is wrong on five fingers.
        self.assertEqual(finger_slots.slug_for(4), "left_thumb")
        self.assertEqual(finger_slots.slug_for(5), "right_thumb")
        self.assertEqual(finger_slots.slug_for(0), "left_little")
        self.assertEqual(finger_slots.slug_for(9), "right_little")

    def test_a_slot_the_devices_do_not_have_is_named_rather_than_dropped(self):
        # A fallback, not a drop. The client shows names ONLY when their count
        # equals fingerprint_count, so silently dropping one strange value would
        # demote a whole correct list back to a bare number.
        for junk in (10, -1, None, "", "x", "3.5", []):
            with self.subTest(value=repr(junk)):
                self.assertEqual(finger_slots.slug_for(junk), "other_finger")

    def test_the_table_has_exactly_ten_slots_and_no_gaps(self):
        self.assertEqual(sorted(finger_slots.FINGER_SLUGS), list(range(10)))
        self.assertEqual(len(set(finger_slots.FINGER_SLUGS.values())), 10)


class TestStoredField(unittest.TestCase):
    def test_the_stored_string_parses_back_to_ints(self):
        self.assertEqual(finger_slots.ids_from_field("3,6"), [3, 6])

    def test_an_empty_field_is_no_fingers_rather_than_an_error(self):
        for empty in (None, "", "   ", ",,"):
            with self.subTest(value=repr(empty)):
                self.assertEqual(finger_slots.ids_from_field(empty), [])

    def test_a_junk_entry_is_skipped_and_the_rest_survive(self):
        # Bridge payloads are wire data. One bad element must not cost the
        # others -- the rule enrollment._coerce_int already follows.
        self.assertEqual(finger_slots.ids_from_field("x, 3 ,,6"), [3, 6])

    def test_writing_dedupes_and_sorts_so_a_row_is_stable(self):
        # The register row is saved on every snapshot. An unstable ordering
        # would rewrite `modified` on hundreds of rows that did not change.
        self.assertEqual(finger_slots.field_from_ids([6, 3, 3]), "3,6")

    def test_writing_nothing_is_an_empty_string_not_the_word_none(self):
        self.assertEqual(finger_slots.field_from_ids(None), "")
        self.assertEqual(finger_slots.field_from_ids([]), "")

    def test_a_wire_value_may_arrive_as_a_string_or_a_list(self):
        self.assertEqual(finger_slots.normalize_ids("6,3"), [3, 6])
        self.assertEqual(finger_slots.normalize_ids([6, "3"]), [3, 6])
        self.assertEqual(finger_slots.normalize_ids(None), [])

    def test_a_round_trip_survives_both_directions(self):
        self.assertEqual(
            finger_slots.ids_from_field(finger_slots.field_from_ids([6, 3])),
            [3, 6],
        )
