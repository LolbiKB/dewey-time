# dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.py
import frappe
from frappe.model.document import Document


class AttendanceFlagDecision(Document):
    def validate(self):
        # This is the ONLY rule this controller enforces. decided_by,
        # decided_at, supersedes and superseded are written by
        # flag_decision_api.decide_flags() / reverse_decision_group() at
        # insert time and by a direct frappe.db.set_value(..., "superseded", 1)
        # on the row being replaced (spec 2026-08-05-hr-flag-management-design.md
        # "Supersession") — never here. validate() touching those fields
        # would either race that direct db write or force the API layer to
        # re-derive values validate() had just overwritten.
        if self.reason == "OTHER" or self.outcome == "UPHELD":
            if not (self.note or "").strip():
                frappe.throw("Note is required when reason is OTHER or the outcome is UPHELD")
