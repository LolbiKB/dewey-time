# dewey_time/tests/test_flag_decision_doctype.py
import json
import os
import sys
import unittest
from datetime import date
from types import ModuleType
from unittest.mock import MagicMock


def _is_new(self):
    """frappe's Document.is_new() reads "__islocal", which insert() sets on the doc
    before running validate() and which a doc loaded for an update does not carry.
    Defaulting to True here means a bare AttendanceFlagDecision({...}) models an
    INSERT, which is what every note-rule test below is; the update tests pass
    __islocal=False explicitly, alongside a pre-save snapshot."""
    return bool(self.__dict__.get("__islocal", True))


def _get_doc_before_save(self):
    # run_before_save_methods() calls load_doc_before_save() before validate(), so
    # this is populated for an update and absent on an insert.
    return self.__dict__.get("_doc_before_save")


def _has_value_changed(self, fieldname):
    previous = self.get_doc_before_save()
    # Matches frappe: with no snapshot to compare against EVERY field reads as
    # changed — which is why the controller has to gate on is_new().
    if not previous:
        return True
    return previous.get(fieldname) != self.__dict__.get(fieldname)


def _add_document_history_methods(document_cls):
    """Top up the mock Document with the three methods the controller calls.

    Attached rather than declared in the class body below because whichever test
    module imports first wins sys.modules["frappe.model.document"] — usually
    test_closeout.py, alphabetically — so a class defined here is frequently NOT
    the one under test. Topping up the live class is the same repair
    test_closeout._install_frappe_mock already applies to frappe.utils.get_time.
    The hasattr guard leaves a real frappe.model.document untouched.
    """
    if hasattr(document_cls, "is_new"):
        return
    document_cls.is_new = _is_new
    document_cls.get_doc_before_save = _get_doc_before_save
    document_cls.has_value_changed = _has_value_changed


# Same idiom as dewey_time/tests/test_closeout.py:24-96 — mock frappe wholesale
# so this runs without a live bench where possible. Kept local (not imported
# from test_closeout) because bench's test discovery loads modules independently
# and importing across test modules for a helper is not the established pattern
# in this test suite.
def _install_frappe_mock():
    if "frappe" in sys.modules and isinstance(sys.modules["frappe"], MagicMock):
        installed = sys.modules.get("frappe.model.document")
        if installed is not None:
            _add_document_history_methods(installed.Document)
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

    _add_document_history_methods(Document)
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


