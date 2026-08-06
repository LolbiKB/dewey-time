# dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.py
import frappe
from frappe.model.document import Document

# Everything that makes a decision a decision — the verdict, the flag it is about,
# and who reached it when. Once the row exists none of it may change: the record is
# append-only, and the way to correct a decision is to decide the flag again, which
# inserts a new row and supersedes this one (flag_decision_api._write_decision).
#
# `employee_branch` is in the list even though nothing reads it back off a decision
# row today. It is written at insert from branch_by_employee
# (flag_decision_api.py:252) as a denormalisation so cause grouping never has to
# join Employee, which makes it part of what was recorded — and a Desk edit would
# rewrite this decision's branch attribution while leaving decided_by/decided_at
# pointing at whoever originally decided. That is the misattribution this guard
# exists to stop, whether or not a reader happens to consume the field yet.
#
# Without this guard a Desk edit — HR User and HR Manager both hold write:1, and
# outcome/reason/note are ordinary editable fields — rewrites a verdict while
# KEEPING the original decided_by/decided_at, i.e. attributes one person's change
# to another. track_changes records that; it does not prevent it.
#
# `supersedes` and `superseded` are deliberately absent: the pointer is the ONE
# thing that ever changes on an existing row. decide_flags and
# reverse_decision_group both flip it through frappe.db.set_value(), which bypasses
# validate() entirely, so this list could not break them either way — but naming
# them here would make a future Desk-side or ORM supersession impossible, which is
# the opposite of the intent.
IMMUTABLE_FIELDS = (
    "flag_identity",
    "employee",
    "attendance_date",
    "flag_code",
    "employee_branch",
    "outcome",
    "reason",
    "note",
    "evidence_fingerprint",
    "group_key",
    "decided_by",
    "decided_at",
)


class AttendanceFlagDecision(Document):
    def validate(self):
        # frappe's has_value_changed() reports True for EVERY field when there is
        # no pre-save snapshot, which is exactly the state during insert() — so
        # the is_new() gate is what keeps this from rejecting the feature's own
        # writes rather than a decoration.
        if not self.is_new():
            self._reject_content_edits()

        # decided_by, decided_at, supersedes and superseded are written by
        # flag_decision_api.decide_flags() / reverse_decision_group() at insert
        # time and by a direct frappe.db.set_value(..., "superseded", 1) on the
        # row being replaced (spec 2026-08-05-hr-flag-management-design.md
        # "Supersession") — never here. validate() touching those fields would
        # either race that direct db write or force the API layer to re-derive
        # values validate() had just overwritten.
        if self.reason == "OTHER" or self.outcome == "UPHELD":
            if not (self.note or "").strip():
                frappe.throw("Note is required when reason is OTHER or the outcome is UPHELD")

    def _reject_content_edits(self):
        changed = [field for field in IMMUTABLE_FIELDS if self.has_value_changed(field)]
        if changed:
            frappe.throw(
                "A recorded decision cannot be edited ({0}). Decisions are append-only: "
                "decide the flag again and this one is superseded, with both kept on "
                "the record.".format(", ".join(changed))
            )
