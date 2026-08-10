import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


# FLAG_SEVERITY was duplicated here from attendance_engine.closeout, and
# test_closeout pinned the two copies together so neither could drift. Deleted
# with T3-11: the only thing that read this copy was a severity default that
# could never fire (see before_insert), so it now has one owner --
# closeout.FLAG_SEVERITY, which is what actually stamps every flag.


class AttendanceFlag(Document):
    def before_save(self):
        # `not self.is_new()` is load-bearing, and only became observable when
        # T3-11 made this controller load at all. Frappe runs before_save during
        # insert() as well as save(), and has_value_changed() reports True for
        # EVERY field when there is no pre-save snapshot -- which is exactly the
        # state during an insert. Without the gate, every AUTO flag the engine
        # writes (one per code, on every punch, all day) would stamp an audit
        # field meaning "who changed the status" with whoever happened to
        # trigger the webhook, on a row whose status nobody had changed.
        #
        # Same quirk, same gate, as AttendanceFlagDecision.validate.
        if not self.is_new() and self.has_value_changed("status"):
            self.status_changed_by = frappe.session.user
            self.status_changed_at = now_datetime()

    def before_insert(self):
        # There is deliberately no severity default here. One was written --
        # `if not self.severity: self.severity = FLAG_SEVERITY[...]` -- and it
        # could never fire: frappe fills a Select with its first option before
        # before_insert runs (frappe/model/create_new.py:117), so `severity` is
        # already "INFO" and never falsy. Deleted with T3-11 rather than made
        # authoritative, because the two writers that matter both set it
        # themselves: closeout._insert_flag passes it explicitly, and a Desk
        # user picks it from the dropdown in front of them. Overriding would
        # discard a hand-picked severity to fix a gap neither writer has.
        #
        # What remains is redundant for engine writes but is the only guard a
        # Desk-side insert gets, and Desk is where an incomplete AUTO row would
        # come from.
        #
        # This block used to also assign a deterministic name. Deleted with the
        # custom:1 fix (T3-11): AUTO flags are hard-deleted and rebuilt on every
        # punch, so idempotency comes from that cycle, and stable identity comes
        # from flag_identity, which computes it from CONTENT precisely because
        # the name cannot be relied on. Two key schemes for one job is one too
        # many -- and the version that lived here carried an uncapped
        # _delivery_failed_key where flag_identity caps the same suffix at [:80].
        if (self.source or "").upper() == "AUTO":
            if not (self.employee and self.attendance_date and self.flag_code):
                frappe.throw("AUTO flags require employee, attendance_date, and flag_code")

            if not self.company:
                self.company = frappe.db.get_value("Employee", self.employee, "company")