class TestAttendanceFlagDecisionImmutability(unittest.TestCase):
    """A recorded decision is append-only: the spec's guarantee is that its content
    never changes and that the only field ever written on an existing row is the
    supersession pointer. Nothing enforced that — the doctype grants HR User and HR
    Manager write:1, outcome/reason/note are editable fields, and a Desk edit would
    rewrite a verdict while KEEPING the original decided_by/decided_at, attributing
    someone else's change to whoever first decided. track_changes records that; it
    does not prevent it. The correction path is to decide the flag again, which
    inserts a new row and supersedes this one.
    """

    RECORDED = {
        "flag_identity": "AUTO-hr-emp-00001-2026-08-01-late-start",
        "employee": "HR-EMP-00001",
        "attendance_date": date(2026, 8, 1),
        "flag_code": "LATE_START",
        "employee_branch": "Phnom Penh HQ",
        "outcome": "EXCUSED",
        "reason": "APPROVED_LEAVE",
        "note": "Approved in writing by her manager.",
        "evidence_fingerprint": "438109b069c827218bb68e66b3ae58fe",
        "group_key": "AFD-abc123def456",
        "decided_by": "hr@example.com",
        "decided_at": "2026-08-05 09:00:00",
        "supersedes": None,
        "superseded": 0,
    }

    # Every field the guard covers, each paired with a plausible edit. Looping
    # rather than asserting the list's contents keeps this a BEHAVIOUR test: drop
    # any one name from the controller's tuple and its subTest fails.
    EDITS = (
        ("flag_identity", "AUTO-hr-emp-00002-2026-08-01-late-start"),
        ("employee", "HR-EMP-00002"),
        ("attendance_date", date(2026, 8, 2)),
        ("flag_code", "LEFT_EARLY"),
        # Nothing reads employee_branch back off a decision row today — it is a
        # denormalisation written at insert so cause grouping never joins Employee
        # — but it is part of what was recorded, and rewriting it would change this
        # decision's branch attribution under the original decider's name.
        ("employee_branch", "Siem Reap Depot"),
        ("outcome", "UPHELD"),
        ("reason", "GENUINE_VIOLATION"),
        ("note", "Actually, no."),
        ("evidence_fingerprint", "00000000000000000000000000000000"),
        ("group_key", "AFD-999999999999"),
        ("decided_by", "someone.else@example.com"),
        ("decided_at", "2026-08-06 17:00:00"),
    )

    def _saved(self, **overrides):
        """A decision as frappe hands it to validate() on an UPDATE: no "__islocal",
        and the pre-save snapshot loaded (run_before_save_methods calls
        load_doc_before_save before validate)."""
        from dewey_time.dewey_time.doctype.attendance_flag_decision.attendance_flag_decision import (
            AttendanceFlagDecision,
        )

        fields = dict(self.RECORDED)
        fields.update(overrides)
        return AttendanceFlagDecision(
            dict(fields, __islocal=False, _doc_before_save=dict(self.RECORDED))
        )

    def test_editing_any_content_or_provenance_field_is_rejected(self):
        for fieldname, new_value in self.EDITS:
            with self.subTest(fieldname):
                doc = self._saved(**{fieldname: new_value})
                with self.assertRaises(Exception) as caught:
                    doc.validate()
                self.assertIn(fieldname, str(caught.exception))

    def test_the_supersession_pointer_stays_writable(self):
        # This is the load-bearing exception. Guarding `superseded` would break
        # supersession itself — every second decision on an identity flips it on
        # the row it replaces, and reverse_decision_group flips it in bulk.
        doc = self._saved(superseded=1, supersedes="afd00000000002")
        doc.validate()  # must not raise
        self.assertEqual(doc.superseded, 1)

    def test_an_unchanged_resave_is_allowed(self):
        # The guard fires on a CHANGE, not on the mere fact of a save — a resave
        # that touches nothing (a comment, a share, a doc-level Desk save) must
        # still go through.
        self._saved().validate()

    def test_inserting_a_new_decision_is_untouched_by_the_guard(self):
        # frappe's has_value_changed() reports True for every field when there is
        # no pre-save snapshot, which is exactly the state during insert() — so a
        # guard that forgot to gate on is_new() would reject every write the
        # feature makes, including its own.
        from dewey_time.dewey_time.doctype.attendance_flag_decision.attendance_flag_decision import (
            AttendanceFlagDecision,
        )

        doc = AttendanceFlagDecision(dict(self.RECORDED))
        self.assertTrue(doc.is_new())
        doc.validate()  # must not raise


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

    def test_hr_user_cannot_delete_a_decision(self):
        # The audit-integrity property the whole doctype exists for: an HR User
        # records decisions and can supersede them, but can never make one
        # disappear. It is one keystroke in a JSON file away from silently
        # flipping, and nothing else in the app would notice.
        perms = {
            row["role"]: row
            for row in _load_doctype_json(
                "attendance_flag_decision", "attendance_flag_decision.json"
            )["permissions"]
        }
        self.assertEqual(perms["HR User"].get("delete"), 0)
        # …and the two things that make the trail worth keeping: they can write
        # decisions, and they cannot export the roster of them out of the site.
        self.assertEqual(perms["HR User"].get("create"), 1)
        self.assertEqual(perms["HR User"].get("export"), 0)


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
