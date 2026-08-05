# dewey_time/tests/test_flag_decision_doctype.py
import json
import os
import sys
import unittest
from datetime import date
from types import ModuleType
from unittest.mock import MagicMock


# Same idiom as dewey_time/tests/test_closeout.py:24-96 — mock frappe wholesale
# so this runs without a live bench where possible. Kept local (not imported
# from test_closeout) because bench's test discovery loads modules independently
# and importing across test modules for a helper is not the established pattern
# in this test suite.
def _install_frappe_mock():
    if "frappe" in sys.modules and isinstance(sys.modules["frappe"], MagicMock):
        return

    frappe = MagicMock(name="frappe")
    frappe.throw = MagicMock(
        side_effect=lambda msg, exc=None: (_ for _ in ()).throw(exc or Exception(msg))
    )
    frappe.session = MagicMock(user="Guest")
    frappe.scrub = lambda value: str(value).lower().replace(" ", "-").replace("_", "-")

    model_mod = ModuleType("frappe.model.document")

    class Document:
        def __init__(self, *args, **kwargs):
            payload = {}
            if args and isinstance(args[0], dict):
                payload.update(args[0])
            payload.update(kwargs)
            self.__dict__.update(payload)

    model_mod.Document = Document

    sys.modules["frappe"] = frappe
    sys.modules["frappe.model.document"] = model_mod


_install_frappe_mock()


# Resolve doctype JSON paths from __file__, never the CWD — bench run-tests
# runs from the bench directory, not this repo, so a repo-relative path
# ("dewey_time/dewey_time/doctype/...") silently fails to open there.
_DOCTYPE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dewey_time", "doctype")
)


def _load_doctype_json(doctype_folder, filename):
    path = os.path.join(_DOCTYPE_DIR, doctype_folder, filename)
    with open(path) as fh:
        return json.load(fh)


def _fields_by_name(doctype_json):
    return {f["fieldname"]: f for f in doctype_json["fields"]}


class TestAttendanceFlagDecisionValidate(unittest.TestCase):
    """The controller's *only* rule: note required when reason == OTHER or
    outcome == UPHELD. decided_by/decided_at/supersedes/superseded are set by
    flag_decision_api.py, not validate() — test_validate_does_not_touch_
    supersession_fields below guards against that boundary eroding."""

    def _doc(self, **overrides):
        from dewey_time.dewey_time.doctype.attendance_flag_decision.attendance_flag_decision import (
            AttendanceFlagDecision,
        )

        defaults = {
            "flag_identity": "AUTO-hr-emp-00001-2026-08-01-late-start",
            "employee": "HR-EMP-00001",
            "attendance_date": date(2026, 8, 1),
            "flag_code": "LATE_START",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": "",
        }
        defaults.update(overrides)
        return AttendanceFlagDecision(defaults)

    def test_note_required_for_reason_other(self):
        doc = self._doc(reason="OTHER", note="")
        with self.assertRaises(Exception):
            doc.validate()

        doc_with_note = self._doc(
            reason="OTHER", note="Covered a colleague's shift, approved verbally."
        )
        doc_with_note.validate()  # must not raise

    def test_note_required_for_outcome_upheld(self):
        doc = self._doc(outcome="UPHELD", reason="GENUINE_VIOLATION", note="")
        with self.assertRaises(Exception):
            doc.validate()

        doc_with_note = self._doc(
            outcome="UPHELD",
            reason="GENUINE_VIOLATION",
            note="No-call no-show, confirmed with manager.",
        )
        doc_with_note.validate()  # must not raise

    def test_note_not_required_for_plain_excused_non_other_reason(self):
        doc = self._doc(outcome="EXCUSED", reason="APPROVED_LEAVE", note="")
        doc.validate()  # must not raise

    def test_validate_does_not_touch_supersession_fields(self):
        # decided_by/decided_at/supersedes/superseded are the API layer's
        # job (flag_decision_api.py, a later task). validate() must leave
        # them exactly as constructed, whatever they were set to.
        doc = self._doc(
            outcome="EXCUSED",
            reason="APPROVED_LEAVE",
            note="",
            decided_by="PRESET",
            decided_at="PRESET",
            supersedes="PRESET",
            superseded="PRESET",
        )
        doc.validate()
        self.assertEqual(doc.decided_by, "PRESET")
        self.assertEqual(doc.decided_at, "PRESET")
        self.assertEqual(doc.supersedes, "PRESET")
        self.assertEqual(doc.superseded, "PRESET")


class TestAttendanceFlagDecisionJson(unittest.TestCase):
    def test_search_index_fields_present(self):
        fields = _fields_by_name(
            _load_doctype_json("attendance_flag_decision", "attendance_flag_decision.json")
        )
        for fieldname in ("flag_identity", "attendance_date", "superseded"):
            self.assertEqual(
                fields[fieldname].get("search_index"),
                1,
                f"{fieldname} is missing search_index: 1",
            )

    def test_autoname_is_hash(self):
        doctype_json = _load_doctype_json(
            "attendance_flag_decision", "attendance_flag_decision.json"
        )
        self.assertEqual(doctype_json.get("autoname"), "hash")


class TestAttendanceFlagJsonDeprecation(unittest.TestCase):
    def test_search_index_fields_present(self):
        fields = _fields_by_name(_load_doctype_json("attendance_flag", "attendance_flag.json"))
        for fieldname in ("attendance_date", "flag_code", "status"):
            self.assertEqual(
                fields[fieldname].get("search_index"),
                1,
                f"{fieldname} is missing search_index: 1",
            )

    def test_deprecated_fields_are_read_only_and_relabelled(self):
        fields = _fields_by_name(_load_doctype_json("attendance_flag", "attendance_flag.json"))
        for fieldname in ("status", "hr_note", "hr_user", "hr_decided_at"):
            field = fields[fieldname]
            self.assertEqual(field.get("read_only"), 1, f"{fieldname} is not read_only")
            label = field.get("label", "")
            self.assertTrue(
                label.startswith("(deprecated) "),
                f"{fieldname} label {label!r} is not prefixed '(deprecated) '",
            )


if __name__ == "__main__":
    unittest.main()
